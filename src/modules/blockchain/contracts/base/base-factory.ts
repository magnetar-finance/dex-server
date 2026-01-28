import { ChainConnectionInfo } from '../../interfaces';
import { Repository } from 'typeorm';
import { IndexerEventStatus } from '../../../database/entities/indexer-event-status.entity';
import { DEFAULT_BLOCK_START } from '../../../../common/variables';
import { CacheService } from '../../../cache/cache.service';
import { BaseService } from './base-service';
import { Statistics } from '../../../database/entities/statistics.entity';

export abstract class BaseFactoryContractService extends BaseService {
  protected CONTRACT_ADDRESSES: { [key: number]: string };
  protected START_BLOCKS: { [key: number]: number };
  constructor(
    chainConnectionInfos: ChainConnectionInfo[],
    cacheService: CacheService,
    indexerEventStatusRepository: Repository<IndexerEventStatus>,
    statisticsRepository: Repository<Statistics>,
  ) {
    super(chainConnectionInfos, cacheService, indexerEventStatusRepository, statisticsRepository);
  }

  protected async getIndexerEventStatus(eventName: string, chainId: number) {
    const contractAddress = this.CONTRACT_ADDRESSES[chainId].toLowerCase();
    // Find status
    const statusId = `${eventName}-${contractAddress}:${chainId}`;
    let indexerEventStatus = await this.indexerEventStatusRepository.findOneBy({
      id: statusId,
    });
    if (indexerEventStatus === null) {
      const lastBlockNumber = this.START_BLOCKS[chainId] || DEFAULT_BLOCK_START;
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
