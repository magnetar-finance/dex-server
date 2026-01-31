import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { BaseFactoryContractService } from './base/base-factory';
import { ChainIds, CONNECTION_INFO, DEFAULT_BLOCK_RANGE } from '../../../common/variables';
import { ChainConnectionInfo } from '../interfaces';
import { InjectRepository } from '@nestjs/typeorm';
import { IndexerEventStatus } from '../../database/entities/indexer-event-status.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CacheService } from '../../cache/cache.service';
import { Pool, PoolType } from '../../database/entities/pool.entity';
import { Statistics } from '../../database/entities/statistics.entity';
import { ILike, Repository } from 'typeorm';
import { ClFactory, Nfpm, Nfpm__factory } from './typechain';
import { formatUnits, JsonRpcProvider, ZeroAddress } from 'ethers';
import { User } from '../../database/entities/user.entity';
import { LiquidityPosition } from '../../database/entities/lp-position.entity';

interface IResolvableTransfer {
  type: 'mint' | 'burn' | 'simple-transfer';
  to: string;
  from: string;
  tokenId: number;
  chainId: number;
  blockNumber: number;
  transactionHash: string;
}

@Injectable()
export class NFPMContractService extends BaseFactoryContractService implements OnModuleInit {
  private resolveTxs: boolean = false;

  constructor(
    @Inject(CONNECTION_INFO) connectionInfo: ChainConnectionInfo[],
    cacheService: CacheService,
    @InjectRepository(IndexerEventStatus)
    indexerStatusRepository: Repository<IndexerEventStatus>,
    @InjectRepository(Statistics) statisticsRepository: Repository<Statistics>,
    @InjectRepository(Pool) private readonly poolRepository: Repository<Pool>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(LiquidityPosition)
    private readonly liquidityPositionRepository: Repository<LiquidityPosition>,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super(connectionInfo, cacheService, indexerStatusRepository, statisticsRepository);
  }

  onModuleInit() {
    this.initializeContracts();
    this.initializeStartBlocks();

    this.resolveTxs = true;
    void this.resolveTransactions();
  }

  private initializeContracts() {
    this.CONTRACT_ADDRESSES = {
      [ChainIds.DUSK_TESTNET]: '0x8948f9d59203F9dCF4de4B2baa10887993274C3C',
      [ChainIds.PHAROS_TESTNET]: '0xa45328cB9B5215cc18937AB123fCf44a6815b6C1',
    };
  }

  private initializeStartBlocks() {
    this.START_BLOCKS = {
      [ChainIds.DUSK_TESTNET]: 1308356,
      [ChainIds.PHAROS_TESTNET]: 10490769,
    };
  }

  private getNFPMContract(chainId: number, provider: JsonRpcProvider): Nfpm {
    const address = this.CONTRACT_ADDRESSES[chainId];
    return Nfpm__factory.connect(address, provider);
  }

  async handleTransfer(chainId: number) {
    this.logger.log(`Now sequencing pool creation event on ${chainId}`, NFPMContractService.name);
    if (!this.cacheService.isConnected()) {
      await this.waitFor(2000);
      return;
    }
    await this.haltUntilOpen(chainId); // If resource is locked, halt at this point

    let lastBlockNumber: number | undefined;

    try {
      this.logger.log(`Now fetching latest block number on ${chainId}`, NFPMContractService.name);
      lastBlockNumber = await this.getLatestBlockNumber(chainId);
    } catch (error: any) {
      // Release resource
      await this.releaseResource(chainId);
      this.logger.error(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        `Unable to fetch latest block: ${error.message}`,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        error.stack,
        NFPMContractService.name,
      );
    }

    if (typeof lastBlockNumber === 'undefined') return;

    const indexerEventStatus = await this.getIndexerEventStatus('Transfer', chainId);

    // We want to keep record in sync with chain
    if (indexerEventStatus.lastBlockNumber >= lastBlockNumber) {
      this.logger.debug(
        `Indexer status check with ID ${indexerEventStatus.id} is up to date with current block. Skipping...`,
        NFPMContractService.name,
      );
      // Release resource
      await this.releaseResource(chainId);
      return;
    }
    const connectionInfo = this.getConnectionInfo(chainId);
    const promises = connectionInfo.rpcInfos.map((rpcInfo) => {
      const provider = this.provider(rpcInfo, chainId);
      const contract = this.getNFPMContract(chainId, provider);
      const blockStart = lastBlockNumber
        ? Math.min(indexerEventStatus.lastBlockNumber + 1, lastBlockNumber)
        : indexerEventStatus.lastBlockNumber + 1;
      const blockEnd = blockStart + (rpcInfo.queryBlockRange || DEFAULT_BLOCK_RANGE);
      indexerEventStatus.lastBlockNumber = lastBlockNumber
        ? Math.min(blockEnd, lastBlockNumber)
        : blockEnd; // We still want to update last processed block even if no data is available.
      return contract.queryFilter(contract.filters.Transfer, blockStart, blockEnd);
    });

    await this.waitFor(3000);

    try {
      const eventData = await Promise.any(promises);

      for (const eventDatum of eventData) {
        await this.waitFor(2000);
        const processedBlock = await eventDatum.getBlock();
        const { from, to, tokenId } = eventDatum.args;

        const tokenIdAsNumber = parseInt(tokenId.toString());
        const resolvableTransfer: IResolvableTransfer = {
          type: from === ZeroAddress ? 'mint' : to === ZeroAddress ? 'burn' : 'simple-transfer',
          to,
          from,
          tokenId: tokenIdAsNumber,
          chainId,
          blockNumber: processedBlock.number,
          transactionHash: eventDatum.transactionHash.toLowerCase(),
        };

        await this.cacheService.hCache(
          'nfpm-token-transfer',
          tokenId.toString(),
          JSON.stringify(resolvableTransfer),
        );

        indexerEventStatus.lastBlockNumber = processedBlock.number;
        this.updateChainMetric(chainId);
      }
    } catch (error: any) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      this.logger.error(error.message, error.stack, NFPMContractService.name);
      return;
    }

