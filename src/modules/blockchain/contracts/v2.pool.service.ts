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
import { Equal, ILike, Or, Repository } from 'typeorm';
import { ChainConnectionInfo } from '../interfaces';
import { OnEvent } from '@nestjs/event-emitter';
import { type ContractDeployEventPayload, EventTypes } from './types';
import { V2Pool, V2Pool__factory } from './typechain';
import { formatUnits, JsonRpcProvider } from 'ethers';
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

interface IResolvableTransaction {
  chainId: number;
  hash: string;
}

interface IResolvableMintTransaction extends IResolvableTransaction {
  sender: string;
  amount0: bigint;
  amount1: bigint;
  logIndex: number;
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
    private readonly oracle: OracleService,
  ) {
    super(connectionInfo, cacheService, repository, statisticsRepository);
  }

  async onModuleInit() {
    await this.initializeWatchedAddresses();

    this.resolveTxs = true;
    this.sequenceEv = true;

    await Promise.all([this.resolveTransactions(), this.sequenceAllEvents()]);
  }

  private async initializeWatchedAddresses() {
    const pools = await this.poolRepository.findBy({
      poolType: Or(Equal(PoolType.STABLE), Equal(PoolType.VOLATILE)),
    });

    // Watch pools
    pools.forEach((pool) => {
      this.WATCHED_ADDRESSES.add(pool.address.toLowerCase());
      this.WATCHED_ADDRESSES_CHAINS.set(
        pool.address.toLowerCase(),
        pool.chainId,
      );
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
        logIndex: eventDatum.index,
      };

      await this.cacheService.hCache(
        'mint',
        resolvableMint.hash,
        resolvableMint,
      );
    }

    await this.indexerEventStatusRepository.save(indexerEventStatus);
    await this.releaseResource(chainId);
  }

  private async handleTransfer(address: string, chainId: number) {
    await this.haltUntilOpen(chainId);
    const lastBlockNumber = await this.getLatestBlockNumber(chainId);

    const indexerEventStatus = await this.getIndexerEventStatus(
      address,
      'Transfer',
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
      return contract.queryFilter(
        contract.filters.Transfer,
        blockStart,
        blockEnd,
      );
    });

    // Wait for 3 secs
    await this.waitFor(3000);
    const eventData = await Promise.any(promises);

    for (const eventDatum of eventData) {
      const processedBlock = await eventDatum.getBlock();
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

        transactionEntity =
          await this.transactionRepository.save(transactionEntity);
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
      };

      await this.cacheService.hCache(
        'transfer',
        resolvableTransfer.hash,
        resolvableTransfer,
      );

      await this.indexerEventStatusRepository.save(indexerEventStatus);
      await this.releaseResource(chainId);
    }
  }

  private async sequenceEvents(address: string, chainId: number) {
    while (this.sequenceEv) {
      await this.handleTransfer(address, chainId);
      await this.handleMint(address, chainId);
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
      // Fetch all cached transfers
      const cachedTransfers = await this.cacheService.hObtainAll('transfer');

      for (const [hash, stringValue] of Object.entries(cachedTransfers)) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const resolvableTransfer: IResolvableTransferTransaction =
          JSON.parse(stringValue);
        // Search for corresponding mint
        const resolvableMint =
          await this.cacheService.hObtain<IResolvableMintTransaction>(
            'mint',
            hash,
          );

        if (resolvableMint !== null) {
          await this.resolveMint(resolvableTransfer, resolvableMint);
          // Clear entries from cache
          await this.cacheService.hDecache('mint', hash);
          await this.cacheService.hDecache('transfer', hash);
        }
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

    // To do: Price update

    // Tokens metadata
    await this.waitFor(3000); // wait for 3 secs

    const token0Metadata = await this.getERC20Metadata(
      poolEntity.token0.address,
      poolEntity.chainId,
    );
    const token1Metadata = await this.getERC20Metadata(
      poolEntity.token1.address,
      poolEntity.chainId,
    );

    const amount0 = parseFloat(
      formatUnits(mintEntry.amount0, token0Metadata.decimals),
    );
    const amount1 = parseFloat(
      formatUnits(mintEntry.amount1, token1Metadata.decimals),
    );
    const amount0USD = amount0 * token0.derivedUSD;
    const amount1USD = amount1 * token1.derivedUSD;
    const amountUSD = amount0USD + amount1USD;

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
    });

    mintEntity = await this.mintRepository.save(mintEntity);

    token0.txCount = token0.txCount + 1;
    token1.txCount = token1.txCount + 1;
    poolEntity.txCount = poolEntity.txCount + 1;

    const [_t0, _t1, _pool] = await Promise.all([
      this.tokenRepository.save(token0),
      this.tokenRepository.save(token1),
      this.poolRepository.save(poolEntity),
    ]);

    // Update data
    const statistics = await this.loadStatistics();
    statistics.txCount = statistics.txCount + 1;
    await this.statisticsRepository.save(statistics);

    const overallDayData = await this.updateOverallDayData(
      transactionEntity.timestamp,
    );
    const poolDayData = await this.updatePoolDayData(
      transactionEntity.timestamp,
      poolEntity.address.toLowerCase(),
    );
    const poolHourData = await this.updatePoolHourData(
      transactionEntity.timestamp,
      poolEntity.address.toLowerCase(),
    );
    const token0DayData = await this.updateTokenDayData(
      _t0,
      transactionEntity.timestamp,
    );
    const token1DayData = await this.updateTokenDayData(
      _t1,
      transactionEntity.timestamp,
    );

    overallDayData.feesUSD = overallDayData.feesUSD + _pool.totalFeesUSD;

    await this.releaseResource(transferEntry.chainId);

    return mintEntity;
  }

  private async sequenceAllEvents() {
    const chains = Object.fromEntries(this.WATCHED_ADDRESSES_CHAINS);
    for (const pool of this.WATCHED_ADDRESSES.values()) {
      await this.sequenceEvents(pool, chains[pool]);
    }
  }

  private async loadTokenPrice(token: Token): Promise<Token> {
    token.derivedUSD = await this.oracle.getPriceInUSD(
      token.address,
      token.chainId,
    );
    token.derivedETH = await this.oracle.getPriceInETH(
      token.address,
      token.chainId,
    );

    // Update token
    token = await this.tokenRepository.save(token);
    return token;
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
