import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BaseFactoryDeployedContractService } from './base/base-factory-deployed';
import { CONNECTION_INFO, DEFAULT_BLOCK_RANGE } from '../../../common/variables';
import { InjectRepository } from '@nestjs/typeorm';
import { CacheService } from '../../cache/cache.service';
import { IndexerEventStatus } from '../../database/entities/indexer-event-status.entity';
import { Pool, PoolType } from '../../database/entities/pool.entity';
import { Token } from '../../database/entities/token.entity';
import { Equal, ILike, Or, Repository } from 'typeorm';
import { ChainConnectionInfo } from '../interfaces';
import { OnEvent } from '@nestjs/event-emitter';
import { type ContractDeployEventPayload, EventTypes } from './types';
import { V2Pool, V2Pool__factory } from './typechain';
import { formatEther, formatUnits, JsonRpcProvider } from 'ethers';
import { Transaction } from '../../database/entities/transaction.entity';
import { Mint } from '../../database/entities/mint.entity';
import { Burn } from '../../database/entities/burn.entity';
import { Swap } from '../../database/entities/swap.entity';
import { OracleService } from './utilities/oracle.service';
import { PoolDayData } from '../../database/entities/pool-day-data.entity';
import { PoolHourData } from '../../database/entities/pool-hour-data.entity';
import { OverallDayData } from '../../database/entities/overall-day-data.entity';
import { Statistics } from '../../database/entities/statistics.entity';
import { TokenDayData } from '../../database/entities/token-day-data.entity';
import { LiquidityPosition } from '../../database/entities/lp-position.entity';
import { User } from '../../database/entities/user.entity';

interface IResolvableTransaction {
  chainId: number;
  hash: string;
  logIndex: number;
  sender: string;
}

interface IResolvableMintTransaction extends IResolvableTransaction {
  amount0: string;
  amount1: string;
}

interface IResolvableBurnTransaction extends IResolvableTransaction {
  amount0: string;
  amount1: string;
}

interface IResolvableTransferTransaction extends IResolvableTransaction {
  token: string;
  from: string;
  to: string;
  amount: string;
}

interface IResolvableSwapTransaction extends IResolvableTransaction {
  from: string;
  to: string;
  amount0In: string;
  amount1In: string;
  amount0Out: string;
  amount1Out: string;
  token: string;
}

