import { Injectable } from '@nestjs/common';
import { Transaction } from '../../database/entities/transaction.entity';
import { Pool } from '../../database/entities/pool.entity';
import { Token } from '../../database/entities/token.entity';
import { OverallDayData } from '../../database/entities/overall-day-data.entity';
import { Statistics } from '../../database/entities/statistics.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { And, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';

@Injectable()
export class GeneralAnalyticsService {
  constructor(
    @InjectRepository(Pool) private readonly poolRepository: Repository<Pool>,
    @InjectRepository(Transaction) private readonly transactionRepository: Repository<Transaction>,
    @InjectRepository(Token) private readonly tokenRepository: Repository<Token>,
    @InjectRepository(OverallDayData)
    private readonly overallDayDataRepository: Repository<OverallDayData>,
    @InjectRepository(Statistics)
    private readonly statisticsRepository: Repository<Statistics>,
  ) {}

  getTopPools(chainId?: number, limit: number = 20) {
    return this.poolRepository.find({
      take: limit,
      order: { volumeUSD: 'DESC' },
      where: { chainId },
    });
  }

  getTopTokens(chainId?: number, limit: number = 20) {
    return this.tokenRepository.find({
      take: limit,
      order: { derivedUSD: 'DESC' },
      where: { chainId },
    });
  }

  getAllTransactions(chainId?: number, page: number = 1, limit: number = 20) {
    page = page - 1;
    const offset = page * limit;
    return this.transactionRepository.find({
      take: limit,
      skip: offset,
      order: { timestamp: 'DESC' },
      where: { chainId },
      relations: {
        mints: { pool: { token0: true, token1: true } },
        burns: { pool: { token0: true, token1: true } },
        swaps: { pool: { token0: true, token1: true } },
      },
    });
  }

  getOverallDayData(chainId?: number, startHour?: Date, endHour?: Date) {
    if (!startHour && !endHour)
      return this.overallDayDataRepository.find({
        where: { chainId },
      });
    else if (startHour && !endHour) endHour = new Date(startHour.getTime() + 86400000);
    else if (endHour && !startHour) startHour = new Date(endHour.getTime() - 86400000);

    if (endHour && startHour && endHour < startHour) {
      const eh = endHour;
      const sh = startHour;

      startHour = eh;
      endHour = sh;
    }

    const startHourUnix = Math.floor(startHour!.getTime() / 1000);
    const endHourUnix = Math.floor(endHour!.getTime() / 1000);

    return this.overallDayDataRepository.find({
      where: {
        chainId,
        date: And(MoreThanOrEqual(startHourUnix), LessThanOrEqual(endHourUnix)),
      },
    });
  }

  getStatistics(chainId?: number) {
    return this.statisticsRepository.findOneBy({
      id: `$1-${chainId}`,
    });
  }
}
