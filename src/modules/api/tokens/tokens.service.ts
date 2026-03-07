import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Pool } from '../../database/entities/pool.entity';
import { Transaction } from '../../database/entities/transaction.entity';
import { Token } from '../../database/entities/token.entity';
import { TokenDayData } from '../../database/entities/token-day-data.entity';
import { And, Equal, ILike, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';

@Injectable()
export class TokensService {
  constructor(
    @InjectRepository(Pool) private readonly poolRepository: Repository<Pool>,
    @InjectRepository(Transaction) private readonly transactionRepository: Repository<Transaction>,
    @InjectRepository(Token) private readonly tokenRepository: Repository<Token>,
    @InjectRepository(TokenDayData)
    private readonly tokenDayDataRepository: Repository<TokenDayData>,
  ) {}

  async getSingleToken(tokenIdOrAddress: string) {
    const isAddress = tokenIdOrAddress.length === 42;
    const whereCondition = isAddress
      ? [{ id: ILike(`%${tokenIdOrAddress}%`) }, { address: Equal(tokenIdOrAddress.toLowerCase()) }]
      : [{ id: ILike(`%${tokenIdOrAddress}%`) }, { address: ILike(`%${tokenIdOrAddress}%`) }];

    const token = await this.tokenRepository.findOneBy(whereCondition);

    if (token === null) throw new NotFoundException('Token was not found');
    return token;
  }

  async getTokenTransactions(tokenIdOrAddress: string, page: number = 1, limit: number = 20) {
    page = page - 1;
    const offset = page * limit;

    const isAddress = tokenIdOrAddress.length === 42;
    const tokenCondition = isAddress
      ? [{ id: ILike(`%${tokenIdOrAddress}%`) }, { address: Equal(tokenIdOrAddress.toLowerCase()) }]
      : [{ id: ILike(`%${tokenIdOrAddress}%`) }, { address: ILike(`%${tokenIdOrAddress}%`) }];

    const transactions = await this.transactionRepository.find({
      where: [
        {
          swaps: {
            pool: [
              {
                token0: tokenCondition,
              },
              {
                token1: tokenCondition,
              },
            ],
          },
        },
        {
          burns: {
            pool: [
              {
                token0: tokenCondition,
              },
              {
                token1: tokenCondition,
              },
            ],
          },
        },
        {
          mints: {
            pool: [
              {
                token0: tokenCondition,
              },
              {
                token1: tokenCondition,
              },
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

  async getTokenTopPools(tokenIdOrAddress: string, limit: number = 20) {
    const isAddress = tokenIdOrAddress.length === 42;
    const tokenCondition = isAddress
      ? [{ id: ILike(`%${tokenIdOrAddress}%`) }, { address: Equal(tokenIdOrAddress.toLowerCase()) }]
      : [{ id: ILike(`%${tokenIdOrAddress}%`) }, { address: ILike(`%${tokenIdOrAddress}%`) }];

    return this.poolRepository.find({
      take: limit,
      order: { reserveUSD: 'DESC' },
      where: [
        {
          token0: tokenCondition,
        },
        {
          token1: tokenCondition,
        },
      ],
    });
  }

  getTokenDailyVolumeChange(tokenIdOrAddress: string, startHour?: Date, endHour?: Date) {
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

    const isAddress = tokenIdOrAddress.length === 42;
    const tokenCondition = isAddress
      ? [{ id: ILike(`%${tokenIdOrAddress}%`) }, { address: Equal(tokenIdOrAddress.toLowerCase()) }]
      : [{ id: ILike(`%${tokenIdOrAddress}%`) }, { address: ILike(`%${tokenIdOrAddress}%`) }];

    return this.tokenDayDataRepository.find({
      where: {
        token: tokenCondition,
        date: And(MoreThanOrEqual(startHourUnix), LessThanOrEqual(endHourUnix)),
      },
    });
  }
}
