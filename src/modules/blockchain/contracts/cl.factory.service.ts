import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { BaseFactoryContractService } from './base/base-factory';
import { ChainConnectionInfo } from '../interfaces';
import { ClFactory, ClFactory__factory } from './typechain';
import { JsonRpcProvider } from 'ethers';
import { ChainIds, CONNECTION_INFO, DEFAULT_BLOCK_RANGE } from '../../../common/variables';
import { InjectRepository } from '@nestjs/typeorm';
import { IndexerEventStatus } from '../../database/entities/indexer-event-status.entity';
import { Token } from '../../database/entities/token.entity';
import { Repository } from 'typeorm';
import { Pool, PoolType } from '../../database/entities/pool.entity';
import { CacheService } from '../../cache/cache.service';
import { Statistics } from '../../database/entities/statistics.entity';

@Injectable()
export class CLFactoryService extends BaseFactoryContractService implements OnModuleInit {
  constructor(
    @Inject(CONNECTION_INFO) connectionInfo: ChainConnectionInfo[],
    cacheService: CacheService,
    @InjectRepository(IndexerEventStatus)
    indexerStatusRepository: Repository<IndexerEventStatus>,
    @InjectRepository(Statistics) statisticsRepository: Repository<Statistics>,
    @InjectRepository(Token)
    private readonly tokenRepository: Repository<Token>,
    @InjectRepository(Pool) private readonly poolRepository: Repository<Pool>,
  ) {
    super(connectionInfo, cacheService, indexerStatusRepository, statisticsRepository);
  }

  onModuleInit() {
    this.initializeContracts();
    this.initializeStartBlocks();
  }

  private initializeContracts() {
    this.CONTRACT_ADDRESSES = {
      [ChainIds.DUSK_TESTNET]: '0xf6a6a429a0b9676293Df0E3616A6a33cA673b5C3',
      [ChainIds.PHAROS_TESTNET]: '0xD75411C6A3fEf2278E51EEaa73cdE8352c59eFEd',
    };
  }

  private initializeStartBlocks() {
    this.START_BLOCKS = {
      [ChainIds.DUSK_TESTNET]: 1308356,
      [ChainIds.PHAROS_TESTNET]: 10490769,
    };
  }

  private getContract(chainId: number, provider: JsonRpcProvider): ClFactory {
    const contractAddress = this.CONTRACT_ADDRESSES[chainId];
    return ClFactory__factory.connect(contractAddress, provider);
  }

  async handlePoolCreated(chainId: number) {
    this.logger.log(`Now sequencing pool creation event on ${chainId}`, 'CLFactoryService');
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
      const { pool, token0, token1 } = eventDatum.args;

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
        poolType: PoolType.CONCENTRATED,
        createdAtBlockNumber: processedBlock.number,
        createdAtTimestamp: processedBlock.timestamp,
      });

      // Insert pool
      await this.poolRepository.save(poolEntity);

      // Update indexer status
      indexerEventStatus.lastBlockNumber = processedBlock.number;
      this.updateChainMetric(chainId);
    }

    await this.indexerEventStatusRepository.save(indexerEventStatus);

    const statistics = await this.loadStatistics();
    statistics.totalPairsCreated = statistics.totalPairsCreated + 1;

    await this.statisticsRepository.save(statistics);

    await this.releaseResource(chainId); // Release resource
  }
}
