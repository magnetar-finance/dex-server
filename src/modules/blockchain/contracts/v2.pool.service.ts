/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { id as keccak256, type Log } from 'ethers';
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BaseFactoryDeployedContractService } from './base/base-factory-deployed';
import { CONNECTION_INFO, DEFAULT_BLOCK_RANGE } from '../../../common/variables';
import { InjectRepository } from '@nestjs/typeorm';
import { CacheService } from '../../cache/cache.service';
import { IndexerEventStatus } from '../../database/entities/indexer-event-status.entity';
import { Pool, PoolType } from '../../database/entities/pool.entity';
import { Token } from '../../database/entities/token.entity';
import { Equal, Or, Repository } from 'typeorm';
import { ChainConnectionInfo } from '../interfaces';
import { OnEvent } from '@nestjs/event-emitter';
import { type ContractDeployEventPayload, EventTypes } from './types';
import { V2Pool__factory } from './typechain';
import { formatEther, formatUnits } from 'ethers';
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
import { Cron, CronExpression } from '@nestjs/schedule';

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
  private poolEvents = {
    MINT: keccak256('Mint(address,uint256,uint256)'),
    SYNC: keccak256('Sync(uint256,uint256)'),
    SWAP: keccak256('Swap(address,address,uint256,uint256,uint256,uint256)'),
    TRANSFER: keccak256('Transfer(address,address,uint256)'),
    BURN: keccak256('Burn(address,address,uint256,uint256)'),
  };

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
  }

  onModuleDestroy() {
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

  @Cron(CronExpression.EVERY_10_SECONDS)
  async sequenceAllChains() {
    const chainIds = Array.from(new Set(this.WATCHED_ADDRESSES_CHAINS.values()));
    for (const chainId of chainIds) {
      await this.sequenceChainEvents(chainId);
    }
  }

  private async sequenceChainEvents(chainId: number) {
    try {
      await this.waitFor(4000);
      await this.handleEvents(chainId);
      await this.resolveTransactionsForChain(chainId);
    } catch (error: any) {
      this.logger.error(
        `[Chain: ${chainId}] Global sequencing error → ${error.message}`,
        error.stack,
      );
      await this.waitFor(5000);
    }
  }

  private async handleEvents(chainId: number) {
    if (!this.cacheService.isConnected()) return;
    await this.haltUntilOpen(chainId);

    this.logger.log(`[Chain: ${chainId}]: Processing V2 pool events`);

    try {
      const lastBlockNumber = await this.getLatestBlockNumber(chainId);
      if (typeof lastBlockNumber === 'undefined') return;

      const events = Object.values(this.poolEvents);

      for (const eventHash of events) {
        const indexerEventStatus = await this.getIndexerEventStatus('GLOBAL', eventHash, chainId);
        if (indexerEventStatus.lastBlockNumber >= lastBlockNumber) continue;

        const connectionInfo = this.getConnectionInfo(chainId);
        const promises = connectionInfo.rpcInfos.map((rpcInfo) => {
          const provider = this.provider(rpcInfo, chainId);
          const blockStart = indexerEventStatus.lastBlockNumber + 1;
          let blockEnd = blockStart + (rpcInfo.queryBlockRange || DEFAULT_BLOCK_RANGE);
          blockEnd = Math.min(lastBlockNumber, blockEnd);

          return provider.getLogs({
            fromBlock: blockStart,
            toBlock: blockEnd,
            topics: [eventHash],
          });
        });

        const logData = await Promise.any(promises);
        const contractInterface = V2Pool__factory.createInterface();

        this.logger.log(
          `[Chain: ${chainId}] ${logData.length} matching logs found for ${eventHash}`,
        );

        for (const log of logData) {
          const poolAddress = log.address.toLowerCase();
          if (!this.WATCHED_ADDRESSES.has(poolAddress)) continue;

          const parsedLog = contractInterface.parseLog(log);
          if (!parsedLog) continue;

          this.logger.log(`[Chain: ${chainId}] Sequencing ${eventHash} on pool ${poolAddress}`);
          await this.processEvent(eventHash, poolAddress, chainId, log, parsedLog.args);
        }

        // Update status after processing the chunk
        const processedMaxBlock =
          logData.length > 0
            ? logData.reduce(
                (max, l) => (l.blockNumber > max ? l.blockNumber : max),
                logData[0].blockNumber,
              )
            : indexerEventStatus.lastBlockNumber;
        indexerEventStatus.lastBlockNumber = Math.max(
          indexerEventStatus.lastBlockNumber,
          processedMaxBlock,
        );
        await this.indexerEventStatusRepository.save(indexerEventStatus);
      }
    } catch (error: any) {
      this.logger.error(
        `[Chain: ${chainId}] Error occurred while sequencing event: ${error.stack}`,
      );
    } finally {
      await this.releaseResource(chainId);
    }
  }

  private async processEvent(
    eventName: string,
    address: string,
    chainId: number,
    log: Log,
    args: any,
  ) {
    const connectionInfo = this.getConnectionInfo(chainId);
    const blockPromises = connectionInfo.rpcInfos.map((rpcInfo) => {
      const provider = this.provider(rpcInfo, chainId);

      return provider.getBlock(log.blockNumber);
    });

    const processedBlock = await Promise.any(blockPromises);

    if (!processedBlock) return;

    const transactionId = `${log.transactionHash.toLowerCase()}-${chainId}`;
    let transactionEntity = await this.transactionRepository.findOneBy({ id: transactionId });

    if (transactionEntity === null) {
      transactionEntity = this.transactionRepository.create({
        hash: log.transactionHash.toLowerCase(),
        block: log.blockNumber,
        timestamp: processedBlock.timestamp,
        chainId,
      });
      transactionEntity = await this.transactionRepository.save(transactionEntity);
    }

    if (eventName === this.poolEvents.MINT) {
      const resolvableMint: IResolvableMintTransaction = {
        sender: args.sender,
        amount0: args.amount0.toString(),
        amount1: args.amount1.toString(),
        chainId,
        hash: transactionEntity.hash,
        logIndex: log.index,
      };
      await this.cacheService.hCache('mint', resolvableMint.hash, resolvableMint);
    } else if (eventName === this.poolEvents.BURN) {
      const resolvableBurn: IResolvableBurnTransaction = {
        sender: args.sender,
        amount0: args.amount0.toString(),
        amount1: args.amount1.toString(),
        chainId,
        hash: transactionEntity.hash,
        logIndex: log.index,
      };
      await this.cacheService.hCache('burn', resolvableBurn.hash, resolvableBurn);
    } else if (eventName === this.poolEvents.SWAP) {
      const resolvableSwap: IResolvableSwapTransaction = {
        from: args.sender,
        to: args.to,
        token: address.toLowerCase(),
        chainId,
        hash: transactionEntity.hash,
        amount0In: args.amount0In.toString(),
        amount1In: args.amount1In.toString(),
        amount0Out: args.amount0Out.toString(),
        amount1Out: args.amount1Out.toString(),
        logIndex: log.index,
        sender: args.sender,
      };
      await this.cacheService.hCache('swap', resolvableSwap.hash, resolvableSwap);
    } else if (eventName === this.poolEvents.TRANSFER) {
      const transactionPromises = connectionInfo.rpcInfos.map((rpcInfo) => {
        const provider = this.provider(rpcInfo, chainId);

        return provider.getTransaction(log.transactionHash);
      });

      const transaction = await Promise.any(transactionPromises);
      const resolvableTransfer: IResolvableTransferTransaction = {
        from: args.from,
        to: args.to,
        token: address.toLowerCase(),
        chainId,
        hash: transactionEntity.hash,
        amount: args.value.toString(),
        logIndex: log.index,
        sender: transaction?.from || args.from,
      };
      await this.cacheService.hCache('transfer', resolvableTransfer.hash, resolvableTransfer);
    } else if (eventName === this.poolEvents.SYNC) {
      await this.processSync(address, chainId, args.reserve0 as bigint, args.reserve1 as bigint);
    }

    this.updateChainMetric(chainId);
  }

  private async processSync(address: string, chainId: number, reserve0: bigint, reserve1: bigint) {
    const poolId = `${address.toLowerCase()}-${chainId}`;
    const poolEntity = await this.poolRepository.findOneOrFail({
      where: { id: poolId },
      relations: { token0: true, token1: true },
    });

    const token0 = await this.loadTokenPrice(poolEntity.token0);
    const token1 = await this.loadTokenPrice(poolEntity.token1);

    const statistics = await this.loadStatistics(chainId);
    statistics.totalVolumeLockedETH = statistics.totalVolumeLockedETH - poolEntity.reserveETH;

    token0.totalLiquidity = token0.totalLiquidity - poolEntity.reserve0;
    token1.totalLiquidity = token1.totalLiquidity - poolEntity.reserve1;

    poolEntity.reserve0 = parseFloat(formatUnits(reserve0, token0.decimals));
    poolEntity.reserve1 = parseFloat(formatUnits(reserve1, token1.decimals));

    if (poolEntity.reserve1 > 0) poolEntity.token0Price = poolEntity.reserve0 / poolEntity.reserve1;
    else poolEntity.token0Price = 0;

    if (poolEntity.reserve0 > 0) poolEntity.token1Price = poolEntity.reserve1 / poolEntity.reserve0;
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

    await Promise.all([
      this.poolRepository.save(poolEntity),
      this.statisticsRepository.save(statistics),
      this.tokenRepository.save(token0),
      this.tokenRepository.save(token1),
    ]);
  }

  private async resolveTransactionsForChain(chainId: number) {
    if (!this.cacheService.isConnected()) return;

    // Fetch all cached transactions once per chain
    const cachedTransfers = await this.cacheService.hObtainAll('transfer');
    const cachedSwaps = await this.cacheService.hObtainAll('swap');

    // Group transfers by token for this chain
    const transfersByToken: Record<string, IResolvableTransferTransaction[]> = {};
    for (const transfer of Object.values(cachedTransfers)) {
      const data = JSON.parse(transfer) as IResolvableTransferTransaction;
      if (data.chainId === chainId) {
        const token = data.token.toLowerCase();
        if (!transfersByToken[token]) transfersByToken[token] = [];
        transfersByToken[token].push(data);
      }
    }

    // Group swaps by token for this chain
    const swapsByToken: Record<string, { hash: string; data: IResolvableSwapTransaction }[]> = {};
    for (const [hash, stringValue] of Object.entries(cachedSwaps)) {
      const data = JSON.parse(stringValue) as IResolvableSwapTransaction;
      if (data.chainId === chainId) {
        const token = data.token.toLowerCase();
        if (!swapsByToken[token]) swapsByToken[token] = [];
        swapsByToken[token].push({ hash, data });
      }
    }

    // Process only pools that have pending events or are watched
    const tokensWithEvents = new Set([
      ...Object.keys(transfersByToken),
      ...Object.keys(swapsByToken),
    ]);

    for (const token of tokensWithEvents) {
      if (
        this.WATCHED_ADDRESSES.has(token) &&
        this.WATCHED_ADDRESSES_CHAINS.get(token) === chainId
      ) {
        await this.resolveTransactions(
          token,
          chainId,
          transfersByToken[token] || [],
          swapsByToken[token] || [],
        );
      }
    }
  }

  @OnEvent(EventTypes.V2_POOL_DEPLOYED)
  handleV2PoolDeployed(payload: ContractDeployEventPayload) {
    const events = Object.values(this.poolEvents);

    for (const eventName of events) {
      this.EVENT_TRACK_START_BLOCK[eventName] = payload.block;
      void this.getIndexerEventStatus(payload.address.toLowerCase(), eventName, payload.chainId);
    }

    this.WATCHED_ADDRESSES.add(payload.address.toLowerCase());
    this.WATCHED_ADDRESSES_CHAINS.set(payload.address.toLowerCase(), payload.chainId);
  }

  private async resolveTransactions(
    address: string,
    chainId: number,
    transfers: IResolvableTransferTransaction[],
    swaps: { hash: string; data: IResolvableSwapTransaction }[],
  ) {
    this.logger.log(`[Chain: ${chainId}] Attempting V2 transaction resolutions for ${address}...`);

    // Find cached transfers matching parameters
    const poolTransfers = transfers.filter(
      (transfer) => transfer.token.toLowerCase() === address.toLowerCase(),
    );

    // Find equivalent mints or burns
    for (const transfer of poolTransfers) {
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

    // Find cached swaps matching parameters
    const poolSwaps = swaps.filter(
      (swap) => swap.data.token.toLowerCase() === address.toLowerCase(),
    );

    for (const swap of poolSwaps) {
      await this.resolveSwap(swap.data);
      await this.cacheService.hDecache('swap', swap.hash);
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
    await this.waitFor(500);

    const token0 = await this.loadTokenPrice(poolEntity.token0);
    const token1 = await this.loadTokenPrice(poolEntity.token1);

    const txId = `${transferEntry.hash}-${transferEntry.chainId}`;
    const transactionEntity = await this.transactionRepository.findOneByOrFail({
      id: txId,
    });

    await this.waitFor(500);

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
    await this.waitFor(500);

    const token0 = await this.loadTokenPrice(poolEntity.token0);
    const token1 = await this.loadTokenPrice(poolEntity.token1);

    const txId = `${transferEntry.hash}-${transferEntry.chainId}`;
    const transactionEntity = await this.transactionRepository.findOneByOrFail({
      id: txId,
    });

    await this.waitFor(500);

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

    await this.waitFor(500);

    let token0 = await this.loadTokenPrice(poolEntity.token0);
    let token1 = await this.loadTokenPrice(poolEntity.token1);

    const txId = `${swapEntry.hash}-${swapEntry.chainId}`;
    const transactionEntity = await this.transactionRepository.findOneByOrFail({
      id: txId,
    });

    await this.waitFor(500);

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

  private async loadTokenPrice(token: Token): Promise<Token> {
    token.derivedUSD = await this.oracle.getPriceInUSD(token.address, token.chainId);
    token.derivedETH = await this.oracle.getPriceInETH(token.address, token.chainId);

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
      address: poolAddress.toLowerCase(),
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
    const hourIndex = Math.floor(timestamp / 3600);
    const hourStartUnix = hourIndex * 3600;
    const hourPoolId = `${poolAddress}-${hourIndex.toString()}`;
    const pool = await this.poolRepository.findOneByOrFail({
      address: poolAddress.toLowerCase(),
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
