import { JsonRpcProvider } from 'ethers';
import { ChainConnectionInfo, RPCInfo } from '../interfaces';
import { Repository } from 'typeorm';
import { IndexerEventStatus } from '../../database/entities/indexer-event-status.entity';
import { DEFAULT_BLOCK_START } from '../../../common/variables';

export abstract class BaseContractService {
  private readonly connectionsMap: Map<number, ChainConnectionInfo> = new Map();
  protected CONTRACT_ADDRESSES: { [key: number]: string };
  constructor(
    private readonly chainConnectionInfos: ChainConnectionInfo[],
    protected readonly indexerEventStatusRepository: Repository<IndexerEventStatus>,
  ) {
    this.initialize();
  }

  private initialize() {
    this.chainConnectionInfos.forEach((chainConnectionInfo) => {
      const { chainId } = chainConnectionInfo;
      this.connectionsMap.set(chainId, chainConnectionInfo);
    });
  }

  protected getLatestBlockNumber(chainId: number) {
    const connectionInfo = this.connectionsMap.get(chainId);
    if (!connectionInfo) return undefined;
    const promises = connectionInfo.rpcInfos.map((rpcInfo) =>
      new JsonRpcProvider(rpcInfo.url, chainId).getBlockNumber(),
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

  protected async getIndexerEventStatus(eventName: string, chainId: number) {
    const contractAddress = this.CONTRACT_ADDRESSES[chainId].toString();
    // Find status
    const statusId = `${eventName}-${contractAddress}:${chainId}`;
    let indexerEventStatus = await this.indexerEventStatusRepository.findOneBy({
      id: statusId,
    });
    if (indexerEventStatus === null) {
      const lastBlockNumber =
        (await this.getLatestBlockNumber(chainId)) || DEFAULT_BLOCK_START;
      indexerEventStatus = this.indexerEventStatusRepository.create({
        eventName,
        chainId,
        contractAddress,
        lastBlockNumber,
      });
      indexerEventStatus =
        await this.indexerEventStatusRepository.save(indexerEventStatus);
    }
    return indexerEventStatus;
  }
}
