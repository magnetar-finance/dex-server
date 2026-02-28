import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LiquidityPosition } from '../../../modules/database/entities/lp-position.entity';
import { Equal, ILike, Repository } from 'typeorm';
import { CacheService } from '../../../modules/cache/cache.service';

@Injectable()
export class PositionsService {
  constructor(
    @InjectRepository(LiquidityPosition)
    private readonly liquidityPositionRepository: Repository<LiquidityPosition>,
    private readonly cacheService: CacheService,
  ) {}

  getLiquidityPositions(account: string, chainId?: number, page: number = 1, limit: number = 20) {
    page = page - 1;
    const offset = page * limit;

    const isAddress = account.length === 42;
    const accountCondition = isAddress
      ? [{ id: ILike(`%${account}%`) }, { address: Equal(account.toLowerCase()) }]
      : [{ id: ILike(`%${account}%`) }, { address: ILike(`%${account}%`) }];

    return this.liquidityPositionRepository.find({
      where: {
        account: accountCondition,
        chainId,
      },
      skip: offset,
      take: limit,
      order: { creationBlock: 'DESC' },
    });
  }

  async getPositionStats(account: string, chainId?: number) {
    const isAddress = account.length === 42;
    const accountCondition = isAddress
      ? [{ id: ILike(`%${account}%`) }, { address: Equal(account.toLowerCase()) }]
      : [{ id: ILike(`%${account}%`) }, { address: ILike(`%${account}%`) }];

    const [positions, positionsCount] = await this.liquidityPositionRepository.findAndCount({
      where: {
        chainId,
        account: accountCondition,
      },
      relations: { pool: true },
    });

    const portfolioValue = positions.reduce((total, position) => {
      const { totalSupply, reserveUSD } = position.pool;
      const positionValue = totalSupply > 0 ? (position.position / totalSupply) * reserveUSD : 0;
      return total + positionValue;
    }, 0);

    let portfolioHourlyChange = 0;
    let portfolioChangeType: 'increase' | 'decrease' | 'stable' = 'stable';
    const cacheKey = `portfolio-value:${account}:${chainId}`;

    // Get cached value if available
    const cachedPortfolioValue = await this.cacheService.obtain<number>(cacheKey);

    if (cachedPortfolioValue !== null) {
      portfolioHourlyChange =
        ((portfolioValue - cachedPortfolioValue) /
          (cachedPortfolioValue > 0 ? cachedPortfolioValue : 1)) *
        100;
      portfolioChangeType =
        portfolioHourlyChange > 0 ? 'increase' : portfolioHourlyChange < 0 ? 'decrease' : 'stable';
      portfolioHourlyChange = Math.abs(portfolioHourlyChange);
    }

    await this.cacheService.cache(cacheKey, portfolioValue, 3600, true); // Cache for 1 hour

    return {
      totalPositions: positionsCount,
      portfolioValue,
      portfolioHourlyChange,
      portfolioChangeType,
    };
  }
}
