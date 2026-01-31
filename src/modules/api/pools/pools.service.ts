import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Pool, PoolType } from '../../database/entities/pool.entity';
import { Transaction } from '../../database/entities/transaction.entity';
import { Swap } from '../../database/entities/swap.entity';
import { Mint } from '../../database/entities/mint.entity';
import { Burn } from '../../database/entities/burn.entity';
import { ILike, Repository } from 'typeorm';

@Injectable()
export class PoolsService {
  constructor(
    @InjectRepository(Pool) private readonly poolRepository: Repository<Pool>,
    @InjectRepository(Transaction) private readonly transactionRepository: Repository<Transaction>,
    @InjectRepository(Swap) private readonly swapRepository: Repository<Swap>,
    @InjectRepository(Mint) private readonly mintRepository: Repository<Mint>,
    @InjectRepository(Burn) private readonly burnRepository: Repository<Burn>,
  ) {}

  getManyPools(poolType?: PoolType, chainId?: number, page: number = 1, limit: number = 20) {
    page = page - 1;
    const offset = page * limit;
    return this.poolRepository.find({
      where: { poolType, chainId },
      take: limit,
      skip: offset,
      relations: { token0: true, token1: true },
      order: { createdAtTimestamp: 'DESC' },
    });
  }

  async getSinglePool(poolIdOrAddress: string) {
    const pool = await this.poolRepository.findOneBy([
      { id: ILike(`%${poolIdOrAddress}%`) },
      { address: ILike(`%${poolIdOrAddress}%`) },
    ]);

    if (pool === null) throw new NotFoundException('Pool was not found');
    return pool;
  }

  async getPoolTransactions(poolIdOrAddress: string, page: number = 1, limit: number = 20) {
    page = page - 1;
    const offset = page * limit;

    const transactions = await this.transactionRepository.find({
      where: [
        {
          swaps: {
            pool: [
              { id: ILike(`%${poolIdOrAddress}%`) },
              { address: ILike(`%${poolIdOrAddress}%`) },
            ],
          },
        },
        {
          burns: {
            pool: [
              { id: ILike(`%${poolIdOrAddress}%`) },
              { address: ILike(`%${poolIdOrAddress}%`) },
            ],
          },
        },
        {
          mints: {
            pool: [
              { id: ILike(`%${poolIdOrAddress}%`) },
              { address: ILike(`%${poolIdOrAddress}%`) },
            ],
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

    const swaps = await this.swapRepository.find({
      where: {
        pool: [{ id: ILike(`%${poolIdOrAddress}%`) }, { address: ILike(`%${poolIdOrAddress}%`) }],
      },
      take: limit,
      skip: offset,
      relations: { pool: { token0: true, token1: true } },
      order: { createdAt: 'DESC' },
    });
    return swaps;
  }
}
