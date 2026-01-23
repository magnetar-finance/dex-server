import { Inject, Injectable } from '@nestjs/common';
import { BaseContractService } from './base';
import { ChainConnectionInfo } from '../interfaces';
import { Factory, Factory__factory } from './typechain';
import { JsonRpcProvider } from 'ethers';
import {
  ChainIds,
  CONNECTION_INFO,
  DEFAULT_BLOCK_RANGE,
} from '../../../common/variables';
import { InjectRepository } from '@nestjs/typeorm';
import { IndexerEventStatus } from '../../database/entities/indexer-event-status.entity';
import { Repository } from 'typeorm';

@Injectable()
export class V2FactoryService extends BaseContractService {
  constructor(
    @Inject(CONNECTION_INFO) connectionInfo: ChainConnectionInfo[],
    @InjectRepository(IndexerEventStatus)
    repository: Repository<IndexerEventStatus>,
  ) {
    super(connectionInfo, repository);
    this.initializeContracts();
  }

  private initializeContracts() {
    this.CONTRACT_ADDRESSES = {
      [ChainIds.DUSK_TESTNET]: '0xE41d241720FEE7cD6BDfA9aB3204d23687703CD5',
      [ChainIds.PHAROS_TESTNET]: '0x68D81F61b88c2622A590719f956f5Dc253a1dC3d',
    };
  }

  private getContract(chainId: number, provider: JsonRpcProvider): Factory {
    const contractAddress = this.CONTRACT_ADDRESSES[chainId];
    return Factory__factory.connect(contractAddress, provider);
  }

  async handlePoolCreated(chainId: number) {
    const indexerEventStatus = await this.getIndexerEventStatus(
      'PoolCreated',
      chainId,
    );
    const connectionInfo = this.getConnectionInfo(chainId);
    const promises = connectionInfo.rpcInfos.map((rpcInfo) => {
      const provider = this.provider(rpcInfo, chainId);
      const contract = this.getContract(chainId, provider);
      const blockStart = indexerEventStatus.lastBlockNumber + 1;
      const blockEnd =
        blockStart + (rpcInfo.queryBlockRange || DEFAULT_BLOCK_RANGE);
      return contract.queryFilter(
        contract.filters.PoolCreated,
        blockStart,
        blockEnd,
      );
    });

    const eventData = await Promise.any(promises);

    for (const eventDatum of eventData) {
      const processedBlock = eventDatum.blockNumber;
      const { pool, token0, token1, stable } = eventDatum.args;

      // Update indexer status
      indexerEventStatus.lastBlockNumber = processedBlock;
      await this.indexerEventStatusRepository.update(
        { id: indexerEventStatus.id },
        indexerEventStatus,
      );
    }
  }
}
