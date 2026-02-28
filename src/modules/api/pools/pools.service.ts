import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Pool, PoolType } from '../../database/entities/pool.entity';
import { Transaction } from '../../database/entities/transaction.entity';
import { Swap } from '../../database/entities/swap.entity';
import { Mint } from '../../database/entities/mint.entity';
import { Burn } from '../../database/entities/burn.entity';
import { PoolHourData } from '../../database/entities/pool-hour-data.entity';
import { PoolDayData } from '../../database/entities/pool-day-data.entity';
import { And, Equal, ILike, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';

@Injectable()
export class PoolsService {
  constructor(
    @InjectRepository(Pool) private readonly poolRepository: Repository<Pool>,
    @InjectRepository(Transaction) private readonly transactionRepository: Repository<Transaction>,
    @InjectRepository(Swap) private readonly swapRepository: Repository<Swap>,
    @InjectRepository(Mint) private readonly mintRepository: Repository<Mint>,
    @InjectRepository(Burn) private readonly burnRepository: Repository<Burn>,
    @InjectRepository(PoolHourData)
    private readonly poolHourDataRepository: Repository<PoolHourData>,
    @InjectRepository(PoolDayData) private readonly poolDayDataRepository: Repository<PoolDayData>,
  ) {}

  getManyPools(poolType?: PoolType, chainId?: number, page: number = 1, limit: number = 20) {
    page = page - 1;
    const offset = page * limit;
    return this.poolRepository.find({
      where: { poolType, chainId },
      take: limit,
      skip: offset,
      relations: { token0: true, token1: true, gauge: true },
      order: { createdAtTimestamp: 'DESC' },
    });
  }

  async getSinglePool(poolIdOrAddress: string) {
    const isAddress = poolIdOrAddress.length === 42;
    const whereCondition = isAddress
      ? [{ id: ILike(`%${poolIdOrAddress}%`) }, { address: Equal(poolIdOrAddress.toLowerCase()) }]
      : [{ id: ILike(`%${poolIdOrAddress}%`) }, { address: ILike(`%${poolIdOrAddress}%`) }];

    const pool = await this.poolRepository.findOneBy(whereCondition);

    if (pool === null) throw new NotFoundException('Pool was not found');
    return pool;
  }

  async getPoolTransactions(poolIdOrAddress: string, page: number = 1, limit: number = 20) {
    page = page - 1;
    const offset = page * limit;

    const isAddress = poolIdOrAddress.length === 42;
    const poolCondition = isAddress
      ? [{ id: ILike(`%${poolIdOrAddress}%`) }, { address: Equal(poolIdOrAddress.toLowerCase()) }]
      : [{ id: ILike(`%${poolIdOrAddress}%`) }, { address: ILike(`%${poolIdOrAddress}%`) }];

    const transactions = await this.transactionRepository.find({
      where: [
        {
          swaps: {
            pool: poolCondition,
          },
        },
        {
          burns: {
            pool: poolCondition,
          },
        },
        {
          mints: {
            pool: poolCondition,
          },
        },
      ],
      take: limit,
      skip: offset,
      relations: {
        swaps: { pool: { token0: true, token1: true } },
        burns: { pool: { token0: true, token1: true } },
        mints: { pool: { token0: true, token1: true } },
      },
      order: { createdAt: 'DESC' },
    });

    return transactions;
  }

  async getPoolSwaps(poolIdOrAddress: string, page: number = 1, limit: number = 20) {
    page = page - 1;
    const offset = page * limit;

    const isAddress = poolIdOrAddress.length === 42;
    const poolCondition = isAddress
      ? [{ id: ILike(`%${poolIdOrAddress}%`) }, { address: Equal(poolIdOrAddress.toLowerCase()) }]
      : [{ id: ILike(`%${poolIdOrAddress}%`) }, { address: ILike(`%${poolIdOrAddress}%`) }];

    const swaps = await this.swapRepository.find({
      where: {
        pool: poolCondition,
      },
      take: limit,
      skip: offset,
      relations: { pool: { token0: true, token1: true } },
      order: { createdAt: 'DESC' },
    });
    return swaps;
  }

  async getPoolBurns(poolIdOrAddress: string, page: number = 1, limit: number = 20) {
    page = page - 1;
    const offset = page * limit;

    const isAddress = poolIdOrAddress.length === 42;
    const poolCondition = isAddress
      ? [{ id: ILike(`%${poolIdOrAddress}%`) }, { address: Equal(poolIdOrAddress.toLowerCase()) }]
      : [{ id: ILike(`%${poolIdOrAddress}%`) }, { address: ILike(`%${poolIdOrAddress}%`) }];

    const burns = await this.burnRepository.find({
      where: {
        pool: poolCondition,
      },
      take: limit,
      skip: offset,
      relations: { pool: { token0: true, token1: true } },
      order: { createdAt: 'DESC' },
    });

    return burns;
  }

  async getPoolMints(poolIdOrAddress: string, page: number = 1, limit: number = 20) {
    page = page - 1;
    const offset = page * limit;

    const isAddress = poolIdOrAddress.length === 42;
    const poolCondition = isAddress
      ? [{ id: ILike(`%${poolIdOrAddress}%`) }, { address: Equal(poolIdOrAddress.toLowerCase()) }]
      : [{ id: ILike(`%${poolIdOrAddress}%`) }, { address: ILike(`%${poolIdOrAddress}%`) }];

    const mints = await this.mintRepository.find({
      where: {
        pool: poolCondition,
      },
      take: limit,
      skip: offset,
      relations: { pool: { token0: true, token1: true } },
      order: { createdAt: 'DESC' },
    });

    return mints;
  }

  getPoolHourlyVolumeChange(poolIdOrAddress: string, startHour?: Date, endHour?: Date) {
    if (!endHour) endHour = new Date();
    if (!startHour) startHour = new Date(endHour.getTime() - 3600000); // 1 hour ago

    if (endHour < startHour) {
      const eh = endHour;
      const sh = startHour;

      startHour = eh;
      endHour = sh;
    }

    const startHourUnix = Math.floor(startHour.getTime() / 1000);
    const endHourUnix = Math.floor(endHour.getTime() / 1000);

    const isAddress = poolIdOrAddress.length === 42;
    const poolCondition = isAddress
      ? [{ id: ILike(`%${poolIdOrAddress}%`) }, { address: Equal(poolIdOrAddress.toLowerCase()) }]
      : [{ id: ILike(`%${poolIdOrAddress}%`) }, { address: ILike(`%${poolIdOrAddress}%`) }];

    return this.poolHourDataRepository.find({
      where: {
        pool: poolCondition,
        hourStartUnix: And(MoreThanOrEqual(startHourUnix), LessThanOrEqual(endHourUnix)),
      },
    });
  }

  getPoolDailyVolumeChange(poolIdOrAddress: string, startHour?: Date, endHour?: Date) {
    if (!endHour) endHour = new Date();
    if (!startHour) startHour = new Date(endHour.getTime() - 86400000); // 1 day ago

    if (endHour < startHour) {
      const eh = endHour;
      const sh = startHour;

      startHour = eh;
      endHour = sh;
    }

    const startHourUnix = Math.floor(startHour.getTime() / 1000);
    const endHourUnix = Math.floor(endHour.getTime() / 1000);

    const isAddress = poolIdOrAddress.length === 42;
    const poolCondition = isAddress
      ? [{ id: ILike(`%${poolIdOrAddress}%`) }, { address: Equal(poolIdOrAddress.toLowerCase()) }]
      : [{ id: ILike(`%${poolIdOrAddress}%`) }, { address: ILike(`%${poolIdOrAddress}%`) }];

    return this.poolDayDataRepository.find({
      where: {
        pool: poolCondition,
        date: And(MoreThanOrEqual(startHourUnix), LessThanOrEqual(endHourUnix)),
      },
    });
  }
}
