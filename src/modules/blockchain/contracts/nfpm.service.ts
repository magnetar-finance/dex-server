import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BaseFactoryContractService } from './base/base-factory';
import { ChainIds, CONNECTION_INFO, DEFAULT_BLOCK_RANGE } from '../../../common/variables';
import { ChainConnectionInfo } from '../interfaces';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { IndexerEventStatus } from '../../database/entities/indexer-event-status.entity';
import { CacheService } from '../../cache/cache.service';
import { Pool, PoolType } from '../../database/entities/pool.entity';
import { Statistics } from '../../database/entities/statistics.entity';
import { DataSource, EntityManager, Equal, ILike, Repository } from 'typeorm';
import { Nfpm, Nfpm__factory } from './typechain';
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
export class NFPMContractService
  extends BaseFactoryContractService
  implements OnModuleInit, OnModuleDestroy
{
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
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {
    super(connectionInfo, cacheService, indexerStatusRepository, statisticsRepository);
  }

  onModuleInit() {
    this.initializeContracts();
    this.initializeStartBlocks();
  }

  onModuleDestroy() {}

  private initializeContracts() {
    this.CONTRACT_ADDRESSES = {
      [ChainIds.DUSK_TESTNET]: '0x8948f9d59203F9dCF4de4B2baa10887993274C3C',
      [ChainIds.PHAROS_TESTNET]: '0xa45328cB9B5215cc18937AB123fCf44a6815b6C1',
      [ChainIds.SEISMIC_TESTNET]: '0x023AF3A2F01982A07c80BDe582E48b4B9b491034',
    };
  }

  private initializeStartBlocks() {
    this.START_BLOCKS = {
      [ChainIds.DUSK_TESTNET]: 1994510,
      [ChainIds.PHAROS_TESTNET]: 14364409,
      [ChainIds.SEISMIC_TESTNET]: 19733040,
    };
  }

  private getNFPMContract(chainId: number, provider: JsonRpcProvider): Nfpm {
    const address = this.CONTRACT_ADDRESSES[chainId];
    return Nfpm__factory.connect(address, provider);
  }

  async handleTransfer(chainId: number) {
    this.logger.log(`[Chain: ${chainId}] Now sequencing transfer event`);
    if (!this.cacheService.isConnected()) {
      await this.waitFor(2000);
      return;
    }
    await this.haltUntilOpen(chainId);

    let lastBlockNumber: number | undefined;

    try {
      this.logger.log(`[Chain: ${chainId}] Fetching latest block number`);
      lastBlockNumber = await this.getLatestBlockNumber(chainId);
    } catch (error: any) {
      await this.releaseResource(chainId);
      this.logger.error(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        `[Chain: ${chainId}] Unable to fetch latest block → ${error.message}`,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        error.stack,
      );
    }

    if (typeof lastBlockNumber === 'undefined') return;

    const indexerEventStatus = await this.getIndexerEventStatus('Transfer', chainId);

    if (indexerEventStatus.lastBlockNumber >= lastBlockNumber) {
      this.logger.log(`[Indexer: ${indexerEventStatus.id}] Already at current block. Skipping...`);
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
      let blockEnd = blockStart + (rpcInfo.queryBlockRange || DEFAULT_BLOCK_RANGE);
      blockEnd = Math.min(lastBlockNumber, blockEnd);
      indexerEventStatus.lastBlockNumber = blockEnd;
      return contract.queryFilter(contract.filters.Transfer, blockStart, blockEnd);
    });

    try {
      const eventData = await Promise.any(promises);

      for (const eventDatum of eventData) {
        await this.waitFor(500);
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
      this.logger.error(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        `[Chain: ${chainId}] Failed to process transfer events → ${error.message}`,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        error.stack,
      );
      return;
    }

    await this.indexerEventStatusRepository.save(indexerEventStatus);
    await this.releaseResource(chainId);
  }

  async resolveTransfers(chainId: number) {
    if (!this.cacheService.isConnected()) return;

    try {
      const transfers = await this.cacheService.hObtainAll('nfpm-token-transfer');
      for (const [tId, entry] of Object.entries(transfers)) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const resolvableTransfer: IResolvableTransfer = JSON.parse(entry);
        const {
          chainId: entryChainId,
          tokenId,
          to,
          blockNumber,
          transactionHash,
        } = resolvableTransfer;

        // Skip entries that don't belong to the current chain
        if (entryChainId !== chainId) continue;

        await this.haltUntilOpen(chainId);

        const connectionInfo = this.getConnectionInfo(chainId);
        const positionPromises = connectionInfo.rpcInfos.map((rpcInfo) => {
          const provider = this.provider(rpcInfo, chainId);
          const contract = this.getNFPMContract(chainId, provider);
          return contract.positions(tokenId);
        });
        await this.waitFor(500);
        const position = await Promise.any(positionPromises);
        const isToken0Address = position.token0.length === 42;
        const token0Condition = isToken0Address
          ? { address: Equal(position.token0.toLowerCase()) }
          : { address: ILike(`%${position.token0}%`) };

        const isToken1Address = position.token1.length === 42;
        const token1Condition = isToken1Address
          ? { address: Equal(position.token1.toLowerCase()) }
          : { address: ILike(`%${position.token1}%`) };

        const pool = await this.poolRepository.findOneBy({
          token0: token0Condition,
          token1: token1Condition,
          tickSpacing: parseInt(position.tickSpacing.toString()),
          poolType: PoolType.CONCENTRATED,
        });

        if (pool === null) {
          await this.releaseResource(chainId);
          continue;
        }

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
          if (resolvableTransfer.type === 'mint') {
            const liquidity = parseFloat(formatUnits(position.liquidity, 18));

            await this.updateLiquidityPosition(
              pool,
              to,
              liquidity,
              tokenId,
              blockNumber,
              transactionHash,
              queryRunner.manager,
            );
          } else if (resolvableTransfer.type === 'burn') {
            const lp = await queryRunner.manager.getRepository(LiquidityPosition).findOneByOrFail({
              pool: { id: pool.id },
              clPositionTokenId: tokenId,
            });
            await queryRunner.manager.remove(lp);
          } else {
            const lp = await queryRunner.manager.getRepository(LiquidityPosition).findOneByOrFail({
              pool: { id: pool.id },
              clPositionTokenId: tokenId,
            });

            const amount = lp.position;
            lp.position = lp.position - amount;
            await queryRunner.manager.save(lp);

            await this.updateLiquidityPosition(
              pool,
              to,
              amount,
              tokenId,
              blockNumber,
              transactionHash,
              queryRunner.manager,
            );
          }
          await this.cacheService.hDecache('nfpm-token-transfer', tId);
          await queryRunner.commitTransaction();
        } catch (error) {
          await queryRunner.rollbackTransaction();
          throw error;
        } finally {
          await queryRunner.release();
        }

        await this.releaseResource(chainId);
      }
    } catch (error: any) {
      this.logger.error(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        `Failed to resolve transfers → ${error.message}`,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        error.stack,
      );
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
    manager?: EntityManager,
  ) {
    const userRepo = manager ? manager.getRepository(User) : this.userRepository;
    const lpRepo = manager
      ? manager.getRepository(LiquidityPosition)
      : this.liquidityPositionRepository;

    let user = await userRepo.findOneBy({ id: account.toLowerCase() });

    if (user === null) {
      user = userRepo.create({
        address: account,
      });
      user = manager ? await manager.save(user) : await userRepo.save(user);
    }

    let lpPosition = await lpRepo.findOneBy({
      pool: { id: pool.id },
      account: { id: user.id },
      clPositionTokenId: tokenId,
    });

    if (lpPosition === null) {
      lpPosition = lpRepo.create({
        account: user,
        pool,
        position: 0,
        creationBlock: blockNumber,
        creationTransaction: transaction,
        chainId: pool.chainId,
        clPositionTokenId: tokenId,
      });

      lpPosition = manager ? await manager.save(lpPosition) : await lpRepo.save(lpPosition);
    }

    lpPosition.position = lpPosition.position + amount;
    return manager ? manager.save(lpPosition) : lpRepo.save(lpPosition);
  }
}
