import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ChainIds } from '../../common/variables';
import { V2FactoryService } from '../blockchain/contracts/v2.factory.service';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class IndexerService implements OnModuleInit, OnModuleDestroy {
  private sequenceEv: boolean;
  private supportedChains = [ChainIds.DUSK_TESTNET, ChainIds.PHAROS_TESTNET];

  private logger = new Logger(IndexerService.name);

  constructor(private readonly v2FactoryService: V2FactoryService) {}

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
    }
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  logMetrics() {
    const v2FactoryMetrics = this.v2FactoryService.getOverallMetrics();
    this.logger.debug(`V2Factory metrics: ${JSON.stringify(v2FactoryMetrics)}`);
  }
}
