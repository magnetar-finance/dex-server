import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Pool } from '../../database/entities/pool.entity';
import { Transaction } from '../../database/entities/transaction.entity';
import { Token } from '../../database/entities/token.entity';
import { TokenDayData } from '../../database/entities/token-day-data.entity';
import { And, ILike, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';

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
    const token = await this.tokenRepository.findOneBy([
      { id: ILike(`%${tokenIdOrAddress}%`) },
      { address: ILike(`%${tokenIdOrAddress}%`) },
    ]);

    if (token === null) throw new NotFoundException('Token was not found');
    return token;
  }

  async getTokenTransactions(tokenIdOrAddress: string, page: number = 1, limit: number = 20) {
    page = page - 1;
    const offset = page * limit;

    const transactions = await this.transactionRepository.find({
      where: [
        {
          swaps: {
            pool: [
              {
                token0: [
                  { id: ILike(`%${tokenIdOrAddress}%`) },
                  { address: ILike(`%${tokenIdOrAddress}%`) },
                ],
              },
              {
                token1: [
                  { id: ILike(`%${tokenIdOrAddress}%`) },
                  { address: ILike(`%${tokenIdOrAddress}%`) },
                ],
              },
            ],
          },
        },
        {
          burns: {
            pool: [
              {
                token0: [
                  { id: ILike(`%${tokenIdOrAddress}%`) },
                  { address: ILike(`%${tokenIdOrAddress}%`) },
                ],
              },
              {
                token1: [
                  { id: ILike(`%${tokenIdOrAddress}%`) },
                  { address: ILike(`%${tokenIdOrAddress}%`) },
                ],
              },
            ],
          },
        },
        {
          mints: {
            pool: [
              {
                token0: [
                  { id: ILike(`%${tokenIdOrAddress}%`) },
                  { address: ILike(`%${tokenIdOrAddress}%`) },
                ],
              },
              {
                token1: [
                  { id: ILike(`%${tokenIdOrAddress}%`) },
                  { address: ILike(`%${tokenIdOrAddress}%`) },
                ],
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
    return this.poolRepository.find({
      take: limit,
      order: { reserveUSD: 'DESC' },
      where: [
        {
          token0: [
            { id: ILike(`%${tokenIdOrAddress}%`) },
            { address: ILike(`%${tokenIdOrAddress}%`) },
          ],
        },
        {
          token1: [
            { id: ILike(`%${tokenIdOrAddress}%`) },
            { address: ILike(`%${tokenIdOrAddress}%`) },
          ],
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

    return this.tokenDayDataRepository.find({
      where: {
        token: [
          { id: ILike(`%${tokenIdOrAddress}%`) },
          { address: ILike(`%${tokenIdOrAddress}%`) },
        ],
        date: And(MoreThanOrEqual(startHourUnix), LessThanOrEqual(endHourUnix)),
      },
    });
  }
}
