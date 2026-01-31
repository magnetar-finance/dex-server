import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { BaseFactoryContractService } from './base/base-factory';
import { ChainIds, CONNECTION_INFO, DEFAULT_BLOCK_RANGE } from '../../../common/variables';
import { ChainConnectionInfo } from '../interfaces';
import { InjectRepository } from '@nestjs/typeorm';
import { IndexerEventStatus } from '../../database/entities/indexer-event-status.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CacheService } from '../../cache/cache.service';
import { Pool } from '../../database/entities/pool.entity';
import { Statistics } from '../../database/entities/statistics.entity';
import { Repository } from 'typeorm';
import { Nfpm, Nfpm__factory } from './typechain';
import { JsonRpcProvider, ZeroAddress } from 'ethers';

@Injectable()
export class NFPMContractService extends BaseFactoryContractService implements OnModuleInit {
  constructor(
    @Inject(CONNECTION_INFO) connectionInfo: ChainConnectionInfo[],
    cacheService: CacheService,
    @InjectRepository(IndexerEventStatus)
    indexerStatusRepository: Repository<IndexerEventStatus>,
    @InjectRepository(Statistics) statisticsRepository: Repository<Statistics>,
    @InjectRepository(Pool) private readonly poolRepository: Repository<Pool>,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super(connectionInfo, cacheService, indexerStatusRepository, statisticsRepository);
  }

  onModuleInit() {
    this.initializeContracts();
    this.initializeStartBlocks();
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
        const { from, to, tokenId } = eventDatum.args;

        const tokenIdAsNumber = parseInt(tokenId.toString());

        await this.cacheService.hCache(
          'nfpm-token-transfer',
          tokenId.toString(),
          JSON.stringify({
            type: from === ZeroAddress ? 'mint' : to === ZeroAddress ? 'burn' : 'simple-transfer',
            to,
            from,
            tokenId: tokenIdAsNumber,
          }),
        );
      }
    } catch (error: any) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      this.logger.error(error.message, error.stack, NFPMContractService.name);
      return;
    }
  }
}
