import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ChainIds } from '../../common/variables';
import { V2FactoryService } from '../blockchain/contracts/v2.factory.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CLFactoryService } from '../blockchain/contracts/cl.factory.service';
import { NFPMContractService } from '../blockchain/contracts/nfpm.service';
import { CacheService } from '../cache/cache.service';

@Injectable()
export class IndexerService implements OnModuleInit, OnModuleDestroy {
  private sequenceEv: boolean;
  private supportedChains = [
    ChainIds.DUSK_TESTNET,
    ChainIds.PHAROS_TESTNET,
    ChainIds.SEISMIC_TESTNET,
  ];

  private logger = new Logger(IndexerService.name);

  constructor(
    private readonly v2FactoryService: V2FactoryService,
    private readonly clFactoryService: CLFactoryService,
    private readonly nfpmService: NFPMContractService,
    private readonly cacheService: CacheService,
  ) {}

  onModuleInit() {
    this.sequenceEv = true;
    this.readAllEvents();

    process.on('SIGINT', () => {
      this.sequenceEv = false;
    });
  }

  onModuleDestroy() {
    this.sequenceEv = false;
  }

  private readAllEvents() {
    this.supportedChains.forEach((chainId) => {
      void this.readFactoryEvents(chainId);
    });
  }

  private async readFactoryEvents(chainId: number) {
    while (this.sequenceEv) {
      if (!this.cacheService.isConnected()) {
        await this.waitFor(2000);
        continue;
      }
      await this.v2FactoryService.handlePoolCreated(chainId);
      await this.clFactoryService.handlePoolCreated(chainId);
      await this.nfpmService.handleTransfer(chainId);
    }
  }

  private waitFor(delayInMS: number = 500) {
    return new Promise<void>((resolve) => {
      setTimeout(() => resolve(), delayInMS);
    });
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  logMetrics() {
    const v2FactoryMetrics = this.v2FactoryService.getOverallMetrics();
    const clFactoryMetrics = this.clFactoryService.getOverallMetrics();
    const nfpmMetrics = this.nfpmService.getOverallMetrics();
    // Log metrics

    // V2Factory
    this.logger.log(
      `📊 Metrics (V2Factory) → Processed: ${v2FactoryMetrics.processedEvents} | ` +
        `Rate: ${v2FactoryMetrics.eventsPerSeconds} evt/s | ` +
        `Runtime: ${v2FactoryMetrics.runTimeInMinutes.toFixed(2)}m`,
    );

    // CLFactory
    this.logger.log(
      `📊 Metrics (CLFactory) → Processed: ${clFactoryMetrics.processedEvents} | ` +
        `Rate: ${clFactoryMetrics.eventsPerSeconds} evt/s | ` +
        `Runtime: ${clFactoryMetrics.runTimeInMinutes.toFixed(2)}m`,
    );

    // NFPM
    this.logger.log(
      `📊 Metrics (NFPM) → Processed: ${nfpmMetrics.processedEvents} | ` +
        `Rate: ${nfpmMetrics.eventsPerSeconds} evt/s | ` +
        `Runtime: ${nfpmMetrics.runTimeInMinutes.toFixed(2)}m`,
    );
  }
}
