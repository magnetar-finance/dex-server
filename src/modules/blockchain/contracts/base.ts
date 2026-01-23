import { JsonRpcProvider } from 'ethers';
import { ChainConnectionInfo, RPCInfo } from '../interfaces';
import { Repository } from 'typeorm';
import { IndexerEventStatus } from '../../database/entities/indexer-event-status.entity';
import { DEFAULT_BLOCK_START } from '../../../common/variables';
import { Erc20__factory } from './typechain';

export abstract class BaseContractService {
  private readonly connectionsMap: Map<number, ChainConnectionInfo> = new Map();
  protected readonly eventsProcessed: Map<number, number> = new Map();
  protected readonly lastProcessedBlock: Map<number, number> = new Map();

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

  protected async getERC20Metadata(address: string, chainId: number) {
    const connectionInfo = this.getConnectionInfo(chainId);
    const promises = connectionInfo.rpcInfos.map(async (rpcInfo) => {
      const provider = this.provider(rpcInfo, chainId);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const erc20 = Erc20__factory.connect(address, provider);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      return Promise.all([erc20.decimals(), erc20.symbol(), erc20.name()]);
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const [decimals, symbol, name] = await Promise.any(promises);
    return {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      decimals: parseInt(decimals.toString()),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      symbol,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      name,
    };
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

  protected waitFor(delayInMS: number = 500) {
    return new Promise<void>((resolve) => {
      setTimeout(() => resolve(), delayInMS);
    });
  }

  getMetricForChain(chainId: number) {
    const eventCounts = this.eventsProcessed.get(chainId) || 0;
    const lastProcessedBlock = this.lastProcessedBlock.get(chainId) || 0;
    return { eventCounts, lastProcessedBlock };
  }
}