    await this.indexerEventStatusRepository.save(indexerEventStatus);
    await this.releaseResource(chainId);
  }

  private async resolveTransactions() {
    while (this.resolveTxs) {
      if (!this.cacheService.isConnected()) {
        await this.waitFor(2000);
        continue;
      }

      await this.resolveTransfers();
    }
  }

  private async resolveTransfers() {
    try {
      const transfers = await this.cacheService.hObtainAll('nfpm-token-transfer');
      for (const [tId, entry] of Object.entries(transfers)) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const resolvableTransfer: IResolvableTransfer = JSON.parse(entry);
        const { chainId, tokenId, to, blockNumber, transactionHash } = resolvableTransfer;
        // Halt resource usage by other processes
        await this.haltUntilOpen(chainId);

        const connectionInfo = this.getConnectionInfo(chainId);
        const positionPromises = connectionInfo.rpcInfos.map((rpcInfo) => {
          const provider = this.provider(rpcInfo, chainId);
          const contract = this.getNFPMContract(chainId, provider);
          return contract.positions(tokenId);
        });
        await this.waitFor(2000);
        // Find single position
        const position = await Promise.any(positionPromises);
        // Find pool
        const pool = await this.poolRepository.findOneBy({
          token0: { address: ILike(`%${position.token0}%`) },
          token1: { address: ILike(`%${position.token1}%`) },
          tickSpacing: parseInt(position.tickSpacing.toString()),
          poolType: PoolType.CONCENTRATED,
        });

        if (pool === null) {
          await this.releaseResource(chainId);
          continue;
        }

        if (resolvableTransfer.type === 'mint') {
          const liquidity = parseFloat(formatUnits(position.liquidity, 18));

          await this.updateLiquidityPosition(
            pool,
            to,
            liquidity,
            tokenId,
            blockNumber,
            transactionHash,
          );
        } else if (resolvableTransfer.type === 'burn') {
          const lp = await this.liquidityPositionRepository.findOneByOrFail({
            pool: { id: pool.id },
            clPositionTokenId: tokenId,
          });
          void this.liquidityPositionRepository.remove(lp);
        }
        await this.cacheService.hDecache('nfpm-token-transfer', tId);
        await this.releaseResource(chainId);
      }
    } catch (error: any) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      this.logger.error(error.message, error.stack, NFPMContractService.name);
      return;
    }
  }

  private async updateLiquidityPosition(
    pool: Pool,
    account: string,
    amount: number,
    tokenId?: number,
    blockNumber?: number,
    transaction?: string,
  ) {
    let user = await this.userRepository.findOneBy({ id: account.toLowerCase() });

    if (user === null) {
      user = this.userRepository.create({
        address: account,
      });
      user = await this.userRepository.save(user);
    }

    let lpPosition = await this.liquidityPositionRepository.findOneBy({
      pool: { id: pool.id },
      account: { id: user.id },
      clPositionTokenId: tokenId,
    });

    if (lpPosition === null) {
      lpPosition = this.liquidityPositionRepository.create({
        account: user,
        pool,
        position: 0,
        creationBlock: blockNumber,
        creationTransaction: transaction,
        chainId: pool.chainId,
        clPositionTokenId: tokenId,
      });

      lpPosition = await this.liquidityPositionRepository.save(lpPosition);
    }

    lpPosition.position = lpPosition.position + amount;
    return this.liquidityPositionRepository.save(lpPosition);
  }
}
