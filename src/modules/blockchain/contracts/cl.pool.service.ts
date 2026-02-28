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
import { Repository } from 'typeorm';
import { ChainConnectionInfo } from '../interfaces';
import { OnEvent } from '@nestjs/event-emitter';
import { type ContractDeployEventPayload, EventTypes } from './types';
import { ClPool__factory } from './typechain';
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
import { Cron, CronExpression } from '@nestjs/schedule';

interface IResolvableCLTransaction {
  chainId: number;
  hash: string;
  logIndex: number;
  sender: string;
}

interface IResolvableCLMintTransaction extends IResolvableCLTransaction {
  amountA: string;
  amountB: string;
  mintValue: string;
  to: string;
}

interface IResolvableCLBurnTransaction extends IResolvableCLTransaction {
  amountA: string;
  amountB: string;
  burnValue: string;
  to: string;
}

interface IResolvableCLSwapTransaction extends IResolvableCLTransaction {
  from: string;
  to: string;
  amountA: string;
  amountB: string;
}

@Injectable()
export class CLPoolService
  extends BaseFactoryDeployedContractService
  implements OnModuleInit, OnModuleDestroy
{
  private poolEvents = {
    MINT: keccak256('Mint(address,address,int24,int24,uint128,uint256,uint256)'),
    BURN: keccak256('Burn(address,int24,int24,uint128,uint256,uint256)'),
    SWAP: keccak256('Swap(address,address,int256,int256,uint160,uint128,int24)'),
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
      poolType: PoolType.CONCENTRATED,
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
        `[Chain: ${chainId}] Global CL sequencing error → ${error.message}`,
        error.stack,
      );
      await this.waitFor(5000);
    }
  }

  @OnEvent(EventTypes.CL_POOL_DEPLOYED)
  handleCLPoolDeployed(payload: ContractDeployEventPayload) {
    const events = Object.values(this.poolEvents);

    for (const eventName of events) {
      this.EVENT_TRACK_START_BLOCK[eventName] = payload.block;
      void this.getIndexerEventStatus(payload.address.toLowerCase(), eventName, payload.chainId);
    }

    this.WATCHED_ADDRESSES.add(payload.address.toLowerCase());
    this.WATCHED_ADDRESSES_CHAINS.set(payload.address.toLowerCase(), payload.chainId);
  }

  private async handleEvents(chainId: number) {
    if (!this.cacheService.isConnected()) return;
    await this.haltUntilOpen(chainId);

    this.logger.log(`[Chain: ${chainId}]: Processing CL pool events`);

    try {
      const lastBlockNumber = await this.getLatestBlockNumber(chainId);
      if (typeof lastBlockNumber === 'undefined') return;

      const events = Object.values(this.poolEvents);

      for (const eventHash of events) {
        const indexerEventStatus = await this.getIndexerEventStatus(
          'GLOBAL_CL',
          eventHash,
          chainId,
        );
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
        const contractInterface = ClPool__factory.createInterface();

        this.logger.log(
          `[Chain: ${chainId}] ${logData.length} matching logs found for ${eventHash}`,
        );

        for (const log of logData) {
          const poolAddress = log.address.toLowerCase();
          if (!this.WATCHED_ADDRESSES.has(poolAddress)) continue;

          const parsedLog = contractInterface.parseLog(log);
          if (!parsedLog) continue;

          this.logger.log(`[Chain: ${chainId}] Sequencing ${eventHash} on pool ${poolAddress}`);
          await this.processEvent(eventHash, chainId, log, parsedLog.args);
        }

        const processedMaxBlock =
          logData.length > 0
            ? Math.max(...logData.map((l) => l.blockNumber))
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

  private async processEvent(eventHash: string, chainId: number, log: Log, args: any) {
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

    if (eventHash === this.poolEvents.MINT) {
      const resolvableMint: IResolvableCLMintTransaction & { poolAddress: string } = {
        poolAddress: log.address.toLowerCase(),
        to: args.owner,
        amountA: args.amount0.toString(),
        amountB: args.amount1.toString(),
        mintValue: args.amount.toString(),
        chainId,
        hash: transactionEntity.hash,
        logIndex: log.index,
        sender: args.sender,
      };
      await this.cacheService.hCache(
        'cl-mint',
        resolvableMint.hash,
        JSON.stringify(resolvableMint),
      );
    } else if (eventHash === this.poolEvents.BURN) {
      const resolvableBurn: IResolvableCLBurnTransaction & { poolAddress: string } = {
        poolAddress: log.address.toLowerCase(),
        to: args.owner,
        amountA: args.amount0.toString(),
        amountB: args.amount1.toString(),
        burnValue: args.amount.toString(),
        chainId,
        hash: transactionEntity.hash,
        logIndex: log.index,
        sender: args.owner,
      };
      await this.cacheService.hCache(
        'cl-burn',
        resolvableBurn.hash,
        JSON.stringify(resolvableBurn),
      );
    } else if (eventHash === this.poolEvents.SWAP) {
      const resolvableSwap: IResolvableCLSwapTransaction & { poolAddress: string } = {
        poolAddress: log.address.toLowerCase(),
        from: args.sender,
        to: args.recipient,
        chainId,
        hash: transactionEntity.hash,
        amountA: args.amount0.toString(),
        amountB: args.amount1.toString(),
        logIndex: log.index,
        sender: args.sender,
      };
      await this.cacheService.hCache(
        'cl-swap',
        resolvableSwap.hash,
        JSON.stringify(resolvableSwap),
      );
    }

    this.updateChainMetric(chainId);
  }

  private async resolveTransactionsForChain(chainId: number) {
    if (!this.cacheService.isConnected()) return;

    // Fetch all cached transactions once per chain
    const [cachedMints, cachedBurns, cachedSwaps] = await Promise.all([
      this.cacheService.hObtainAll('cl-mint'),
      this.cacheService.hObtainAll('cl-burn'),
      this.cacheService.hObtainAll('cl-swap'),
    ]);

    // Group events by poolAddress for this chain
    const mintsByPool: Record<string, Record<string, string>> = {};
    for (const [hash, stringValue] of Object.entries(cachedMints)) {
      const data = JSON.parse(stringValue) as IResolvableCLMintTransaction & {
        poolAddress?: string;
      };
      if (data.chainId === chainId) {
        const pool = (data.poolAddress || '').toLowerCase();
        if (pool) {
          if (!mintsByPool[pool]) mintsByPool[pool] = {};
          mintsByPool[pool][hash] = stringValue;
        }
      }
    }

    const burnsByPool: Record<string, Record<string, string>> = {};
    for (const [hash, stringValue] of Object.entries(cachedBurns)) {
      const data = JSON.parse(stringValue) as IResolvableCLBurnTransaction & {
        poolAddress?: string;
      };
      if (data.chainId === chainId) {
        const pool = (data.poolAddress || '').toLowerCase();
        if (pool) {
          if (!burnsByPool[pool]) burnsByPool[pool] = {};
          burnsByPool[pool][hash] = stringValue;
        }
      }
    }

    const swapsByPool: Record<string, Record<string, string>> = {};
    for (const [hash, stringValue] of Object.entries(cachedSwaps)) {
      const data = JSON.parse(stringValue) as IResolvableCLSwapTransaction & {
        poolAddress?: string;
      };
      if (data.chainId === chainId) {
        const pool = (data.poolAddress || '').toLowerCase();
        if (pool) {
          if (!swapsByPool[pool]) swapsByPool[pool] = {};
          swapsByPool[pool][hash] = stringValue;
        }
      }
    }

    const allPoolsWithEvents = new Set([
      ...Object.keys(mintsByPool),
      ...Object.keys(burnsByPool),
      ...Object.keys(swapsByPool),
    ]);

    for (const poolAddress of allPoolsWithEvents) {
      if (
        this.WATCHED_ADDRESSES.has(poolAddress) &&
        this.WATCHED_ADDRESSES_CHAINS.get(poolAddress) === chainId
      ) {
        await this.resolveTransactions(
          poolAddress,
          chainId,
          mintsByPool[poolAddress] || {},
          burnsByPool[poolAddress] || {},
          swapsByPool[poolAddress] || {},
        );
      }
    }
  }

  private async resolveTransactions(
    address: string,
    chainId: number,
    mints: Record<string, string>,
    burns: Record<string, string>,
    swaps: Record<string, string>,
  ) {
    this.logger.log(`[Chain: ${chainId}] Attempting CL transaction resolutions for ${address}...`);

    for (const [hash, stringValue] of Object.entries(mints)) {
      await this.resolveMint(
        address,
        chainId,
        JSON.parse(stringValue) as IResolvableCLMintTransaction,
      );
      await this.cacheService.hDecache('cl-mint', hash);
    }

    for (const [hash, stringValue] of Object.entries(burns)) {
      await this.resolveBurn(
        address,
        chainId,
        JSON.parse(stringValue) as IResolvableCLBurnTransaction,
      );
      await this.cacheService.hDecache('cl-burn', hash);
    }

    for (const [hash, stringValue] of Object.entries(swaps)) {
      await this.resolveSwap(
        address,
        chainId,
        JSON.parse(stringValue) as IResolvableCLSwapTransaction,
      );
      await this.cacheService.hDecache('cl-swap', hash);
    }
  }

  private async resolveMint(
    poolAddress: string,
    chainId: number,
    resolvableMint: IResolvableCLMintTransaction,
  ) {
    const poolId = `${poolAddress.toLowerCase()}-${chainId}`;
    const poolEntity = await this.poolRepository.findOneOrFail({
      where: { id: poolId },
      relations: { token0: true, token1: true },
    });
    await this.waitFor(500);

    const token0 = await this.loadTokenPrice(poolEntity.token0);
    const token1 = await this.loadTokenPrice(poolEntity.token1);

    const txId = `${resolvableMint.hash}-${chainId}`;
    const transactionEntity = await this.transactionRepository.findOneByOrFail({
      id: txId,
    });

    await this.waitFor(500);

    const amount0 = parseFloat(formatUnits(resolvableMint.amountA, token0.decimals));
    const amount1 = parseFloat(formatUnits(resolvableMint.amountB, token1.decimals));
    const amount0USD = amount0 * token0.derivedUSD;
    const amount1USD = amount1 * token1.derivedUSD;
    const amountUSD = amount0USD + amount1USD;

    const amount0ETH = amount0 * token0.derivedETH;
    const amount1ETH = amount1 * token1.derivedETH;
    const amountETH = amount0ETH + amount1ETH;
    const liquidity = parseFloat(formatEther(resolvableMint.mintValue));

    let mintEntity = await this.mintRepository.findOneBy({
      id: `mint-${transactionEntity.hash.toLowerCase()}-${transactionEntity.chainId}`,
    });

    if (mintEntity === null) {
      mintEntity = this.mintRepository.create({
        transaction: transactionEntity,
        to: resolvableMint.to,
        chainId: transactionEntity.chainId,
        pool: poolEntity,
        amount0,
        amount1,
        amountUSD,
        sender: resolvableMint.sender,
        logIndex: resolvableMint.logIndex,
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

    const statistics = await this.loadStatistics(chainId);
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

    return mintEntity;
  }

  private async resolveBurn(
    poolAddress: string,
    chainId: number,
    resolvableBurn: IResolvableCLBurnTransaction,
  ) {
    const poolId = `${poolAddress.toLowerCase()}-${chainId}`;
    const poolEntity = await this.poolRepository.findOneOrFail({
      where: { id: poolId },
      relations: { token0: true, token1: true },
    });
    await this.waitFor(500);

    const token0 = await this.loadTokenPrice(poolEntity.token0);
    const token1 = await this.loadTokenPrice(poolEntity.token1);

    const txId = `${resolvableBurn.hash.toLowerCase()}-${chainId}`;
    const transactionEntity = await this.transactionRepository.findOneByOrFail({
      id: txId,
    });

    await this.waitFor(500);

    const amount0 = parseFloat(formatUnits(resolvableBurn.amountA, token0.decimals));
    const amount1 = parseFloat(formatUnits(resolvableBurn.amountB, token1.decimals));
    const amount0USD = amount0 * token0.derivedUSD;
    const amount1USD = amount1 * token1.derivedUSD;
    const amountUSD = amount0USD + amount1USD;
    const liquidity = parseFloat(formatEther(resolvableBurn.burnValue));

    let burnEntity = await this.burnRepository.findOneBy({
      id: `burn-${transactionEntity.hash.toLowerCase()}-${transactionEntity.chainId}`,
    });

    if (burnEntity === null) {
      burnEntity = this.burnRepository.create({
        transaction: transactionEntity,
        to: resolvableBurn.to,
        chainId: transactionEntity.chainId,
        pool: poolEntity,
        amount0,
        amount1,
        amountUSD,
        sender: resolvableBurn.sender,
        logIndex: resolvableBurn.logIndex,
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

    const statistics = await this.loadStatistics(chainId);
    statistics.txCount = statistics.txCount + 1;
    await this.statisticsRepository.save(statistics);

    await this.updateOverallDayData(transactionEntity.timestamp, transactionEntity.chainId);
    await this.updatePoolDayData(transactionEntity.timestamp, poolEntity.address.toLowerCase());
    await this.updatePoolHourData(transactionEntity.timestamp, poolEntity.address.toLowerCase());
    await this.updateTokenDayData(_t0, transactionEntity.timestamp);
    await this.updateTokenDayData(_t1, transactionEntity.timestamp);
    return burnEntity;
  }

  private async resolveSwap(
    poolAddress: string,
    chainId: number,
    resolvableSwap: IResolvableCLSwapTransaction,
  ) {
    const poolId = `${poolAddress.toLowerCase()}-${chainId}`;
    const poolEntity = await this.poolRepository.findOneOrFail({
      where: { id: poolId },
      relations: { token0: true, token1: true },
    });

    await this.waitFor(500);

    let token0 = await this.loadTokenPrice(poolEntity.token0);
    let token1 = await this.loadTokenPrice(poolEntity.token1);

    const txId = `${resolvableSwap.hash.toLowerCase()}-${chainId}`;
    const transactionEntity = await this.transactionRepository.findOneByOrFail({
      id: txId,
    });

    const amount0 = parseFloat(formatUnits(resolvableSwap.amountA, token0.decimals));
    const amount1 = parseFloat(formatUnits(resolvableSwap.amountB, token1.decimals));
    const amount0ETH = amount0 * token0.derivedETH;
    const amount0USD = amount0 * token0.derivedUSD;
    const amount1ETH = amount1 * token1.derivedETH;
    const amount1USD = amount1 * token1.derivedUSD;

    const amount0In = amount0 < 0 ? 0 : amount0;
    const amount0Out = amount0 < 0 ? Math.abs(amount0) : 0;
    const amount1In = amount1 < 0 ? 0 : amount1;
    const amount1Out = amount1 < 0 ? Math.abs(amount1) : 0;
    const amount0Total = amount0In + amount0Out;
    const amount1Total = amount1In + amount1Out;

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
        from: resolvableSwap.from,
        to: resolvableSwap.to,
        logIndex: resolvableSwap.logIndex,
        sender: resolvableSwap.sender,
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

    const statistics = await this.loadStatistics(chainId);
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

    return swapEntity;
  }

  private async loadTokenPrice(token: Token): Promise<Token> {
    token.derivedUSD = await this.oracle.getPriceInUSD(token.address, token.chainId);
    token.derivedETH = await this.oracle.getPriceInETH(token.address, token.chainId);

    return token;
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
        id: dataId,
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
