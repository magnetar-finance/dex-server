import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ChainIds } from '../../common/variables';
import { V2FactoryService } from '../blockchain/contracts/v2.factory.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CLFactoryService } from '../blockchain/contracts/cl.factory.service';

@Injectable()
export class IndexerService implements OnModuleInit, OnModuleDestroy {
  private sequenceEv: boolean;
  private supportedChains = [ChainIds.DUSK_TESTNET, ChainIds.PHAROS_TESTNET];

  private logger = new Logger(IndexerService.name);

  constructor(
    private readonly v2FactoryService: V2FactoryService,
    private readonly clFactoryService: CLFactoryService,
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
      await this.v2FactoryService.handlePoolCreated(chainId);
      await this.clFactoryService.handlePoolCreated(chainId);
    }
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  logMetrics() {
    const v2FactoryMetrics = this.v2FactoryService.getOverallMetrics();
    const clFactoryMetrics = this.clFactoryService.getOverallMetrics();
    this.logger.debug(`V2Factory metrics: ${JSON.stringify(v2FactoryMetrics)}`);
    this.logger.debug(`CLFactory metrics: ${JSON.stringify(clFactoryMetrics)}`);
  }
}
