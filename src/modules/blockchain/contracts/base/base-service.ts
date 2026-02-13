import { JsonRpcProvider } from 'ethers';
import { Logger } from '@nestjs/common';
import { ChainConnectionInfo, RPCInfo } from '../../interfaces';
import { Repository } from 'typeorm';
import { IndexerEventStatus } from '../../../database/entities/indexer-event-status.entity';
import { CacheService } from '../../../cache/cache.service';
import { randomUUID } from 'crypto';
import { Erc20__factory } from '../typechain';
import { RESOURCE_LOCK } from '../../../../common/variables';
import { Statistics } from '../../../database/entities/statistics.entity';

export abstract class BaseService {
  protected readonly logger = new Logger(BaseService.name);

  private readonly connectionsMap: Map<number, ChainConnectionInfo> = new Map();
  protected readonly eventsProcessed: Map<number, number> = new Map();

  protected readonly watchedAddresses: Set<string> = new Set();

  protected startTime: number;
  protected lockId: string;

  constructor(
    private readonly chainConnectionInfos: ChainConnectionInfo[],
    protected readonly cacheService: CacheService,
    protected readonly indexerEventStatusRepository: Repository<IndexerEventStatus>,
    protected readonly statisticsRepository: Repository<Statistics>,
  ) {
    this.initialize();
  }

  private initialize() {
    this.startTime = Date.now();
    this.lockId = randomUUID();
    this.chainConnectionInfos.forEach((chainConnectionInfo) => {
      const { chainId } = chainConnectionInfo;
      this.connectionsMap.set(chainId, chainConnectionInfo);
    });
  }

  protected getLatestBlockNumber(chainId: number) {
    const connectionInfo = this.connectionsMap.get(chainId);
    if (!connectionInfo) return undefined;
    const promises = connectionInfo.rpcInfos.map((rpcInfo) =>
      this.provider(rpcInfo, chainId).getBlockNumber(),
    );
    return Promise.any(promises);
  }

  protected getConnectionInfo(chainId: number) {
    const connectionInfo = this.connectionsMap.get(chainId);
    return connectionInfo || ({} as ChainConnectionInfo);
  }

  protected provider(rpcInfo: RPCInfo, chainId?: number) {
    return new JsonRpcProvider(rpcInfo.url, chainId);
  }

  protected async getERC20Metadata(address: string, chainId: number) {
    const connectionInfo = this.getConnectionInfo(chainId);
    const promises = connectionInfo.rpcInfos.map(async (rpcInfo) => {
      const provider = this.provider(rpcInfo, chainId);

      const erc20 = Erc20__factory.connect(address, provider);

      return Promise.all([erc20.decimals(), erc20.symbol(), erc20.name()]);
    });

    const [decimals, symbol, name] = await Promise.any(promises);
    return {
      decimals: parseInt(decimals.toString()),
      symbol,
      name,
    };
  }

  protected waitFor(delayInMS: number = 500) {
    return new Promise<void>((resolve) => {
      setTimeout(() => resolve(), delayInMS);
    });
  }

  protected updateChainMetric(chainId: number) {
    const currentValue = this.eventsProcessed.get(chainId) || 0;
    this.eventsProcessed.set(chainId, currentValue + 1);
  }

  private claimResource(chainId: number) {
    if (!this.cacheService.isConnected()) return true;
    const resourceKey = `${RESOURCE_LOCK}-${chainId}`;
    return this.cacheService.cache(resourceKey, this.lockId, 30, true);
  }

  protected async releaseResource(chainId: number) {
    if (!this.cacheService.isConnected()) return false;
    const resourceKey = `${RESOURCE_LOCK}-${chainId}`;
    const resourceValue = await this.cacheService.obtain<string>(resourceKey);

    if (resourceValue === this.lockId) return this.cacheService.decache(resourceKey);
    return false;
  }

  protected async haltUntilOpen(chainId: number) {
    while (true) {
      const isOpen = await this.claimResource(chainId);
      if (isOpen) {
        this.logger.log(
          `Service with lock ID ${this.lockId} has claimed processing resource on chain with ID ${chainId}`,
        );
        break;
      } else continue;
    }
  }

  getOverallMetrics() {
    const totalProcessedEvents = Array.from(this.eventsProcessed.values()).reduce(
      (accumulator, presentValue) => accumulator + presentValue,
      0,
    );
    const runTimeInSecs = (Date.now() - this.startTime) / 1000;
    return {
      processedEvents: totalProcessedEvents,
      eventsPerSeconds: Math.floor(totalProcessedEvents / runTimeInSecs),
      runTimeInMinutes: Math.fround(runTimeInSecs / 60),
    };
  }

  getMetricForChain(chainId: number) {
    const processedEvents = this.eventsProcessed.get(chainId) || 0;
    const runTimeInSecs = (Date.now() - this.startTime) / 1000;
    return {
      processedEvents,
      eventsPerSeconds: Math.floor(processedEvents / runTimeInSecs),
      runTimeInMinutes: Math.fround(runTimeInSecs / 60),
    };
  }

  protected async loadStatistics(chainId: number) {
    let statistics = await this.statisticsRepository.findOneBy({ id: `1-${chainId}` });
    if (statistics === null) {
      statistics = this.statisticsRepository.create({
        totalBribesUSD: 0,
        totalFeesUSD: 0,
        totalPairsCreated: 0,
        totalTradeVolumeETH: 0,
        totalTradeVolumeUSD: 0,
        totalVolumeLockedETH: 0,
        totalVolumeLockedUSD: 0,
        txCount: 0,
        chainId,
      });
      statistics = await this.statisticsRepository.save(statistics);
    }
    return statistics;
  }
}
