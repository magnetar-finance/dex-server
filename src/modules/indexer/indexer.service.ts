import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ChainIds } from '../../common/variables';
import { V2FactoryService } from '../blockchain/contracts/v2.factory.service';

@Injectable()
export class IndexerService implements OnModuleInit, OnModuleDestroy {
  private sequenceEv: boolean;
  private supportedChains = [ChainIds.DUSK_TESTNET, ChainIds.PHAROS_TESTNET];

  constructor(private readonly v2FactoryService: V2FactoryService) {}

  onModuleInit() {
    this.sequenceEv = true;
    this.readAllEvents();
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
}
