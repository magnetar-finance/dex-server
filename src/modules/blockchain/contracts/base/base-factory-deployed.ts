import { Logger } from '@nestjs/common';
import { ChainConnectionInfo } from '../../interfaces';
import { Repository } from 'typeorm';
import { IndexerEventStatus } from '../../../database/entities/indexer-event-status.entity';
import { CacheService } from '../../../cache/cache.service';
import { BaseService } from './base-service';
import { DEFAULT_BLOCK_START } from '../../../../common/variables';
import { Statistics } from '../../../database/entities/statistics.entity';

export abstract class BaseFactoryDeployedContractService extends BaseService {
  protected readonly logger = new Logger(BaseFactoryDeployedContractService.name);
  protected readonly WATCHED_ADDRESSES: Set<string> = new Set();
  protected readonly WATCHED_ADDRESSES_CHAINS: Map<string, number> = new Map();
  protected readonly ADDRESS_DEPLOYMENT_BLOCK: Record<string, number> = {};

  constructor(
    chainConnectionInfos: ChainConnectionInfo[],
    cacheService: CacheService,
    indexerEventStatusRepository: Repository<IndexerEventStatus>,
    statisticsRepository: Repository<Statistics>,
  ) {
    super(chainConnectionInfos, cacheService, indexerEventStatusRepository, statisticsRepository);
  }

  protected async getIndexerEventStatus(address: string, eventName: string, chainId: number) {
    const contractAddress = address.toLowerCase();
    // Find status
    const statusId = `${eventName}-${contractAddress}:${chainId}`;
    let indexerEventStatus = await this.indexerEventStatusRepository.findOneBy({
      id: statusId,
    });
    if (indexerEventStatus === null) {
      const lastBlockNumber = this.ADDRESS_DEPLOYMENT_BLOCK[contractAddress] || DEFAULT_BLOCK_START;
      indexerEventStatus = this.indexerEventStatusRepository.create({
        eventName,
        chainId,
        contractAddress,
        lastBlockNumber,
      });
      indexerEventStatus = await this.indexerEventStatusRepository.save(indexerEventStatus);
    }
    return indexerEventStatus;
  }
}
