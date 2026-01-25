import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { BaseFactoryDeployedContractService } from './base/base-factory-deployed';
import {
  CONNECTION_INFO,
  DEFAULT_BLOCK_RANGE,
} from '../../../common/variables';
import { InjectRepository } from '@nestjs/typeorm';
import { CacheService } from '../../cache/cache.service';
import { IndexerEventStatus } from '../../database/entities/indexer-event-status.entity';
import { Pool, PoolType } from '../../database/entities/pool.entity';
import { Token } from '../../database/entities/token.entity';
import { Equal, Or, Repository } from 'typeorm';
import { ChainConnectionInfo } from '../interfaces';
import { OnEvent } from '@nestjs/event-emitter';
import { type ContractDeployEventPayload, EventTypes } from './types';
import { V2Pool, V2Pool__factory } from './typechain';
import { JsonRpcProvider } from 'ethers';
import { Transaction } from '../../database/entities/transaction.entity';
import { Mint } from '../../database/entities/mint.entity';
import { Burn } from '../../database/entities/burn.entity';
import { Swap } from '../../database/entities/swap.entity';

interface IResolvableTransaction {
  chainId: number;
  hash: string;
}

interface IResolvableMintTransaction extends IResolvableTransaction {
  sender: string;
  amount0: bigint;
  amount1: bigint;
}

interface IResolvableTransferTransaction extends IResolvableTransaction {
  token: string;
  from: string;
  to: string;
  amount: bigint;
}

@Injectable()
export class V2PoolService
  extends BaseFactoryDeployedContractService
  implements OnModuleInit
{
  constructor(
    @Inject(CONNECTION_INFO) connectionInfo: ChainConnectionInfo[],
    cacheService: CacheService,
    @InjectRepository(IndexerEventStatus)
    repository: Repository<IndexerEventStatus>,
    @InjectRepository(Token)
    private readonly tokenRepository: Repository<Token>,
    @InjectRepository(Pool) private readonly poolRepository: Repository<Pool>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    @InjectRepository(Mint) private readonly mintRepository: Repository<Mint>,
    @InjectRepository(Burn) private readonly burnRepository: Repository<Burn>,
    @InjectRepository(Swap) private readonly swapRepository: Repository<Swap>,
  ) {
    super(connectionInfo, cacheService, repository);
  }

  async onModuleInit() {
    await this.initializeWatchedAddresses();
  }

  private async initializeWatchedAddresses() {
    const pools = await this.poolRepository.findBy({
      poolType: Or(Equal(PoolType.STABLE), Equal(PoolType.VOLATILE)),
    });

    // Watch pools
    pools.forEach((pool) => {
      this.WATCHED_ADDRESSES.add(pool.address.toLowerCase());
    });
  }

  private getContract(address: string, provider: JsonRpcProvider): V2Pool {
    return V2Pool__factory.connect(address, provider);
  }

  private async handleMint(address: string, chainId: number) {
    await this.haltUntilOpen(chainId);
    const lastBlockNumber = await this.getLatestBlockNumber(chainId);

    const indexerEventStatus = await this.getIndexerEventStatus(
      address,
      'Mint',
      chainId,
    );

    const connectionInfo = this.getConnectionInfo(chainId);
    const promises = connectionInfo.rpcInfos.map((rpcInfo) => {
      const provider = this.provider(rpcInfo, chainId);
      const contract = this.getContract(address, provider);
      const blockStart = lastBlockNumber
        ? Math.min(indexerEventStatus.lastBlockNumber + 1, lastBlockNumber)
        : indexerEventStatus.lastBlockNumber + 1;
      const blockEnd =
        blockStart + (rpcInfo.queryBlockRange || DEFAULT_BLOCK_RANGE);
      indexerEventStatus.lastBlockNumber = lastBlockNumber
        ? Math.min(blockEnd, lastBlockNumber)
        : blockEnd; // We still want to update last processed block even if no data is available.
      return contract.queryFilter(contract.filters.Mint, blockStart, blockEnd);
    });

    // Wait for 3 secs
    await this.waitFor(3000);
    const eventData = await Promise.any(promises);

    for (const eventDatum of eventData) {
      const processedBlock = await eventDatum.getBlock();
      const { amount0, amount1, sender } = eventDatum.args;
      // Transaction
      const transactionId = `${eventDatum.transactionHash.toLowerCase()}-${chainId}`;
      let transactionEntity = await this.transactionRepository.findOneBy({
        id: transactionId,
      });
      if (transactionEntity === null) {
        transactionEntity = this.transactionRepository.create({
          hash: eventDatum.transactionHash.toLowerCase(),
          block: processedBlock.number,
          timestamp: processedBlock.timestamp,
          chainId,
        });

        transactionEntity =
          await this.transactionRepository.save(transactionEntity);
      }

      // @author Kingsley Victor
      // Why this is needed: I am imagining situations where some dependent events are processed ahead of others (depends on the block range of the selected RPC provider though).
      // For context, the Transfer event and the Mint event are emitted on the same transaction with the former coming first. The transfer event harbours data that we would need on the mint event table. I imagine that there are hypothetical scenarios where the mint event is processed before the transfer event, but we want to ensure integrity on the mint table, so we cache the result of the procession and do a look-up at a latter time against a cache for the transfer event
      const resolvableMint: IResolvableMintTransaction = {
        sender,
        amount0,
        amount1,
        chainId,
        hash: transactionEntity.hash,
      };

      await this.cacheService.hCache(
        'mint',
        resolvableMint.hash,
        resolvableMint,
      );
    }

    await this.indexerEventStatusRepository.update(
      { id: indexerEventStatus.id },
      indexerEventStatus,
    );
    await this.releaseResource(chainId);
  }

  private async sequenceEvents(address: string, chainId: number) {}

  @OnEvent(EventTypes.V2_POOL_DEPLOYED)
  handleV2PoolDeployed(payload: ContractDeployEventPayload) {
    this.ADDRESS_DEPLOYMENT_BLOCK[payload.address] = payload.block;
    this.watchedAddresses.add(payload.address);
    void this.sequenceEvents(payload.address, payload.chainId);
  }
}
