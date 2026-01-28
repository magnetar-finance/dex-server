import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { BaseFactoryContractService } from './base/base-factory';
import { ChainConnectionInfo } from '../interfaces';
import { Factory, Factory__factory } from './typechain';
import { JsonRpcProvider } from 'ethers';
import { ChainIds, CONNECTION_INFO, DEFAULT_BLOCK_RANGE } from '../../../common/variables';
import { InjectRepository } from '@nestjs/typeorm';
import { IndexerEventStatus } from '../../database/entities/indexer-event-status.entity';
import { Token } from '../../database/entities/token.entity';
import { Repository } from 'typeorm';
import { Pool, PoolType } from '../../database/entities/pool.entity';
import { Statistics } from '../../database/entities/statistics.entity';
import { CacheService } from '../../cache/cache.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventTypes } from './types';

@Injectable()
export class V2FactoryService extends BaseFactoryContractService implements OnModuleInit {
  constructor(
    @Inject(CONNECTION_INFO) connectionInfo: ChainConnectionInfo[],
    cacheService: CacheService,
    @InjectRepository(IndexerEventStatus)
    indexerEventStatusRepository: Repository<IndexerEventStatus>,
    @InjectRepository(Statistics) statisticsRepository: Repository<Statistics>,
    @InjectRepository(Token)
    private readonly tokenRepository: Repository<Token>,
    @InjectRepository(Pool) private readonly poolRepository: Repository<Pool>,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super(connectionInfo, cacheService, indexerEventStatusRepository, statisticsRepository);
  }

  async onModuleInit() {
    await this.waitFor(10000); // Wait for 10 seconds
    this.initializeContracts();
    this.initializeStartBlocks();
  }

  private initializeContracts() {
    this.CONTRACT_ADDRESSES = {
      [ChainIds.DUSK_TESTNET]: '0xE41d241720FEE7cD6BDfA9aB3204d23687703CD5',
      [ChainIds.PHAROS_TESTNET]: '0x68D81F61b88c2622A590719f956f5Dc253a1dC3d',
    };
  }

  private initializeStartBlocks() {
    this.START_BLOCKS = {
      [ChainIds.DUSK_TESTNET]: 1306677,
      [ChainIds.PHAROS_TESTNET]: 10485542,
    };
  }

  private getContract(chainId: number, provider: JsonRpcProvider): Factory {
    const contractAddress = this.CONTRACT_ADDRESSES[chainId];
    return Factory__factory.connect(contractAddress, provider);
  }

  async handlePoolCreated(chainId: number) {
    this.logger.log(`Now sequencing pool creation event on ${chainId}`, 'V2FactoryService');
    if (!this.cacheService.isConnected()) return;
    await this.haltUntilOpen(chainId); // If resource is locked, halt at this point

    const lastBlockNumber = await this.getLatestBlockNumber(chainId);

    const indexerEventStatus = await this.getIndexerEventStatus('PoolCreated', chainId);
    const connectionInfo = this.getConnectionInfo(chainId);
    const promises = connectionInfo.rpcInfos.map((rpcInfo) => {
      const provider = this.provider(rpcInfo, chainId);
      const contract = this.getContract(chainId, provider);
      const blockStart = lastBlockNumber
        ? Math.min(indexerEventStatus.lastBlockNumber + 1, lastBlockNumber)
        : indexerEventStatus.lastBlockNumber + 1;
      const blockEnd = blockStart + (rpcInfo.queryBlockRange || DEFAULT_BLOCK_RANGE);
      indexerEventStatus.lastBlockNumber = lastBlockNumber
        ? Math.min(blockEnd, lastBlockNumber)
        : blockEnd; // We still want to update last processed block even if no data is available.
      return contract.queryFilter(contract.filters.PoolCreated, blockStart, blockEnd);
    });

    // Wait for 3 secs
    await this.waitFor(3000);
    const eventData = await Promise.any(promises);

    for (const eventDatum of eventData) {
      const processedBlock = await eventDatum.getBlock();
      const { pool, token0, token1, stable } = eventDatum.args;

      const token0Id = `${token0.toLowerCase()}-${chainId}`;
      const token1Id = `${token1.toLowerCase()}-${chainId}`;

      // Find tokens
      let token0Entity = await this.tokenRepository.findOneBy({ id: token0Id });
      let token1Entity = await this.tokenRepository.findOneBy({ id: token1Id });

      if (token0Entity === null) {
        const { name, symbol, decimals } = await this.getERC20Metadata(token0, chainId);
        token0Entity = this.tokenRepository.create({
          name,
          symbol,
          decimals,
          address: token0,
          chainId,
          totalLiquidity: 0,
          totalLiquidityETH: 0,
          totalLiquidityUSD: 0,
          derivedETH: 0,
          derivedUSD: 0,
          tradeVolume: 0,
          tradeVolumeUSD: 0,
          txCount: 0,
        });
        token0Entity = await this.tokenRepository.save(token0Entity);
      }

      if (token1Entity === null) {
        const { name, symbol, decimals } = await this.getERC20Metadata(token1, chainId);
        token1Entity = this.tokenRepository.create({
          name,
          symbol,
          decimals,
          address: token1,
          chainId,
          totalLiquidity: 0,
          totalLiquidityETH: 0,
          totalLiquidityUSD: 0,
          derivedETH: 0,
          derivedUSD: 0,
          tradeVolume: 0,
          tradeVolumeUSD: 0,
          txCount: 0,
        });
        token1Entity = await this.tokenRepository.save(token1Entity);
      }

      const poolEntity = this.poolRepository.create({
        address: pool,
        totalBribesUSD: 0,
        chainId,
        reserve0: 0,
        reserve1: 0,
        reserveETH: 0,
        reserveUSD: 0,
        token0: token0Entity,
        token1: token1Entity,
        token0Price: 0,
        token1Price: 0,
        totalEmissions: 0,
        totalEmissionsUSD: 0,
        totalFees0: 0,
        totalFees1: 0,
        totalFeesUSD: 0,
        totalSupply: 0,
        totalVotes: 0,
        txCount: 0,
        volumeETH: 0,
        volumeToken0: 0,
        volumeToken1: 0,
        volumeUSD: 0,
        poolType: stable ? PoolType.STABLE : PoolType.VOLATILE,
        createdAtTimestamp: processedBlock.timestamp,
        createdAtBlockNumber: processedBlock.number,
      });

      // Insert pool
      await this.poolRepository.save(poolEntity);

      // Update indexer status
      indexerEventStatus.lastBlockNumber = processedBlock.number;

      this.updateChainMetric(chainId);
      this.eventEmitter.emit(EventTypes.V2_POOL_DEPLOYED, {
        address: pool,
        block: processedBlock.number,
        chainId,
      });
    }

    await this.indexerEventStatusRepository.save(indexerEventStatus);

    const statistics = await this.loadStatistics();
    statistics.totalPairsCreated = statistics.totalPairsCreated + 1;

    await this.statisticsRepository.save(statistics);
    await this.releaseResource(chainId);
  }
}