@Injectable()
export class V2PoolService
  extends BaseFactoryDeployedContractService
  implements OnModuleInit, OnModuleDestroy
{
  private sequenceEv: boolean = false;

  constructor(
    @Inject(CONNECTION_INFO) connectionInfo: ChainConnectionInfo[],
    cacheService: CacheService,
    @InjectRepository(IndexerEventStatus)
    repository: Repository<IndexerEventStatus>,
    @InjectRepository(Statistics) statisticsRepository: Repository<Statistics>,
    @InjectRepository(Token)
    private readonly tokenRepository: Repository<Token>,
    @InjectRepository(Pool) private readonly poolRepository: Repository<Pool>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    @InjectRepository(Mint) private readonly mintRepository: Repository<Mint>,
    @InjectRepository(Burn) private readonly burnRepository: Repository<Burn>,
    @InjectRepository(Swap) private readonly swapRepository: Repository<Swap>,
    @InjectRepository(PoolDayData)
    private readonly poolDayDataRepository: Repository<PoolDayData>,
    @InjectRepository(PoolHourData)
    private readonly poolHourDataRepository: Repository<PoolHourData>,
    @InjectRepository(OverallDayData)
    private readonly overallDayDataRepository: Repository<OverallDayData>,
    @InjectRepository(TokenDayData)
    private readonly tokenDayDataRepository: Repository<TokenDayData>,
    @InjectRepository(LiquidityPosition)
    private readonly liquidityPositionRepository: Repository<LiquidityPosition>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly oracle: OracleService,
  ) {
    super(connectionInfo, cacheService, repository, statisticsRepository);
  }

  async onModuleInit() {
    await this.initializeWatchedAddresses();

    this.sequenceEv = true;
    this.sequenceAllEventsAndResolveTxs();

    process.on('SIGINT', () => {
      this.sequenceEv = false;
    });
  }

  onModuleDestroy() {
    this.sequenceEv = false;
    this.WATCHED_ADDRESSES.clear();
    this.WATCHED_ADDRESSES_CHAINS.clear();
  }

  private async initializeWatchedAddresses() {
    const pools = await this.poolRepository.findBy({
      poolType: Or(Equal(PoolType.STABLE), Equal(PoolType.VOLATILE)),
    });

    pools.forEach((pool) => {
      this.WATCHED_ADDRESSES.add(pool.address.toLowerCase());
      this.WATCHED_ADDRESSES_CHAINS.set(pool.address.toLowerCase(), pool.chainId);
    });
  }

  private getV2PoolContract(address: string, provider: JsonRpcProvider): V2Pool {
    return V2Pool__factory.connect(address, provider);
  }

  private async handleMint(address: string, chainId: number) {
    this.logger.log(`[Chain: ${chainId}] Now sequencing LP mint event`);
    if (!this.cacheService.isConnected()) return;
    await this.haltUntilOpen(chainId);

    let lastBlockNumber: number | undefined;

    try {
      this.logger.log(`[Chain: ${chainId}] Fetching latest block number`);
      lastBlockNumber = await this.getLatestBlockNumber(chainId);
    } catch (error: any) {
      await this.releaseResource(chainId);
      this.logger.error(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        `[Chain: ${chainId}] Unable to fetch latest block → ${error.message}`,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        error.stack,
      );
    }

    if (typeof lastBlockNumber === 'undefined') return;

    const indexerEventStatus = await this.getIndexerEventStatus(address, 'Mint', chainId);

    if (indexerEventStatus.lastBlockNumber >= lastBlockNumber) {
      this.logger.log(`[Indexer: ${indexerEventStatus.id}] Already at current block. Skipping...`);
      await this.releaseResource(chainId);
      return;
    }

    const connectionInfo = this.getConnectionInfo(chainId);
    const promises = connectionInfo.rpcInfos.map((rpcInfo) => {
      const provider = this.provider(rpcInfo, chainId);
      const contract = this.getV2PoolContract(address, provider);
      const blockStart = lastBlockNumber
        ? Math.min(indexerEventStatus.lastBlockNumber + 1, lastBlockNumber)
        : indexerEventStatus.lastBlockNumber + 1;
      let blockEnd = blockStart + (rpcInfo.queryBlockRange || DEFAULT_BLOCK_RANGE);
      blockEnd = Math.min(lastBlockNumber, blockEnd);
      indexerEventStatus.lastBlockNumber = blockEnd;
      return contract.queryFilter(contract.filters.Mint, blockStart, blockEnd);
    });

    await this.waitFor(3000);
    const eventData = await Promise.any(promises);

    for (const eventDatum of eventData) {
      await this.waitFor(2000);
      const processedBlock = await eventDatum.getBlock();
      const { amount0, amount1, sender } = eventDatum.args;
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

        transactionEntity = await this.transactionRepository.save(transactionEntity);
      }

      // @author Kingsley Victor
      // Why this is needed: I am imagining situations where some dependent events are processed ahead of others (depends on the block range of the selected RPC provider though).
      // For context, the Transfer event and the Mint event are emitted on the same transaction with the former coming first. The transfer event harbours data that we would need on the mint event table. I imagine that there are hypothetical scenarios where the mint event is processed before the transfer event, but we want to ensure integrity on the mint table, so we cache the result of the procession and do a look-up at a latter time against a cache for the transfer event
      const resolvableMint: IResolvableMintTransaction = {
        sender,
        amount0: amount0.toString(),
        amount1: amount1.toString(),
        chainId,
        hash: transactionEntity.hash,
        logIndex: eventDatum.index,
      };

      await this.cacheService.hCache('mint', resolvableMint.hash, resolvableMint);

      this.updateChainMetric(chainId);
    }

    await this.indexerEventStatusRepository.save(indexerEventStatus);
    await this.releaseResource(chainId);
  }

  private async handleBurn(address: string, chainId: number) {
    this.logger.log(`[Chain: ${chainId}] Now sequencing LP burn event`);
    if (!this.cacheService.isConnected()) return;
    await this.haltUntilOpen(chainId);

    let lastBlockNumber: number | undefined;

    try {
      this.logger.log(`[Chain: ${chainId}] Fetching latest block number`);
      lastBlockNumber = await this.getLatestBlockNumber(chainId);
    } catch (error: any) {
      await this.releaseResource(chainId);
      this.logger.error(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        `[Chain: ${chainId}] Unable to fetch latest block → ${error.message}`,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        error.stack,
      );
    }

    if (typeof lastBlockNumber === 'undefined') return;

    const indexerEventStatus = await this.getIndexerEventStatus(address, 'Burn', chainId);

    if (indexerEventStatus.lastBlockNumber >= lastBlockNumber) {
      this.logger.log(`[Indexer: ${indexerEventStatus.id}] Already at current block. Skipping...`);
      await this.releaseResource(chainId);
      return;
    }

    const connectionInfo = this.getConnectionInfo(chainId);
    const promises = connectionInfo.rpcInfos.map((rpcInfo) => {
      const provider = this.provider(rpcInfo, chainId);
      const contract = this.getV2PoolContract(address, provider);
      const blockStart = lastBlockNumber
        ? Math.min(indexerEventStatus.lastBlockNumber + 1, lastBlockNumber)
        : indexerEventStatus.lastBlockNumber + 1;
      let blockEnd = blockStart + (rpcInfo.queryBlockRange || DEFAULT_BLOCK_RANGE);
      blockEnd = Math.min(lastBlockNumber, blockEnd);
      indexerEventStatus.lastBlockNumber = blockEnd;
      return contract.queryFilter(contract.filters.Burn, blockStart, blockEnd);
    });

    await this.waitFor(3000);
    const eventData = await Promise.any(promises);

    for (const eventDatum of eventData) {
      await this.waitFor(2000);
      const processedBlock = await eventDatum.getBlock();
      const { amount0, amount1, sender } = eventDatum.args;
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

        transactionEntity = await this.transactionRepository.save(transactionEntity);
      }

      // @author Kingsley Victor
      // Why this is needed: I am imagining situations where some dependent events are processed ahead of others (depends on the block range of the selected RPC provider though).
      // For context, the Transfer event and the Mint event are emitted on the same transaction with the former coming first. The transfer event harbours data that we would need on the mint event table. I imagine that there are hypothetical scenarios where the mint event is processed before the transfer event, but we want to ensure integrity on the mint table, so we cache the result of the procession and do a look-up at a latter time against a cache for the transfer event
      const resolvableBurn: IResolvableBurnTransaction = {
        sender,
        amount0: amount0.toString(),
        amount1: amount1.toString(),
        chainId,
        hash: transactionEntity.hash,
        logIndex: eventDatum.index,
      };

      await this.cacheService.hCache('burn', resolvableBurn.hash, resolvableBurn);
      this.updateChainMetric(chainId);
    }

    await this.indexerEventStatusRepository.save(indexerEventStatus);
    await this.releaseResource(chainId);
  }

  private async handleTransfer(address: string, chainId: number) {
    this.logger.log(`[Chain: ${chainId}] Now sequencing LP transfer event`);
    if (!this.cacheService.isConnected()) return;
    await this.haltUntilOpen(chainId);

    let lastBlockNumber: number | undefined;

    try {
      this.logger.log(`[Chain: ${chainId}] Fetching latest block number`);
      lastBlockNumber = await this.getLatestBlockNumber(chainId);
    } catch (error: any) {
      await this.releaseResource(chainId);
      this.logger.error(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        `[Chain: ${chainId}] Unable to fetch latest block → ${error.message}`,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        error.stack,
      );
    }

    if (typeof lastBlockNumber === 'undefined') return;

    const indexerEventStatus = await this.getIndexerEventStatus(address, 'Transfer', chainId);

    if (indexerEventStatus.lastBlockNumber >= lastBlockNumber) {
      this.logger.log(`[Indexer: ${indexerEventStatus.id}] Already at current block. Skipping...`);
      await this.releaseResource(chainId);
      return;
    }

    const connectionInfo = this.getConnectionInfo(chainId);
    const promises = connectionInfo.rpcInfos.map((rpcInfo) => {
      const provider = this.provider(rpcInfo, chainId);
      const contract = this.getV2PoolContract(address, provider);
      const blockStart = lastBlockNumber
        ? Math.min(indexerEventStatus.lastBlockNumber + 1, lastBlockNumber)
        : indexerEventStatus.lastBlockNumber + 1;
      let blockEnd = blockStart + (rpcInfo.queryBlockRange || DEFAULT_BLOCK_RANGE);
      blockEnd = Math.min(lastBlockNumber, blockEnd);
      indexerEventStatus.lastBlockNumber = blockEnd;
      return contract.queryFilter(contract.filters.Transfer, blockStart, blockEnd);
    });

    await this.waitFor(3000);
    const eventData = await Promise.any(promises);

    for (const eventDatum of eventData) {
      await this.waitFor(2000);
      const processedBlock = await eventDatum.getBlock();
      const transaction = await eventDatum.getTransaction();
      const { from, to, value } = eventDatum.args;
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

        transactionEntity = await this.transactionRepository.save(transactionEntity);
      }

      // @author Kingsley Victor
      // Why this is needed: I am imagining situations where some dependent events are processed ahead of others (depends on the block range of the selected RPC provider though).
      // For context, the Transfer event and the Mint event are emitted on the same transaction with the former coming first. The transfer event harbours data that we would need on the mint event table. I imagine that there are hypothetical scenarios where the mint event is processed before the transfer event, but we want to ensure integrity on the mint table, so we cache the result of the procession and do a look-up at a latter time against a cache for the transfer event
      const resolvableTransfer: IResolvableTransferTransaction = {
        from,
        to,
        token: address.toLowerCase(),
        chainId,
        hash: transactionEntity.hash,
        amount: value.toString(),
        logIndex: eventDatum.index,
        sender: transaction.from,
      };

      await this.cacheService.hCache('transfer', resolvableTransfer.hash, resolvableTransfer);
      this.updateChainMetric(chainId);
    }

    await this.indexerEventStatusRepository.save(indexerEventStatus);
    await this.releaseResource(chainId);
  }

  private async handleSwap(address: string, chainId: number) {
    this.logger.log(`[Chain: ${chainId}] Now sequencing LP swap event`);
    if (!this.cacheService.isConnected()) return;
    await this.haltUntilOpen(chainId);

    let lastBlockNumber: number | undefined;

    try {
      this.logger.log(`[Chain: ${chainId}] Fetching latest block number`);
      lastBlockNumber = await this.getLatestBlockNumber(chainId);
    } catch (error: any) {
      await this.releaseResource(chainId);
      this.logger.error(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        `[Chain: ${chainId}] Unable to fetch latest block → ${error.message}`,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        error.stack,
      );
    }

    if (typeof lastBlockNumber === 'undefined') return;

    const indexerEventStatus = await this.getIndexerEventStatus(address, 'Swap', chainId);

    if (indexerEventStatus.lastBlockNumber >= lastBlockNumber) {
      this.logger.log(`[Indexer: ${indexerEventStatus.id}] Already at current block. Skipping...`);
      await this.releaseResource(chainId);
      return;
    }

    const connectionInfo = this.getConnectionInfo(chainId);
    const promises = connectionInfo.rpcInfos.map((rpcInfo) => {
      const provider = this.provider(rpcInfo, chainId);
      const contract = this.getV2PoolContract(address, provider);
      const blockStart = lastBlockNumber
        ? Math.min(indexerEventStatus.lastBlockNumber + 1, lastBlockNumber)
        : indexerEventStatus.lastBlockNumber + 1;
      let blockEnd = blockStart + (rpcInfo.queryBlockRange || DEFAULT_BLOCK_RANGE);
      blockEnd = Math.min(lastBlockNumber, blockEnd);
      indexerEventStatus.lastBlockNumber = blockEnd;
      return contract.queryFilter(contract.filters.Swap, blockStart, blockEnd);
    });

    await this.waitFor(3000);
    const eventData = await Promise.any(promises);

    for (const eventDatum of eventData) {
      await this.waitFor(2000);
      const processedBlock = await eventDatum.getBlock();
      const { sender, to, amount0In, amount1In, amount0Out, amount1Out } = eventDatum.args;
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

        transactionEntity = await this.transactionRepository.save(transactionEntity);
      }

      // @author Kingsley Victor
      // Why this is needed: I am imagining situations where some dependent events are processed ahead of others (depends on the block range of the selected RPC provider though).
      // For context, the Transfer event and the Mint event are emitted on the same transaction with the former coming first. The transfer event harbours data that we would need on the mint event table. I imagine that there are hypothetical scenarios where the mint event is processed before the transfer event, but we want to ensure integrity on the mint table, so we cache the result of the procession and do a look-up at a latter time against a cache for the transfer event
      const resolvableSwap: IResolvableSwapTransaction = {
        from: sender,
        to,
        token: address.toLowerCase(),
        chainId,
        hash: transactionEntity.hash,
        amount0In: amount0In.toString(),
        amount1In: amount1In.toString(),
        amount0Out: amount0Out.toString(),
        amount1Out: amount1Out.toString(),
        logIndex: eventDatum.index,
        sender,
      };

      await this.cacheService.hCache('swap', resolvableSwap.hash, resolvableSwap);
      this.updateChainMetric(chainId);
    }

    await this.indexerEventStatusRepository.save(indexerEventStatus);
    await this.releaseResource(chainId);
  }

  private async handleSync(address: string, chainId: number) {
    this.logger.log(`[Chain: ${chainId}] Now sequencing LP sync event`);
    if (!this.cacheService.isConnected()) return;
    await this.haltUntilOpen(chainId);

    let lastBlockNumber: number | undefined;

    try {
      this.logger.log(`[Chain: ${chainId}] Fetching latest block number`);
      lastBlockNumber = await this.getLatestBlockNumber(chainId);
    } catch (error: any) {
      await this.releaseResource(chainId);
      this.logger.error(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        `[Chain: ${chainId}] Unable to fetch latest block → ${error.message}`,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        error.stack,
      );
    }

    if (typeof lastBlockNumber === 'undefined') return;

    const indexerEventStatus = await this.getIndexerEventStatus(address, 'Sync', chainId);

    if (indexerEventStatus.lastBlockNumber >= lastBlockNumber) {
      this.logger.log(`[Indexer: ${indexerEventStatus.id}] Already at current block. Skipping...`);
      await this.releaseResource(chainId);
      return;
    }

    const connectionInfo = this.getConnectionInfo(chainId);
    const promises = connectionInfo.rpcInfos.map((rpcInfo) => {
      const provider = this.provider(rpcInfo, chainId);
      const contract = this.getV2PoolContract(address, provider);
      const blockStart = lastBlockNumber
        ? Math.min(indexerEventStatus.lastBlockNumber + 1, lastBlockNumber)
        : indexerEventStatus.lastBlockNumber + 1;
      let blockEnd = blockStart + (rpcInfo.queryBlockRange || DEFAULT_BLOCK_RANGE);
      blockEnd = Math.min(lastBlockNumber, blockEnd);
      indexerEventStatus.lastBlockNumber = blockEnd;
      return contract.queryFilter(contract.filters.Sync, blockStart, blockEnd);
    });

    await this.waitFor(3000);
    const eventData = await Promise.any(promises);

    for (const eventDatum of eventData) {
      const { reserve0, reserve1 } = eventDatum.args;
      const poolId = `${address.toLowerCase()}-${chainId}`;
      const poolEntity = await this.poolRepository.findOneOrFail({
        where: { id: poolId },
        relations: { token0: true, token1: true },
      });

      await this.waitFor(2000);
      const token0 = await this.loadTokenPrice(poolEntity.token0);
      const token1 = await this.loadTokenPrice(poolEntity.token1);

      const statistics = await this.loadStatistics(chainId);
      statistics.totalVolumeLockedETH = statistics.totalVolumeLockedETH - poolEntity.reserveETH;

      token0.totalLiquidity = token0.totalLiquidity - poolEntity.reserve0;
      token1.totalLiquidity = token1.totalLiquidity - poolEntity.reserve1;

      poolEntity.reserve0 = parseFloat(formatUnits(reserve0, token0.decimals));
      poolEntity.reserve1 = parseFloat(formatUnits(reserve1, token1.decimals));

      if (poolEntity.reserve1 > 0)
        poolEntity.token0Price = poolEntity.reserve0 / poolEntity.reserve1;
      else poolEntity.token0Price = 0;

      if (poolEntity.reserve0 > 0)
        poolEntity.token1Price = poolEntity.reserve1 / poolEntity.reserve0;
      else poolEntity.token1Price = 0;

      poolEntity.reserveETH =
        poolEntity.reserve0 * token0.derivedETH + poolEntity.reserve1 * token1.derivedETH;
      poolEntity.reserveUSD =
        poolEntity.reserve0 * token0.derivedUSD + poolEntity.reserve1 * token1.derivedUSD;

      statistics.totalVolumeLockedETH = statistics.totalVolumeLockedETH + poolEntity.reserveETH;
      statistics.totalVolumeLockedUSD = statistics.totalVolumeLockedUSD + poolEntity.reserveUSD;

      token0.totalLiquidity = token0.totalLiquidity + poolEntity.reserve0;
      token0.totalLiquidityETH = token0.totalLiquidity * token0.derivedETH;
      token0.totalLiquidityUSD = token0.totalLiquidity * token0.derivedUSD;

      token1.totalLiquidity = token1.totalLiquidity + poolEntity.reserve1;
      token1.totalLiquidityETH = token1.totalLiquidity * token1.derivedETH;
      token1.totalLiquidityUSD = token1.totalLiquidity * token1.derivedUSD;

      await this.poolRepository.save(poolEntity);
      await this.statisticsRepository.save(statistics);
      await this.tokenRepository.save(token0);
      await this.tokenRepository.save(token1);

      this.updateChainMetric(chainId);
    }

    await this.indexerEventStatusRepository.save(indexerEventStatus);
    await this.releaseResource(chainId);
  }

  private async sequenceEventsAndResolveTxs(address: string, chainId: number) {
    while (this.sequenceEv) {
      try {
        await this.waitFor(10000);
        void this.handleTransfer(address, chainId);
        void this.handleSync(address, chainId);
        void this.handleMint(address, chainId);
        void this.handleSwap(address, chainId);
        void this.handleBurn(address, chainId);
        // Resolve
        await this.waitFor(5000); // Wait for 5 more secs before resolution
        void this.resolveTransactions(address, chainId);
      } catch (error: any) {
        this.logger.error(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          `[Chain: ${chainId}] Failed to sequence pool events → ${error.message}`,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          error.stack,
        );
      }
    }
  }

  @OnEvent(EventTypes.V2_POOL_DEPLOYED)
  handleV2PoolDeployed(payload: ContractDeployEventPayload) {
    this.ADDRESS_DEPLOYMENT_BLOCK[payload.address] = payload.block;
    this.watchedAddresses.add(payload.address);

    for (const eventName of ['Transfer', 'Sync', 'Mint', 'Swap', 'Burn']) {
      void this.getIndexerEventStatus(payload.address, eventName, payload.chainId);
    }

    void this.sequenceEventsAndResolveTxs(payload.address, payload.chainId);
  }

  private async resolveTransactions(address: string, chainId: number) {
    if (!this.cacheService.isConnected()) return; // Cache must be connected

    this.logger.log(`Attempting transaction resolutions...`);

    const cachedTransfers = await this.cacheService.hObtainAll('transfer');
    // Find cached transfers matching parameters
    const filteredTransfers = Object.values(cachedTransfers)
      .map((transfer) => JSON.parse(transfer) as IResolvableTransferTransaction)
      .filter(
        (transfer) =>
          transfer.chainId === chainId && transfer.token.toLowerCase() === address.toLowerCase(),
      );

    // Find equivalent mints or burns
    for (const transfer of filteredTransfers) {
      const resolvableMint = await this.cacheService.hObtain<IResolvableMintTransaction>(
        'mint',
        transfer.hash,
      );

      if (resolvableMint !== null) {
        await this.resolveMint(transfer, resolvableMint);
        await this.cacheService.hDecache('mint', transfer.hash);
        await this.cacheService.hDecache('transfer', transfer.hash);
      }

      const resolvableBurn = await this.cacheService.hObtain<IResolvableBurnTransaction>(
        'burn',
        transfer.hash,
      );

      if (resolvableBurn !== null) {
        await this.resolveBurn(transfer, resolvableBurn);
        await this.cacheService.hDecache('burn', transfer.hash);
        await this.cacheService.hDecache('transfer', transfer.hash);
      }
    }

    const cachedSwaps = await this.cacheService.hObtainAll('swap');

    for (const [hash, stringValue] of Object.entries(cachedSwaps)) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const resolvableSwap: IResolvableSwapTransaction = JSON.parse(stringValue);
      await this.resolveSwap(resolvableSwap);
      await this.cacheService.hDecache('swap', hash);
    }
  }

  private async resolveMint(
    transferEntry: IResolvableTransferTransaction,
    mintEntry: IResolvableMintTransaction,
  ) {
    await this.haltUntilOpen(transferEntry.chainId);
    const poolId = `${transferEntry.token}-${transferEntry.chainId}`;
    const poolEntity = await this.poolRepository.findOneOrFail({
      where: { id: poolId },
      relations: { token0: true, token1: true },
    });
    await this.waitFor(2000);

    const token0 = await this.loadTokenPrice(poolEntity.token0);
    const token1 = await this.loadTokenPrice(poolEntity.token1);

    const txId = `${transferEntry.hash}-${transferEntry.chainId}`;
    const transactionEntity = await this.transactionRepository.findOneByOrFail({
      id: txId,
    });

    await this.waitFor(3000);

    const amount0 = parseFloat(formatUnits(mintEntry.amount0, token0.decimals));
    const amount1 = parseFloat(formatUnits(mintEntry.amount1, token1.decimals));
    const amount0USD = amount0 * token0.derivedUSD;
    const amount1USD = amount1 * token1.derivedUSD;
    const amountUSD = amount0USD + amount1USD;

    const amount0ETH = amount0 * token0.derivedETH;
    const amount1ETH = amount1 * token1.derivedETH;
    const amountETH = amount0ETH + amount1ETH;
    const liquidity = parseFloat(formatEther(transferEntry.amount));

    let mintEntity = await this.mintRepository.findOneBy({
      id: `mint-${transactionEntity.hash.toLowerCase()}-${transactionEntity.chainId}`,
    });

    if (mintEntity === null) {
      mintEntity = this.mintRepository.create({
        transaction: transactionEntity,
        to: transferEntry.to,
        chainId: transactionEntity.chainId,
        pool: poolEntity,
        amount0,
        amount1,
        amountUSD,
        sender: mintEntry.sender,
        logIndex: mintEntry.logIndex,
        timestamp: transactionEntity.timestamp,
        liquidity,
      });

      mintEntity = await this.mintRepository.save(mintEntity);
    }

    token0.txCount = token0.txCount + 1;
    token1.txCount = token1.txCount + 1;
    poolEntity.txCount = poolEntity.txCount + 1;
    poolEntity.totalSupply = poolEntity.totalSupply + liquidity;

    const [_t0, _t1, _pool] = await Promise.all([
      this.tokenRepository.save(token0),
      this.tokenRepository.save(token1),
      this.poolRepository.save(poolEntity),
    ]);

    const statistics = await this.loadStatistics(transactionEntity.chainId);
    statistics.txCount = statistics.txCount + 1;
    await this.statisticsRepository.save(statistics);

    const overallDayData = await this.updateOverallDayData(
      transactionEntity.timestamp,
      transactionEntity.chainId,
    );
    const poolDayData = await this.updatePoolDayData(
      transactionEntity.timestamp,
      poolEntity.address.toLowerCase(),
    );
    const poolHourData = await this.updatePoolHourData(
      transactionEntity.timestamp,
      poolEntity.address.toLowerCase(),
    );
    const token0DayData = await this.updateTokenDayData(_t0, transactionEntity.timestamp);
    const token1DayData = await this.updateTokenDayData(_t1, transactionEntity.timestamp);

    overallDayData.feesUSD = overallDayData.feesUSD + _pool.totalFeesUSD;
    overallDayData.volumeETH = overallDayData.volumeETH + amountETH;
    overallDayData.volumeUSD = overallDayData.volumeUSD + amountUSD;
    await this.overallDayDataRepository.save(overallDayData);

    poolDayData.dailyVolumeToken0 = poolDayData.dailyVolumeToken0 + amount0;
    poolDayData.dailyVolumeToken1 = poolDayData.dailyVolumeToken1 + amount1;
    poolDayData.dailyVolumeETH = poolDayData.dailyVolumeETH + amountETH;
    poolDayData.dailyVolumeUSD = poolDayData.dailyVolumeUSD + amountUSD;
    await this.poolDayDataRepository.save(poolDayData);

    poolHourData.hourlyVolumeToken0 = poolHourData.hourlyVolumeToken0 + amount0;
    poolHourData.hourlyVolumeToken1 = poolHourData.hourlyVolumeToken1 + amount1;
    poolHourData.hourlyVolumeETH = poolHourData.hourlyVolumeETH + amountETH;
    poolHourData.hourlyVolumeUSD = poolHourData.hourlyVolumeUSD + amountUSD;
    await this.poolHourDataRepository.save(poolHourData);

    token0DayData.dailyVolumeToken = token0DayData.dailyVolumeToken + amount0;
    token0DayData.dailyVolumeETH = token0DayData.dailyVolumeETH + amount0ETH;
    token0DayData.dailyVolumeUSD = token0DayData.dailyVolumeUSD + amount0USD;
    await this.tokenDayDataRepository.save(token0DayData);

    token1DayData.dailyVolumeToken = token1DayData.dailyVolumeToken + amount1;
    token1DayData.dailyVolumeETH = token1DayData.dailyVolumeETH + amount1ETH;
    token1DayData.dailyVolumeUSD = token1DayData.dailyVolumeUSD + amount1USD;
    await this.tokenDayDataRepository.save(token1DayData);

    await this.updateLiquidityPosition(
      poolEntity.id,
      transferEntry.to,
      liquidity,
      transactionEntity.block,
      transactionEntity.hash,
    );

    await this.releaseResource(transferEntry.chainId);

    return mintEntity;
  }

  private async resolveBurn(
    transferEntry: IResolvableTransferTransaction,
    burnEntry: IResolvableBurnTransaction,
  ) {
    await this.haltUntilOpen(transferEntry.chainId);
    const poolId = `${transferEntry.token}-${transferEntry.chainId}`;
    const poolEntity = await this.poolRepository.findOneOrFail({
      where: { id: poolId },
      relations: { token0: true, token1: true },
    });
    await this.waitFor(2000);

    const token0 = await this.loadTokenPrice(poolEntity.token0);
    const token1 = await this.loadTokenPrice(poolEntity.token1);

    const txId = `${transferEntry.hash}-${transferEntry.chainId}`;
    const transactionEntity = await this.transactionRepository.findOneByOrFail({
      id: txId,
    });

    await this.waitFor(3000);

    const amount0 = parseFloat(formatUnits(burnEntry.amount0, token0.decimals));
    const amount1 = parseFloat(formatUnits(burnEntry.amount1, token1.decimals));
    const amount0USD = amount0 * token0.derivedUSD;
    const amount1USD = amount1 * token1.derivedUSD;
    const amountUSD = amount0USD + amount1USD;
    const liquidity = parseFloat(formatEther(transferEntry.amount));

    let burnEntity = await this.burnRepository.findOneBy({
      id: `burn-${transactionEntity.hash.toLowerCase()}-${transactionEntity.chainId}`,
    });

    if (burnEntity === null) {
      burnEntity = this.burnRepository.create({
        transaction: transactionEntity,
        to: transferEntry.to,
        chainId: transactionEntity.chainId,
        pool: poolEntity,
        amount0,
        amount1,
        amountUSD,
        sender: burnEntry.sender,
        logIndex: burnEntry.logIndex,
        timestamp: transactionEntity.timestamp,
        liquidity,
      });

      burnEntity = await this.burnRepository.save(burnEntity);
    }

    token0.txCount = token0.txCount + 1;
    token1.txCount = token1.txCount + 1;
    poolEntity.txCount = poolEntity.txCount + 1;
    poolEntity.totalSupply = poolEntity.totalSupply - liquidity;

    const [_t0, _t1] = await Promise.all([
      this.tokenRepository.save(token0),
      this.tokenRepository.save(token1),
      this.poolRepository.save(poolEntity),
    ]);

    const statistics = await this.loadStatistics(transactionEntity.chainId);
    statistics.txCount = statistics.txCount + 1;
    await this.statisticsRepository.save(statistics);

    await this.updateOverallDayData(transactionEntity.timestamp, transactionEntity.chainId);
    await this.updatePoolDayData(transactionEntity.timestamp, poolEntity.address.toLowerCase());
    await this.updatePoolHourData(transactionEntity.timestamp, poolEntity.address.toLowerCase());
    await this.updateTokenDayData(_t0, transactionEntity.timestamp);
    await this.updateTokenDayData(_t1, transactionEntity.timestamp);

    await this.updateLiquidityPosition(poolEntity.id, transferEntry.to, -liquidity);

    await this.releaseResource(transferEntry.chainId);

    return burnEntity;
  }

  private async resolveSwap(swapEntry: IResolvableSwapTransaction) {
    await this.haltUntilOpen(swapEntry.chainId);

    const poolId = `${swapEntry.token}-${swapEntry.chainId}`;
    const poolEntity = await this.poolRepository.findOneOrFail({
      where: { id: poolId },
      relations: { token0: true, token1: true },
    });

    await this.waitFor(2000);

    let token0 = await this.loadTokenPrice(poolEntity.token0);
    let token1 = await this.loadTokenPrice(poolEntity.token1);

    const txId = `${swapEntry.hash}-${swapEntry.chainId}`;
    const transactionEntity = await this.transactionRepository.findOneByOrFail({
      id: txId,
    });

    await this.waitFor(3000);

    const amount0In = parseFloat(formatUnits(swapEntry.amount0In, token0.decimals));
    const amount1In = parseFloat(formatUnits(swapEntry.amount1In, token1.decimals));
    const amount0Out = parseFloat(formatUnits(swapEntry.amount0Out, token0.decimals));
    const amount1Out = parseFloat(formatUnits(swapEntry.amount1Out, token1.decimals));
    const amount0Total = amount0In + amount0Out;
    const amount1Total = amount1In + amount1Out;
    const amount0ETH = amount0Total * token0.derivedETH;
    const amount0USD = amount0Total * token0.derivedUSD;
    const amount1ETH = amount1Total * token1.derivedETH;
    const amount1USD = amount1Total * token1.derivedUSD;

    let swapEntity = await this.swapRepository.findOneBy({
      id: `swap-${transactionEntity.hash.toLowerCase()}-${transactionEntity.chainId}`,
    });

    if (swapEntity === null) {
      swapEntity = this.swapRepository.create({
        transaction: transactionEntity,
        timestamp: transactionEntity.timestamp,
        pool: poolEntity,
        amount0In,
        amount0Out,
        amount1In,
        amount1Out,
        amountUSD: amount0USD + amount1USD,
        chainId: transactionEntity.chainId,
        from: swapEntry.from,
        to: swapEntry.to,
        logIndex: swapEntry.logIndex,
        sender: swapEntry.sender,
      });

      swapEntity = await this.swapRepository.save(swapEntity);
    }

    poolEntity.volumeETH = poolEntity.volumeETH + amount0ETH + amount1ETH;
    poolEntity.volumeUSD = poolEntity.volumeUSD + amount0USD + amount1USD;
    poolEntity.volumeToken0 = poolEntity.volumeToken0 + amount0Total;
    poolEntity.volumeToken1 = poolEntity.volumeToken1 + amount1Total;
    poolEntity.txCount = poolEntity.txCount + 1;
    await this.poolRepository.save(poolEntity);

    token0.tradeVolume = token0.tradeVolume + amount0Total;
    token0.tradeVolumeUSD = token0.tradeVolumeUSD + amount0USD;
    token0.txCount = token0.txCount + 1;
    token0 = await this.tokenRepository.save(token0);

    token1.tradeVolume = token1.tradeVolume + amount1Total;
    token1.tradeVolumeUSD = token1.tradeVolumeUSD + amount1USD;
    token1.txCount = token1.txCount + 1;
    token1 = await this.tokenRepository.save(token1);

    const statistics = await this.loadStatistics(transactionEntity.chainId);
    statistics.totalTradeVolumeETH = statistics.totalTradeVolumeETH + amount0ETH + amount1ETH;
    statistics.totalTradeVolumeUSD = statistics.totalTradeVolumeUSD + amount0USD + amount1USD;
    statistics.txCount = statistics.txCount + 1;
    await this.statisticsRepository.save(statistics);

    const overallDayData = await this.updateOverallDayData(
      transactionEntity.timestamp,
      transactionEntity.chainId,
    );
    const poolDayData = await this.updatePoolDayData(
      transactionEntity.timestamp,
      poolEntity.address.toLowerCase(),
    );
    const poolHourData = await this.updatePoolHourData(
      transactionEntity.timestamp,
      poolEntity.address.toLowerCase(),
    );
    const token0DayData = await this.updateTokenDayData(token0, transactionEntity.timestamp);
    const token1DayData = await this.updateTokenDayData(token1, transactionEntity.timestamp);

    overallDayData.feesUSD = overallDayData.feesUSD + poolEntity.totalFeesUSD;
    overallDayData.volumeETH = overallDayData.volumeETH + amount0ETH + amount1ETH;
    overallDayData.volumeUSD = overallDayData.volumeUSD + amount0USD + amount1USD;
    await this.overallDayDataRepository.save(overallDayData);

    poolDayData.dailyVolumeToken0 = poolDayData.dailyVolumeToken0 + amount0Total;
    poolDayData.dailyVolumeToken1 = poolDayData.dailyVolumeToken1 + amount1Total;
    poolDayData.dailyVolumeETH = poolDayData.dailyVolumeETH + amount0ETH + amount1ETH;
    poolDayData.dailyVolumeUSD = poolDayData.dailyVolumeUSD + amount0USD + amount1USD;
    await this.poolDayDataRepository.save(poolDayData);

    poolHourData.hourlyVolumeToken0 = poolHourData.hourlyVolumeToken0 + amount0Total;
    poolHourData.hourlyVolumeToken1 = poolHourData.hourlyVolumeToken1 + amount1Total;
    poolHourData.hourlyVolumeETH = poolHourData.hourlyVolumeETH + amount0ETH + amount1ETH;
    poolHourData.hourlyVolumeUSD = poolHourData.hourlyVolumeUSD + amount0USD + amount1USD;
    await this.poolHourDataRepository.save(poolHourData);

    token0DayData.dailyVolumeToken = token0DayData.dailyVolumeToken + amount0Total;
    token0DayData.dailyVolumeETH = token0DayData.dailyVolumeETH + amount0ETH;
    token0DayData.dailyVolumeUSD = token0DayData.dailyVolumeUSD + amount0USD;
    await this.tokenDayDataRepository.save(token0DayData);

    token1DayData.dailyVolumeToken = token1DayData.dailyVolumeToken + amount1Total;
    token1DayData.dailyVolumeETH = token1DayData.dailyVolumeETH + amount1ETH;
    token1DayData.dailyVolumeUSD = token1DayData.dailyVolumeUSD + amount1USD;
    await this.tokenDayDataRepository.save(token1DayData);

    await this.releaseResource(swapEntry.chainId);

    return swapEntity;
  }

  private sequenceAllEventsAndResolveTxs() {
    const chains = Object.fromEntries(this.WATCHED_ADDRESSES_CHAINS);

    for (const pool of this.WATCHED_ADDRESSES.values()) {
      void this.sequenceEventsAndResolveTxs(pool, chains[pool]);
    }
  }

  private async loadTokenPrice(token: Token): Promise<Token> {
    token.derivedUSD = await this.oracle.getPriceInUSD(token.address, token.chainId);
    token.derivedETH = await this.oracle.getPriceInETH(token.address, token.chainId);

    token = await this.tokenRepository.save(token);
    return token;
  }

  private async updateLiquidityPosition(
    poolId: string,
    account: string,
    amount: number,
    blockNumber?: number,
    transaction?: string,
  ) {
    const pool = await this.poolRepository.findOneByOrFail({ id: poolId });
    let user = await this.userRepository.findOneBy({ id: account.toLowerCase() });

    if (user === null) {
      user = this.userRepository.create({
        address: account,
      });
      user = await this.userRepository.save(user);
    }

    let lpPosition = await this.liquidityPositionRepository.findOneBy({
      pool: { id: pool.id },
      account: { id: user.id },
    });

    if (lpPosition === null) {
      lpPosition = this.liquidityPositionRepository.create({
        account: user,
        pool,
        position: 0,
        creationBlock: blockNumber,
        creationTransaction: transaction,
        chainId: pool.chainId,
      });

      lpPosition = await this.liquidityPositionRepository.save(lpPosition);
    }

    lpPosition.position = lpPosition.position + amount;
    return this.liquidityPositionRepository.save(lpPosition);
  }

  private async updateOverallDayData(timestamp: number, chainId: number) {
    const statistics = await this.loadStatistics(chainId);
    const dayId = Math.floor(timestamp / 86400);
    const dataId = `${dayId.toString()}-${chainId}`;
    const dayStartTimestamp = dayId * 86400;

    let overallDayData = await this.overallDayDataRepository.findOneBy({
      id: dataId,
    });
    if (overallDayData === null) {
      overallDayData = this.overallDayDataRepository.create({
        id: dayId.toString(),
        feesUSD: 0,
        txCount: 0,
        date: dayStartTimestamp,
        volumeETH: 0,
        volumeUSD: 0,
        liquidityETH: 0,
        liquidityUSD: 0,
        totalTradeVolumeETH: 0,
        totalTradeVolumeUSD: 0,
        chainId,
      });

      overallDayData = await this.overallDayDataRepository.save(overallDayData);
    }

    overallDayData.liquidityUSD = statistics.totalVolumeLockedUSD;
    overallDayData.liquidityETH = statistics.totalVolumeLockedETH;
    overallDayData.totalTradeVolumeETH = statistics.totalTradeVolumeETH;
    overallDayData.totalTradeVolumeUSD = statistics.totalTradeVolumeUSD;
    overallDayData.txCount = overallDayData.txCount + 1;
    return this.overallDayDataRepository.save(overallDayData);
  }

  private async updatePoolDayData(timestamp: number, poolAddress: string) {
    const dayId = Math.floor(timestamp / 86400);
    const dayStartTimestamp = dayId * 86400;
    const dayPoolId = `${poolAddress}-${dayId.toString()}`;
    const pool = await this.poolRepository.findOneByOrFail({
      address: ILike(`%${poolAddress.toLowerCase()}%`),
    });

    let poolDayData = await this.poolDayDataRepository.findOneBy({
      id: dayPoolId,
    });

    if (poolDayData === null) {
      poolDayData = this.poolDayDataRepository.create({
        id: dayPoolId,
        date: dayStartTimestamp,
        dailyTxns: 0,
        dailyVolumeETH: 0,
        dailyVolumeToken0: 0,
        dailyVolumeToken1: 0,
        dailyVolumeUSD: 0,
        pool,
        totalSupply: 0,
        reserve0: 0,
        reserve1: 0,
        reserveETH: 0,
        reserveUSD: 0,
      });

      poolDayData = await this.poolDayDataRepository.save(poolDayData);
    }

    poolDayData.totalSupply = pool.totalSupply;
    poolDayData.reserve0 = pool.reserve0;
    poolDayData.reserve1 = pool.reserve1;
    poolDayData.reserveETH = pool.reserveETH;
    poolDayData.reserveUSD = pool.reserveUSD;
    poolDayData.dailyTxns = poolDayData.dailyTxns + 1;

    return this.poolDayDataRepository.save(poolDayData);
  }

  private async updatePoolHourData(timestamp: number, poolAddress: string) {
    const hourIndex = timestamp / 3600;
    const hourStartUnix = hourIndex * 3600;
    const hourPoolId = `${poolAddress}-${hourIndex.toString()}`;
    const pool = await this.poolRepository.findOneByOrFail({
      address: ILike(`%${poolAddress.toLowerCase()}%`),
    });

    let poolHourData = await this.poolHourDataRepository.findOneBy({
      id: hourPoolId,
    });
    if (poolHourData === null) {
      poolHourData = this.poolHourDataRepository.create({
        id: hourPoolId,
        hourStartUnix,
        pool,
        hourlyTxns: 0,
        hourlyVolumeETH: 0,
        hourlyVolumeToken0: 0,
        hourlyVolumeToken1: 0,
        hourlyVolumeUSD: 0,
        totalSupply: 0,
        reserve0: 0,
        reserve1: 0,
        reserveETH: 0,
        reserveUSD: 0,
      });

      poolHourData = await this.poolHourDataRepository.save(poolHourData);
    }

    poolHourData.totalSupply = pool.totalSupply;
    poolHourData.reserve0 = pool.reserve0;
    poolHourData.reserve1 = pool.reserve1;
    poolHourData.reserveETH = pool.reserveETH;
    poolHourData.reserveUSD = pool.reserveUSD;
    poolHourData.hourlyTxns = poolHourData.hourlyTxns + 1;

    return this.poolHourDataRepository.save(poolHourData);
  }

  private async updateTokenDayData(token: Token, timestamp: number) {
    const dayId = Math.floor(timestamp / 86400);
    const dayStartTimestamp = dayId * 86400;
    const tokenDayId = `${token.address.toLowerCase()}-${dayId.toString()}`;

    let tokenDayData = await this.tokenDayDataRepository.findOneBy({
      id: tokenDayId,
    });
    if (tokenDayData === null) {
      tokenDayData = this.tokenDayDataRepository.create({
        id: tokenDayId,
        date: dayStartTimestamp,
        token,
        dailyTxns: 0,
        dailyVolumeETH: 0,
        dailyVolumeToken: 0,
        dailyVolumeUSD: 0,
        priceETH: 0,
        priceUSD: 0,
        totalLiquidityETH: 0,
        totalLiquidityToken: 0,
        totalLiquidityUSD: 0,
      });

      tokenDayData = await this.tokenDayDataRepository.save(tokenDayData);
    }

    tokenDayData.priceUSD = token.derivedUSD;
    tokenDayData.priceETH = token.derivedETH;
    tokenDayData.totalLiquidityToken = token.totalLiquidity;
    tokenDayData.totalLiquidityETH = token.totalLiquidity * token.derivedETH;
    tokenDayData.totalLiquidityUSD = token.totalLiquidity * token.derivedUSD;
    tokenDayData.dailyTxns = tokenDayData.dailyTxns + 1;

    return this.tokenDayDataRepository.save(tokenDayData);
  }
}
