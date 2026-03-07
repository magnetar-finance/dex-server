/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { id as keccak256, type Log } from 'ethers';
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BaseFactoryDeployedContractService } from './base/base-factory-deployed';
import { CONNECTION_INFO, DEFAULT_BLOCK_RANGE } from '../../../common/variables';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { CacheService } from '../../cache/cache.service';
import { IndexerEventStatus } from '../../database/entities/indexer-event-status.entity';
import { Pool, PoolType } from '../../database/entities/pool.entity';
import { Token } from '../../database/entities/token.entity';
import { DataSource, EntityManager, Repository } from 'typeorm';
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
    @InjectDataSource() private readonly dataSource: DataSource,
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

    for (const eventName of events)
      if (!this.EVENT_TRACK_START_BLOCK[eventName])
        this.EVENT_TRACK_START_BLOCK[eventName] = payload.block - 1;

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

  private async processEvent(eventHash: string, chainId: number, log: Log, args: any) {
    await this.waitFor(3000); // Wait for 3 seconds
    const processedBlock = await log.getBlock();

    const transactionId = `${log.transactionHash.toLowerCase()}-${chainId}`;
    let transactionEntity = await this.transactionRepository.findOneBy({ id: transactionId });

    if (transactionEntity === null) {
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();
      try {
        const txRepo = queryRunner.manager.getRepository(Transaction);
        const created = txRepo.create({
          hash: log.transactionHash.toLowerCase(),
          block: log.blockNumber,
          timestamp: processedBlock.timestamp,
          chainId,
        });
        transactionEntity = await queryRunner.manager.save(created);
        await queryRunner.commitTransaction();
      } catch (error) {
        await queryRunner.rollbackTransaction();
        throw error;
      } finally {
        await queryRunner.release();
      }
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

    const mintQueryRunner = this.dataSource.createQueryRunner();
    await mintQueryRunner.connect();
    await mintQueryRunner.startTransaction();
    let mintEntity: Mint;
    try {
      const manager = mintQueryRunner.manager;
      const mintRepo = manager.getRepository(Mint);

      let mint = await mintRepo.findOneBy({
        id: `mint-${transactionEntity.hash.toLowerCase()}-${transactionEntity.chainId}`,
      });

      if (mint === null) {
        mint = mintRepo.create({
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
        mint = await manager.save(mint);
      }

      token0.txCount = token0.txCount + 1;
      token1.txCount = token1.txCount + 1;
      poolEntity.txCount = poolEntity.txCount + 1;
      poolEntity.totalSupply = poolEntity.totalSupply + liquidity;

      const [_t0, _t1, _pool] = await Promise.all([
        manager.save(token0),
        manager.save(token1),
        manager.save(poolEntity),
      ]);

      const statistics = await this.loadStatistics(chainId);
      statistics.txCount = statistics.txCount + 1;
      await manager.save(statistics);

      const overallDayData = await this.updateOverallDayData(
        transactionEntity.timestamp,
        transactionEntity.chainId,
        manager,
      );
      const poolDayData = await this.updatePoolDayData(
        transactionEntity.timestamp,
        poolEntity.address.toLowerCase(),
        manager,
      );
      const poolHourData = await this.updatePoolHourData(
        transactionEntity.timestamp,
        poolEntity.address.toLowerCase(),
        manager,
      );
      const token0DayData = await this.updateTokenDayData(
        _t0,
        transactionEntity.timestamp,
        manager,
      );
      const token1DayData = await this.updateTokenDayData(
        _t1,
        transactionEntity.timestamp,
        manager,
      );

      overallDayData.feesUSD = overallDayData.feesUSD + _pool.totalFeesUSD;
      overallDayData.volumeETH = overallDayData.volumeETH + amountETH;
      overallDayData.volumeUSD = overallDayData.volumeUSD + amountUSD;
      await manager.save(overallDayData);

      poolDayData.dailyVolumeToken0 = poolDayData.dailyVolumeToken0 + amount0;
      poolDayData.dailyVolumeToken1 = poolDayData.dailyVolumeToken1 + amount1;
      poolDayData.dailyVolumeETH = poolDayData.dailyVolumeETH + amountETH;
      poolDayData.dailyVolumeUSD = poolDayData.dailyVolumeUSD + amountUSD;
      await manager.save(poolDayData);

      poolHourData.hourlyVolumeToken0 = poolHourData.hourlyVolumeToken0 + amount0;
      poolHourData.hourlyVolumeToken1 = poolHourData.hourlyVolumeToken1 + amount1;
      poolHourData.hourlyVolumeETH = poolHourData.hourlyVolumeETH + amountETH;
      poolHourData.hourlyVolumeUSD = poolHourData.hourlyVolumeUSD + amountUSD;
      await manager.save(poolHourData);

      token0DayData.dailyVolumeToken = token0DayData.dailyVolumeToken + amount0;
      token0DayData.dailyVolumeETH = token0DayData.dailyVolumeETH + amount0ETH;
      token0DayData.dailyVolumeUSD = token0DayData.dailyVolumeUSD + amount0USD;
      await manager.save(token0DayData);

      token1DayData.dailyVolumeToken = token1DayData.dailyVolumeToken + amount1;
      token1DayData.dailyVolumeETH = token1DayData.dailyVolumeETH + amount1ETH;
      token1DayData.dailyVolumeUSD = token1DayData.dailyVolumeUSD + amount1USD;
      await manager.save(token1DayData);

      mintEntity = mint;
      await mintQueryRunner.commitTransaction();
    } catch (error) {
      await mintQueryRunner.rollbackTransaction();
      throw error;
    } finally {
      await mintQueryRunner.release();
    }

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

    const burnQueryRunner = this.dataSource.createQueryRunner();
    await burnQueryRunner.connect();
    await burnQueryRunner.startTransaction();
    let burnEntity: Burn;
    try {
      const manager = burnQueryRunner.manager;
      const burnRepo = manager.getRepository(Burn);

      let burn = await burnRepo.findOneBy({
        id: `burn-${transactionEntity.hash.toLowerCase()}-${transactionEntity.chainId}`,
      });

      if (burn === null) {
        burn = burnRepo.create({
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
        burn = await manager.save(burn);
      }

      token0.txCount = token0.txCount + 1;
      token1.txCount = token1.txCount + 1;
      poolEntity.txCount = poolEntity.txCount + 1;
      poolEntity.totalSupply = poolEntity.totalSupply - liquidity;

      const [_t0, _t1] = await Promise.all([
        manager.save(token0),
        manager.save(token1),
        manager.save(poolEntity),
      ]);

      const statistics = await this.loadStatistics(chainId);
      statistics.txCount = statistics.txCount + 1;
      await manager.save(statistics);

      await this.updateOverallDayData(
        transactionEntity.timestamp,
        transactionEntity.chainId,
        manager,
      );
      await this.updatePoolDayData(
        transactionEntity.timestamp,
        poolEntity.address.toLowerCase(),
        manager,
      );
      await this.updatePoolHourData(
        transactionEntity.timestamp,
        poolEntity.address.toLowerCase(),
        manager,
      );
      await this.updateTokenDayData(_t0, transactionEntity.timestamp, manager);
      await this.updateTokenDayData(_t1, transactionEntity.timestamp, manager);

      burnEntity = burn;
      await burnQueryRunner.commitTransaction();
    } catch (error) {
      await burnQueryRunner.rollbackTransaction();
      throw error;
    } finally {
      await burnQueryRunner.release();
    }

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

    const swapQueryRunner = this.dataSource.createQueryRunner();
    await swapQueryRunner.connect();
    await swapQueryRunner.startTransaction();
    let swapEntity: Swap;
    try {
      const manager = swapQueryRunner.manager;
      const swapRepo = manager.getRepository(Swap);

      let swap = await swapRepo.findOneBy({
        id: `swap-${transactionEntity.hash.toLowerCase()}-${transactionEntity.chainId}`,
      });

      if (swap === null) {
        swap = swapRepo.create({
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
        swap = await manager.save(swap);
      }

      poolEntity.volumeETH = poolEntity.volumeETH + amount0ETH + amount1ETH;
      poolEntity.volumeUSD = poolEntity.volumeUSD + amount0USD + amount1USD;
      poolEntity.volumeToken0 = poolEntity.volumeToken0 + amount0Total;
      poolEntity.volumeToken1 = poolEntity.volumeToken1 + amount1Total;
      poolEntity.txCount = poolEntity.txCount + 1;
      await manager.save(poolEntity);

      token0.tradeVolume = token0.tradeVolume + amount0Total;
      token0.tradeVolumeUSD = token0.tradeVolumeUSD + amount0USD;
      token0.txCount = token0.txCount + 1;
      token0 = await manager.save(token0);

      token1.tradeVolume = token1.tradeVolume + amount1Total;
      token1.tradeVolumeUSD = token1.tradeVolumeUSD + amount1USD;
      token1.txCount = token1.txCount + 1;
      token1 = await manager.save(token1);

      const statistics = await this.loadStatistics(chainId);
      statistics.totalTradeVolumeETH = statistics.totalTradeVolumeETH + amount0ETH + amount1ETH;
      statistics.totalTradeVolumeUSD = statistics.totalTradeVolumeUSD + amount0USD + amount1USD;
      statistics.txCount = statistics.txCount + 1;
      await manager.save(statistics);

      const overallDayData = await this.updateOverallDayData(
        transactionEntity.timestamp,
        transactionEntity.chainId,
        manager,
      );
      const poolDayData = await this.updatePoolDayData(
        transactionEntity.timestamp,
        poolEntity.address.toLowerCase(),
        manager,
      );
      const poolHourData = await this.updatePoolHourData(
        transactionEntity.timestamp,
        poolEntity.address.toLowerCase(),
        manager,
      );
      const token0DayData = await this.updateTokenDayData(
        token0,
        transactionEntity.timestamp,
        manager,
      );
      const token1DayData = await this.updateTokenDayData(
        token1,
        transactionEntity.timestamp,
        manager,
      );

      overallDayData.feesUSD = overallDayData.feesUSD + poolEntity.totalFeesUSD;
      overallDayData.volumeETH = overallDayData.volumeETH + amount0ETH + amount1ETH;
      overallDayData.volumeUSD = overallDayData.volumeUSD + amount0USD + amount1USD;
      await manager.save(overallDayData);

      poolDayData.dailyVolumeToken0 = poolDayData.dailyVolumeToken0 + amount0Total;
      poolDayData.dailyVolumeToken1 = poolDayData.dailyVolumeToken1 + amount1Total;
      poolDayData.dailyVolumeETH = poolDayData.dailyVolumeETH + amount0ETH + amount1ETH;
      poolDayData.dailyVolumeUSD = poolDayData.dailyVolumeUSD + amount0USD + amount1USD;
      await manager.save(poolDayData);

      poolHourData.hourlyVolumeToken0 = poolHourData.hourlyVolumeToken0 + amount0Total;
      poolHourData.hourlyVolumeToken1 = poolHourData.hourlyVolumeToken1 + amount1Total;
      poolHourData.hourlyVolumeETH = poolHourData.hourlyVolumeETH + amount0ETH + amount1ETH;
      poolHourData.hourlyVolumeUSD = poolHourData.hourlyVolumeUSD + amount0USD + amount1USD;
      await manager.save(poolHourData);

      token0DayData.dailyVolumeToken = token0DayData.dailyVolumeToken + amount0Total;
      token0DayData.dailyVolumeETH = token0DayData.dailyVolumeETH + amount0ETH;
      token0DayData.dailyVolumeUSD = token0DayData.dailyVolumeUSD + amount0USD;
      await manager.save(token0DayData);

      token1DayData.dailyVolumeToken = token1DayData.dailyVolumeToken + amount1Total;
      token1DayData.dailyVolumeETH = token1DayData.dailyVolumeETH + amount1ETH;
      token1DayData.dailyVolumeUSD = token1DayData.dailyVolumeUSD + amount1USD;
      await manager.save(token1DayData);

      swapEntity = swap;
      await swapQueryRunner.commitTransaction();
    } catch (error) {
      await swapQueryRunner.rollbackTransaction();
      throw error;
    } finally {
      await swapQueryRunner.release();
    }

    return swapEntity;
  }

  private async loadTokenPrice(token: Token): Promise<Token> {
    token.derivedUSD = await this.oracle.getPriceInUSD(token.address, token.chainId);
    token.derivedETH = await this.oracle.getPriceInETH(token.address, token.chainId);

    return token;
  }

  private async updateOverallDayData(timestamp: number, chainId: number, manager?: EntityManager) {
    const repo = manager ? manager.getRepository(OverallDayData) : this.overallDayDataRepository;
    const statistics = await this.loadStatistics(chainId);
    const dayId = Math.floor(timestamp / 86400);
    const dataId = `${dayId.toString()}-${chainId}`;
    const dayStartTimestamp = dayId * 86400;

    let overallDayData = await repo.findOneBy({ id: dataId });
    if (overallDayData === null) {
      overallDayData = repo.create({
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

      overallDayData = await repo.save(overallDayData);
    }

    overallDayData.liquidityUSD = statistics.totalVolumeLockedUSD;
    overallDayData.liquidityETH = statistics.totalVolumeLockedETH;
    overallDayData.totalTradeVolumeETH = statistics.totalTradeVolumeETH;
    overallDayData.totalTradeVolumeUSD = statistics.totalTradeVolumeUSD;
    overallDayData.txCount = overallDayData.txCount + 1;
    return repo.save(overallDayData);
  }

  private async updatePoolDayData(timestamp: number, poolAddress: string, manager?: EntityManager) {
    const repo = manager ? manager.getRepository(PoolDayData) : this.poolDayDataRepository;
    const poolRepo = manager ? manager.getRepository(Pool) : this.poolRepository;
    const dayId = Math.floor(timestamp / 86400);
    const dayStartTimestamp = dayId * 86400;
    const dayPoolId = `${poolAddress}-${dayId.toString()}`;
    const pool = await poolRepo.findOneByOrFail({
      address: poolAddress.toLowerCase(),
    });

    let poolDayData = await repo.findOneBy({ id: dayPoolId });

    if (poolDayData === null) {
      poolDayData = repo.create({
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

      poolDayData = await repo.save(poolDayData);
    }

    poolDayData.totalSupply = pool.totalSupply;
    poolDayData.reserve0 = pool.reserve0;
    poolDayData.reserve1 = pool.reserve1;
    poolDayData.reserveETH = pool.reserveETH;
    poolDayData.reserveUSD = pool.reserveUSD;
    poolDayData.dailyTxns = poolDayData.dailyTxns + 1;

    return repo.save(poolDayData);
  }

  private async updatePoolHourData(
    timestamp: number,
    poolAddress: string,
    manager?: EntityManager,
  ) {
    const repo = manager ? manager.getRepository(PoolHourData) : this.poolHourDataRepository;
    const poolRepo = manager ? manager.getRepository(Pool) : this.poolRepository;
    const hourIndex = Math.floor(timestamp / 3600);
    const hourStartUnix = hourIndex * 3600;
    const hourPoolId = `${poolAddress}-${hourIndex.toString()}`;
    const pool = await poolRepo.findOneByOrFail({
      address: poolAddress.toLowerCase(),
    });

    let poolHourData = await repo.findOneBy({ id: hourPoolId });
    if (poolHourData === null) {
      poolHourData = repo.create({
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

      poolHourData = await repo.save(poolHourData);
    }

    poolHourData.totalSupply = pool.totalSupply;
    poolHourData.reserve0 = pool.reserve0;
    poolHourData.reserve1 = pool.reserve1;
    poolHourData.reserveETH = pool.reserveETH;
    poolHourData.reserveUSD = pool.reserveUSD;
    poolHourData.hourlyTxns = poolHourData.hourlyTxns + 1;

    return repo.save(poolHourData);
  }

  private async updateTokenDayData(token: Token, timestamp: number, manager?: EntityManager) {
    const repo = manager ? manager.getRepository(TokenDayData) : this.tokenDayDataRepository;
    const dayId = Math.floor(timestamp / 86400);
    const dayStartTimestamp = dayId * 86400;
    const tokenDayId = `${token.address.toLowerCase()}-${dayId.toString()}`;

    let tokenDayData = await repo.findOneBy({ id: tokenDayId });
    if (tokenDayData === null) {
      tokenDayData = repo.create({
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

      tokenDayData = await repo.save(tokenDayData);
    }

    tokenDayData.priceUSD = token.derivedUSD;
    tokenDayData.priceETH = token.derivedETH;
    tokenDayData.totalLiquidityToken = token.totalLiquidity;
    tokenDayData.totalLiquidityETH = token.totalLiquidity * token.derivedETH;
    tokenDayData.totalLiquidityUSD = token.totalLiquidity * token.derivedUSD;
    tokenDayData.dailyTxns = tokenDayData.dailyTxns + 1;

    return repo.save(tokenDayData);
  }
}
