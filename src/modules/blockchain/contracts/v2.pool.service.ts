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
  amount0: bigint;
  amount1: bigint;
}

interface IResolvableBurnTransaction extends IResolvableTransaction {
  amount0: bigint;
  amount1: bigint;
}

interface IResolvableTransferTransaction extends IResolvableTransaction {
  token: string;
  from: string;
  to: string;
  amount: bigint;
}

interface IResolvableSwapTransaction extends IResolvableTransaction {
  from: string;
  to: string;
  amount0In: bigint;
  amount1In: bigint;
  amount0Out: bigint;
  amount1Out: bigint;
  token: string;
}

@Injectable()
export class V2PoolService
  extends BaseFactoryDeployedContractService
  implements OnModuleInit, OnModuleDestroy
{
  private resolveTxs: boolean = false;
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

    this.resolveTxs = true;
    this.sequenceEv = true;

    void this.resolveTransactions();
    void this.sequenceAllEvents();

    process.on('SIGINT', () => {
      this.sequenceEv = false;
      this.resolveTxs = false;
    });
  }

  onModuleDestroy() {
    this.resolveTxs = false;
    this.sequenceEv = false;
    this.WATCHED_ADDRESSES.clear();
    this.WATCHED_ADDRESSES_CHAINS.clear();
  }

  private async initializeWatchedAddresses() {
    const pools = await this.poolRepository.findBy({
      poolType: Or(Equal(PoolType.STABLE), Equal(PoolType.VOLATILE)),
    });

    // Watch pools
    pools.forEach((pool) => {
      this.WATCHED_ADDRESSES.add(pool.address.toLowerCase());
      this.WATCHED_ADDRESSES_CHAINS.set(pool.address.toLowerCase(), pool.chainId);
    });
  }

  private getContract(address: string, provider: JsonRpcProvider): V2Pool {
    return V2Pool__factory.connect(address, provider);
  }

  private async handleMint(address: string, chainId: number) {
    this.logger.log(`Now sequencing lp mint event on ${chainId}`, V2PoolService.name);
    if (!this.cacheService.isConnected()) return;
    await this.haltUntilOpen(chainId); // If resource is locked, halt at this point

    let lastBlockNumber: number | undefined;

    try {
      this.logger.log(`Now fetching latest block number on ${chainId}`, V2PoolService.name);
      lastBlockNumber = await this.getLatestBlockNumber(chainId);
    } catch (error: any) {
      // Release resource
      await this.releaseResource(chainId);
      this.logger.error(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        `Unable to fetch latest block: ${error.message}`,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        error.stack,
        V2PoolService.name,
      );
    }

    if (typeof lastBlockNumber === 'undefined') return;

    const indexerEventStatus = await this.getIndexerEventStatus(address, 'Mint', chainId);

    // We want to keep record in sync with chain
    if (indexerEventStatus.lastBlockNumber >= lastBlockNumber) {
      this.logger.debug(
        `Indexer status check with ID ${indexerEventStatus.id} is up to date with current block. Skipping...`,
        V2PoolService.name,
      );
      // Release resource
      await this.releaseResource(chainId);
      return;
    }

    const connectionInfo = this.getConnectionInfo(chainId);
    const promises = connectionInfo.rpcInfos.map((rpcInfo) => {
      const provider = this.provider(rpcInfo, chainId);
      const contract = this.getContract(address, provider);
      const blockStart = lastBlockNumber
        ? Math.min(indexerEventStatus.lastBlockNumber + 1, lastBlockNumber)
        : indexerEventStatus.lastBlockNumber + 1;
      const blockEnd = blockStart + (rpcInfo.queryBlockRange || DEFAULT_BLOCK_RANGE);
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

        transactionEntity = await this.transactionRepository.save(transactionEntity);
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
        logIndex: eventDatum.index,
      };

      await this.cacheService.hCache('mint', resolvableMint.hash, resolvableMint);
    }

    await this.indexerEventStatusRepository.save(indexerEventStatus);
    await this.releaseResource(chainId);
  }

  private async handleBurn(address: string, chainId: number) {
    this.logger.log(`Now sequencing lp burn event on ${chainId}`, V2PoolService.name);
    if (!this.cacheService.isConnected()) return;
    await this.haltUntilOpen(chainId); // If resource is locked, halt at this point

    let lastBlockNumber: number | undefined;

    try {
      this.logger.log(`Now fetching latest block number on ${chainId}`, V2PoolService.name);
      lastBlockNumber = await this.getLatestBlockNumber(chainId);
    } catch (error: any) {
      // Release resource
      await this.releaseResource(chainId);
      this.logger.error(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        `Unable to fetch latest block: ${error.message}`,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        error.stack,
        V2PoolService.name,
      );
    }

    if (typeof lastBlockNumber === 'undefined') return;

    const indexerEventStatus = await this.getIndexerEventStatus(address, 'Burn', chainId);

    // We want to keep record in sync with chain
    if (indexerEventStatus.lastBlockNumber >= lastBlockNumber) {
      this.logger.debug(
        `Indexer status check with ID ${indexerEventStatus.id} is up to date with current block. Skipping...`,
        V2PoolService.name,
      );
      // Release resource
      await this.releaseResource(chainId);
      return;
    }

    const connectionInfo = this.getConnectionInfo(chainId);
    const promises = connectionInfo.rpcInfos.map((rpcInfo) => {
      const provider = this.provider(rpcInfo, chainId);
      const contract = this.getContract(address, provider);
      const blockStart = lastBlockNumber
        ? Math.min(indexerEventStatus.lastBlockNumber + 1, lastBlockNumber)
        : indexerEventStatus.lastBlockNumber + 1;
      const blockEnd = blockStart + (rpcInfo.queryBlockRange || DEFAULT_BLOCK_RANGE);
      indexerEventStatus.lastBlockNumber = lastBlockNumber
        ? Math.min(blockEnd, lastBlockNumber)
        : blockEnd; // We still want to update last processed block even if no data is available.
      return contract.queryFilter(contract.filters.Burn, blockStart, blockEnd);
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

        transactionEntity = await this.transactionRepository.save(transactionEntity);
      }

      // @author Kingsley Victor
      // Why this is needed: I am imagining situations where some dependent events are processed ahead of others (depends on the block range of the selected RPC provider though).
      // For context, the Transfer event and the Mint event are emitted on the same transaction with the former coming first. The transfer event harbours data that we would need on the mint event table. I imagine that there are hypothetical scenarios where the mint event is processed before the transfer event, but we want to ensure integrity on the mint table, so we cache the result of the procession and do a look-up at a latter time against a cache for the transfer event
      const resolvableBurn: IResolvableBurnTransaction = {
        sender,
        amount0,
        amount1,
        chainId,
        hash: transactionEntity.hash,
        logIndex: eventDatum.index,
      };

      await this.cacheService.hCache('burn', resolvableBurn.hash, resolvableBurn);
    }

    await this.indexerEventStatusRepository.save(indexerEventStatus);
    await this.releaseResource(chainId);
  }

  private async handleTransfer(address: string, chainId: number) {
    this.logger.log(`Now sequencing lp transfer event on ${chainId}`, V2PoolService.name);
    if (!this.cacheService.isConnected()) return;
    await this.haltUntilOpen(chainId); // If resource is locked, halt at this point

    let lastBlockNumber: number | undefined;

    try {
      this.logger.log(`Now fetching latest block number on ${chainId}`, V2PoolService.name);
      lastBlockNumber = await this.getLatestBlockNumber(chainId);
    } catch (error: any) {
      // Release resource
      await this.releaseResource(chainId);
      this.logger.error(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        `Unable to fetch latest block: ${error.message}`,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        error.stack,
        V2PoolService.name,
      );
    }

    if (typeof lastBlockNumber === 'undefined') return;

    const indexerEventStatus = await this.getIndexerEventStatus(address, 'Transfer', chainId);

    // We want to keep record in sync with chain
    if (indexerEventStatus.lastBlockNumber >= lastBlockNumber) {
      this.logger.debug(
        `Indexer status check with ID ${indexerEventStatus.id} is up to date with current block. Skipping...`,
        V2PoolService.name,
      );
      // Release resource
      await this.releaseResource(chainId);
      return;
    }

    const connectionInfo = this.getConnectionInfo(chainId);
    const promises = connectionInfo.rpcInfos.map((rpcInfo) => {
      const provider = this.provider(rpcInfo, chainId);
      const contract = this.getContract(address, provider);
      const blockStart = lastBlockNumber
        ? Math.min(indexerEventStatus.lastBlockNumber + 1, lastBlockNumber)
        : indexerEventStatus.lastBlockNumber + 1;
      const blockEnd = blockStart + (rpcInfo.queryBlockRange || DEFAULT_BLOCK_RANGE);
      indexerEventStatus.lastBlockNumber = lastBlockNumber
        ? Math.min(blockEnd, lastBlockNumber)
        : blockEnd; // We still want to update last processed block even if no data is available.
      return contract.queryFilter(contract.filters.Transfer, blockStart, blockEnd);
    });

    // Wait for 3 secs
    await this.waitFor(3000);
    const eventData = await Promise.any(promises);

    for (const eventDatum of eventData) {
      const processedBlock = await eventDatum.getBlock();
      const transaction = await eventDatum.getTransaction();
      const { from, to, value } = eventDatum.args;
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
        amount: value,
        logIndex: eventDatum.index,
        sender: transaction.from,
      };

      await this.cacheService.hCache('transfer', resolvableTransfer.hash, resolvableTransfer);
    }

    await this.indexerEventStatusRepository.save(indexerEventStatus);
    await this.releaseResource(chainId);
  }

  private async handleSwap(address: string, chainId: number) {
    this.logger.log(`Now sequencing lp swap event on ${chainId}`, V2PoolService.name);
    if (!this.cacheService.isConnected()) return;
    await this.haltUntilOpen(chainId); // If resource is locked, halt at this point

    let lastBlockNumber: number | undefined;

    try {
      this.logger.log(`Now fetching latest block number on ${chainId}`, V2PoolService.name);
      lastBlockNumber = await this.getLatestBlockNumber(chainId);
    } catch (error: any) {
      // Release resource
      await this.releaseResource(chainId);
      this.logger.error(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        `Unable to fetch latest block: ${error.message}`,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        error.stack,
        V2PoolService.name,
      );
    }

    if (typeof lastBlockNumber === 'undefined') return;

    const indexerEventStatus = await this.getIndexerEventStatus(address, 'Swap', chainId);

    // We want to keep record in sync with chain
    if (indexerEventStatus.lastBlockNumber >= lastBlockNumber) {
      this.logger.debug(
        `Indexer status check with ID ${indexerEventStatus.id} is up to date with current block. Skipping...`,
        V2PoolService.name,
      );
      // Release resource
      await this.releaseResource(chainId);
      return;
    }

    const connectionInfo = this.getConnectionInfo(chainId);
    const promises = connectionInfo.rpcInfos.map((rpcInfo) => {
      const provider = this.provider(rpcInfo, chainId);
      const contract = this.getContract(address, provider);
      const blockStart = lastBlockNumber
        ? Math.min(indexerEventStatus.lastBlockNumber + 1, lastBlockNumber)
        : indexerEventStatus.lastBlockNumber + 1;
      const blockEnd = blockStart + (rpcInfo.queryBlockRange || DEFAULT_BLOCK_RANGE);
      indexerEventStatus.lastBlockNumber = lastBlockNumber
        ? Math.min(blockEnd, lastBlockNumber)
        : blockEnd; // We still want to update last processed block even if no data is available.
      return contract.queryFilter(contract.filters.Swap, blockStart, blockEnd);
    });

    // Wait for 3 secs
    await this.waitFor(3000);
    const eventData = await Promise.any(promises);

    for (const eventDatum of eventData) {
      const processedBlock = await eventDatum.getBlock();
      const { sender, to, amount0In, amount1In, amount0Out, amount1Out } = eventDatum.args;
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
        amount0In,
        amount1In,
        amount0Out,
        amount1Out,
        logIndex: eventDatum.index,
        sender,
      };

      await this.cacheService.hCache('swap', resolvableSwap.hash, resolvableSwap);
    }

    await this.indexerEventStatusRepository.save(indexerEventStatus);
    await this.releaseResource(chainId);
  }

  private async handleSync(address: string, chainId: number) {
    await this.haltUntilOpen(chainId);
    const lastBlockNumber = await this.getLatestBlockNumber(chainId);

    const indexerEventStatus = await this.getIndexerEventStatus(address, 'Sync', chainId);

    const connectionInfo = this.getConnectionInfo(chainId);
    const promises = connectionInfo.rpcInfos.map((rpcInfo) => {
      const provider = this.provider(rpcInfo, chainId);
      const contract = this.getContract(address, provider);
      const blockStart = lastBlockNumber
        ? Math.min(indexerEventStatus.lastBlockNumber + 1, lastBlockNumber)
        : indexerEventStatus.lastBlockNumber + 1;
      const blockEnd = blockStart + (rpcInfo.queryBlockRange || DEFAULT_BLOCK_RANGE);
      indexerEventStatus.lastBlockNumber = lastBlockNumber
        ? Math.min(blockEnd, lastBlockNumber)
        : blockEnd; // We still want to update last processed block even if no data is available.
      return contract.queryFilter(contract.filters.Sync, blockStart, blockEnd);
    });

    // Wait for 3 secs
    await this.waitFor(3000);
    const eventData = await Promise.any(promises);

    for (const eventDatum of eventData) {
      const { reserve0, reserve1 } = eventDatum.args;
      const poolId = `${address.toLowerCase()}-${chainId}`;
      const poolEntity = await this.poolRepository.findOneOrFail({
        where: { id: poolId },
        relations: { token0: true, token1: true },
      });

      const token0 = await this.loadTokenPrice(poolEntity.token0);
      const token1 = await this.loadTokenPrice(poolEntity.token1);

      const statistics = await this.loadStatistics();
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
    }

    await this.indexerEventStatusRepository.save(indexerEventStatus);
    await this.releaseResource(chainId);
  }

  private async sequenceEvents(address: string, chainId: number) {
    while (this.sequenceEv) {
      try {
        await this.handleTransfer(address, chainId);
        await this.handleSync(address, chainId);
        await this.handleMint(address, chainId);
        await this.handleSwap(address, chainId);
        await this.handleBurn(address, chainId);
      } catch (error: any) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        this.logger.error(error.message, error.stack, V2PoolService.name);
      }
    }
  }

  @OnEvent(EventTypes.V2_POOL_DEPLOYED)
  handleV2PoolDeployed(payload: ContractDeployEventPayload) {
    this.ADDRESS_DEPLOYMENT_BLOCK[payload.address] = payload.block;
    this.watchedAddresses.add(payload.address);
    void this.sequenceEvents(payload.address, payload.chainId);
  }

  private async resolveTransactions() {
    while (this.resolveTxs) {
      // Make sure cache is connected
      if (!this.cacheService.isConnected()) {
        await this.waitFor(2000);
        continue;
      }

      // Fetch all cached transfers
      const cachedTransfers = await this.cacheService.hObtainAll('transfer');

      for (const [hash, stringValue] of Object.entries(cachedTransfers)) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const resolvableTransfer: IResolvableTransferTransaction = JSON.parse(stringValue);
        // Search for corresponding mint
        const resolvableMint = await this.cacheService.hObtain<IResolvableMintTransaction>(
          'mint',
          hash,
        );

        if (resolvableMint !== null) {
          await this.resolveMint(resolvableTransfer, resolvableMint);
          // Clear entries from cache
          await this.cacheService.hDecache('mint', hash);
          await this.cacheService.hDecache('transfer', hash);
        }

        // Search for corresponding burn
        const resolvableBurn = await this.cacheService.hObtain<IResolvableBurnTransaction>(
          'burn',
          hash,
        );

        if (resolvableBurn !== null) {
          await this.resolveBurn(resolvableTransfer, resolvableBurn);
          // Clear entries from cache
          await this.cacheService.hDecache('burn', hash);
          await this.cacheService.hDecache('transfer', hash);
        }
      }

      // Fetch all cached swaps
      const cachedSwaps = await this.cacheService.hObtainAll('swap');

      for (const [hash, stringValue] of Object.entries(cachedSwaps)) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const resolvableSwap: IResolvableSwapTransaction = JSON.parse(stringValue);
        await this.resolveSwap(resolvableSwap);
        // Clear entry
        await this.cacheService.hDecache('swap', hash);
      }
    }
  }

  private async resolveMint(
    transferEntry: IResolvableTransferTransaction,
    mintEntry: IResolvableMintTransaction,
  ) {
    await this.haltUntilOpen(transferEntry.chainId); // Halt resource access
    // Find pool
    const poolId = `${transferEntry.token}-${transferEntry.chainId}`;
    const poolEntity = await this.poolRepository.findOneOrFail({
      where: { id: poolId },
      relations: { token0: true, token1: true },
    });
    await this.waitFor(2000); // Wait for 2 secs

    const token0 = await this.loadTokenPrice(poolEntity.token0);
    const token1 = await this.loadTokenPrice(poolEntity.token1);

    // Find transaction
    const txId = `${transferEntry.hash}-${transferEntry.chainId}`;
    const transactionEntity = await this.transactionRepository.findOneByOrFail({
      id: txId,
    });

    // Tokens metadata
    await this.waitFor(3000); // wait for 3 secs

    const amount0 = parseFloat(formatUnits(mintEntry.amount0, token0.decimals));
    const amount1 = parseFloat(formatUnits(mintEntry.amount1, token1.decimals));
    const amount0USD = amount0 * token0.derivedUSD;
    const amount1USD = amount1 * token1.derivedUSD;
    const amountUSD = amount0USD + amount1USD;

    const amount0ETH = amount0 * token0.derivedETH;
    const amount1ETH = amount1 * token1.derivedETH;
    const amountETH = amount0ETH + amount1ETH;
    const liquidity = parseFloat(formatEther(transferEntry.amount));

    let mintEntity = this.mintRepository.create({
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

    token0.txCount = token0.txCount + 1;
    token1.txCount = token1.txCount + 1;
    poolEntity.txCount = poolEntity.txCount + 1;
    poolEntity.totalSupply = poolEntity.totalSupply + liquidity;

    const [_t0, _t1, _pool] = await Promise.all([
      this.tokenRepository.save(token0),
      this.tokenRepository.save(token1),
      this.poolRepository.save(poolEntity),
    ]);

    // Update data
    const statistics = await this.loadStatistics();
    statistics.txCount = statistics.txCount + 1;
    await this.statisticsRepository.save(statistics);

    const overallDayData = await this.updateOverallDayData(transactionEntity.timestamp);
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
    await this.haltUntilOpen(transferEntry.chainId); // Halt resource access
    // Find pool
    const poolId = `${transferEntry.token}-${transferEntry.chainId}`;
    const poolEntity = await this.poolRepository.findOneOrFail({
      where: { id: poolId },
      relations: { token0: true, token1: true },
    });
    await this.waitFor(2000); // Wait for 2 secs

    const token0 = await this.loadTokenPrice(poolEntity.token0);
    const token1 = await this.loadTokenPrice(poolEntity.token1);

    // Find transaction
    const txId = `${transferEntry.hash}-${transferEntry.chainId}`;
    const transactionEntity = await this.transactionRepository.findOneByOrFail({
      id: txId,
    });

    // Tokens metadata
    await this.waitFor(3000); // wait for 3 secs

    const amount0 = parseFloat(formatUnits(burnEntry.amount0, token0.decimals));
    const amount1 = parseFloat(formatUnits(burnEntry.amount1, token1.decimals));
    const amount0USD = amount0 * token0.derivedUSD;
    const amount1USD = amount1 * token1.derivedUSD;
    const amountUSD = amount0USD + amount1USD;
    const liquidity = parseFloat(formatEther(transferEntry.amount));

    let burnEntity = this.burnRepository.create({
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

    token0.txCount = token0.txCount + 1;
    token1.txCount = token1.txCount + 1;
    poolEntity.txCount = poolEntity.txCount + 1;
    poolEntity.totalSupply = poolEntity.totalSupply + liquidity;

    const [_t0, _t1] = await Promise.all([
      this.tokenRepository.save(token0),
      this.tokenRepository.save(token1),
      this.poolRepository.save(poolEntity),
    ]);

    // Update data
    const statistics = await this.loadStatistics();
    statistics.txCount = statistics.txCount + 1;
    await this.statisticsRepository.save(statistics);

    await this.updateOverallDayData(transactionEntity.timestamp);
    await this.updatePoolDayData(transactionEntity.timestamp, poolEntity.address.toLowerCase());
    await this.updatePoolHourData(transactionEntity.timestamp, poolEntity.address.toLowerCase());
    await this.updateTokenDayData(_t0, transactionEntity.timestamp);
    await this.updateTokenDayData(_t1, transactionEntity.timestamp);

    await this.updateLiquidityPosition(poolEntity.id, transferEntry.to, -liquidity);

    await this.releaseResource(transferEntry.chainId);

    return burnEntity;
  }

  private async resolveSwap(swapEntry: IResolvableSwapTransaction) {
    await this.haltUntilOpen(swapEntry.chainId); // Halt resource access

    // Find pool
    const poolId = `${swapEntry.token}-${swapEntry.chainId}`;
    const poolEntity = await this.poolRepository.findOneOrFail({
      where: { id: poolId },
      relations: { token0: true, token1: true },
    });

    await this.waitFor(2000); // Wait for 2 secs

    let token0 = await this.loadTokenPrice(poolEntity.token0);
    let token1 = await this.loadTokenPrice(poolEntity.token1);

    // Find transaction
    const txId = `${swapEntry.hash}-${swapEntry.chainId}`;
    const transactionEntity = await this.transactionRepository.findOneByOrFail({
      id: txId,
    });

    // Tokens metadata
    await this.waitFor(3000); // wait for 3 secs

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

    let swapEntity = this.swapRepository.create({
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

    // Update data
    const statistics = await this.loadStatistics();
    statistics.totalTradeVolumeETH = statistics.totalTradeVolumeETH + amount0ETH + amount1ETH;
    statistics.totalTradeVolumeUSD = statistics.totalTradeVolumeUSD + amount0USD + amount1USD;
    statistics.txCount = statistics.txCount + 1;
    await this.statisticsRepository.save(statistics);

    const overallDayData = await this.updateOverallDayData(transactionEntity.timestamp);
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

  private async sequenceAllEvents() {
    const chains = Object.fromEntries(this.WATCHED_ADDRESSES_CHAINS);
    const promises: Promise<void>[] = [];

    for (const pool of this.WATCHED_ADDRESSES.values()) {
      promises.push(this.sequenceEvents(pool, chains[pool]));
    }

    // All pools process in parallel
    await Promise.all(promises);
  }

  private async loadTokenPrice(token: Token): Promise<Token> {
    token.derivedUSD = await this.oracle.getPriceInUSD(token.address, token.chainId);
    token.derivedETH = await this.oracle.getPriceInETH(token.address, token.chainId);

    // Update token
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

  private async updateOverallDayData(timestamp: number) {
    const statistics = await this.loadStatistics();
    const dayId = Math.floor(timestamp / 86400);
    const dayStartTimestamp = dayId * 86400;

    let overallDayData = await this.overallDayDataRepository.findOneBy({
      id: dayId.toString(),
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
