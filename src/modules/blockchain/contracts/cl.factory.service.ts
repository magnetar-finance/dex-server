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
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventTypes } from './types';

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
      [ChainIds.DUSK_TESTNET]: '0xf6a6a429a0b9676293Df0E3616A6a33cA673b5C3',
      [ChainIds.PHAROS_TESTNET]: '0xD75411C6A3fEf2278E51EEaa73cdE8352c59eFEd',
      [ChainIds.SEISMIC_TESTNET]: '0xB15716c7404BceFaDbd211b04F10bCbD9F93f6Dc',
    };
  }

  private initializeStartBlocks() {
    this.START_BLOCKS = {
      [ChainIds.DUSK_TESTNET]: 1994510,
      [ChainIds.PHAROS_TESTNET]: 14364409,
      [ChainIds.SEISMIC_TESTNET]: 18979337,
    };
  }

  private getCLFactoryContract(chainId: number, provider: JsonRpcProvider): ClFactory {
    const contractAddress = this.CONTRACT_ADDRESSES[chainId];
    return ClFactory__factory.connect(contractAddress, provider);
  }

  async handlePoolCreated(chainId: number) {
    this.logger.log(`[Chain: ${chainId}] Now sequencing pool creation event`);
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

    const indexerEventStatus = await this.getIndexerEventStatus('PoolCreated', chainId);

    if (indexerEventStatus.lastBlockNumber >= lastBlockNumber) {
      this.logger.log(`[Indexer: ${indexerEventStatus.id}] Already at current block. Skipping...`);
      await this.releaseResource(chainId);
      return;
    }
    const connectionInfo = this.getConnectionInfo(chainId);
    const promises = connectionInfo.rpcInfos.map((rpcInfo) => {
      const provider = this.provider(rpcInfo, chainId);
      const contract = this.getCLFactoryContract(chainId, provider);
      const blockStart = lastBlockNumber
        ? Math.min(indexerEventStatus.lastBlockNumber + 1, lastBlockNumber)
        : indexerEventStatus.lastBlockNumber + 1;
      let blockEnd = blockStart + (rpcInfo.queryBlockRange || DEFAULT_BLOCK_RANGE);
      blockEnd = Math.min(lastBlockNumber, blockEnd);
      indexerEventStatus.lastBlockNumber = blockEnd;
      return contract.queryFilter(contract.filters.PoolCreated, blockStart, blockEnd);
    });

    await this.waitFor(3000);
    try {
      const eventData = await Promise.any(promises);

      for (const eventDatum of eventData) {
        const processedBlock = await eventDatum.getBlock();
        const { pool, token0, token1, tickSpacing } = eventDatum.args;

        const token0Id = `${token0.toLowerCase()}-${chainId}`;
        const token1Id = `${token1.toLowerCase()}-${chainId}`;

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
          name: `CL-${token0Entity.symbol}/${token1Entity.symbol}`,
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
          gaugeFees0CurrentEpoch: 0,
          gaugeFees1CurrentEpoch: 0,
          gaugeFeesUSD: 0,
          poolType: PoolType.CONCENTRATED,
          createdAtBlockNumber: processedBlock.number,
          createdAtTimestamp: processedBlock.timestamp,
          tickSpacing: parseInt(tickSpacing.toString()),
        });

        await this.poolRepository.save(poolEntity);

        const statistics = await this.loadStatistics(chainId);
        statistics.totalPairsCreated = statistics.totalPairsCreated + 1;

        await this.statisticsRepository.save(statistics);

        indexerEventStatus.lastBlockNumber = processedBlock.number;
        this.updateChainMetric(chainId);
        this.eventEmitter.emit(EventTypes.CL_POOL_DEPLOYED, {
          address: pool.toLowerCase(),
          block: processedBlock.number,
          chainId,
        });
      }
    } catch (error: any) {
      this.logger.error(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        `[Chain: ${chainId}] Failed to process pool creation events → ${error.message}`,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        error.stack,
      );
      return;
    }

    await this.indexerEventStatusRepository.save(indexerEventStatus);

    await this.releaseResource(chainId);
  }
}
