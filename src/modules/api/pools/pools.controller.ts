import { Controller, Get, HttpCode, HttpStatus, Param, Query } from '@nestjs/common';
import { PoolsQuerySchema, PoolsVolumeChangeQuerySchema } from './pools.schema';
import { PoolsService } from './pools.service';
import { SharedQuerySchema } from '../shared/schema';
import { ApiQuery, ApiTags, OmitType } from '@nestjs/swagger';

@ApiTags('Pools')
@Controller('pools')
export class PoolsController {
  constructor(private readonly poolsService: PoolsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  getManyPools(@Query() query: PoolsQuerySchema) {
    return this.poolsService.getManyPools(query.poolType, query.chainId, query.page, query.limit);
  }

  @Get(':poolIdOrAddress')
  @HttpCode(HttpStatus.OK)
  getSinglePool(@Param('poolIdOrAddress') poolIdOrAddress: string) {
    return this.poolsService.getSinglePool(poolIdOrAddress);
  }

  @Get(':poolIdOrAddress/transactions/all')
  @HttpCode(HttpStatus.OK)
  @ApiQuery({ type: OmitType(SharedQuerySchema, ['chainId'] as const) })
  getPoolTransactions(
    @Param('poolIdOrAddress') poolIdOrAddress: string,
    @Query() query: Omit<SharedQuerySchema, 'chainId'>,
  ) {
    return this.poolsService.getPoolTransactions(poolIdOrAddress, query.page, query.limit);
  }

  @Get(':poolIdOrAddress/transactions/swaps')
  @HttpCode(HttpStatus.OK)
  @ApiQuery({ type: OmitType(SharedQuerySchema, ['chainId'] as const) })
  getPoolSwaps(
    @Param('poolIdOrAddress') poolIdOrAddress: string,
    @Query() query: Omit<SharedQuerySchema, 'chainId'>,
  ) {
    return this.poolsService.getPoolSwaps(poolIdOrAddress, query.page, query.limit);
  }

  @Get(':poolIdOrAddress/transactions/burns')
  @HttpCode(HttpStatus.OK)
  @ApiQuery({ type: OmitType(SharedQuerySchema, ['chainId'] as const) })
  getPoolBurns(
    @Param('poolIdOrAddress') poolIdOrAddress: string,
    @Query() query: Omit<SharedQuerySchema, 'chainId'>,
  ) {
    return this.poolsService.getPoolBurns(poolIdOrAddress, query.page, query.limit);
  }

  @Get(':poolIdOrAddress/transactions/mints')
  @HttpCode(HttpStatus.OK)
  @ApiQuery({ type: OmitType(SharedQuerySchema, ['chainId'] as const) })
  getPoolMints(
    @Param('poolIdOrAddress') poolIdOrAddress: string,
    @Query() query: Omit<SharedQuerySchema, 'chainId'>,
  ) {
    return this.poolsService.getPoolMints(poolIdOrAddress, query.page, query.limit);
  }

  @Get(':poolIdOrAddress/analytics/hourly')
  @HttpCode(HttpStatus.OK)
  getHourlyVolumeChange(
    @Param('poolIdOrAddress') poolIdOrAddress: string,
    @Query() query: PoolsVolumeChangeQuerySchema,
  ) {
    return this.poolsService.getPoolHourlyVolumeChange(
      poolIdOrAddress,
      query.startHour,
      query.endHour,
    );
  }

  @Get(':poolIdOrAddress/analytics/daily')
  @HttpCode(HttpStatus.OK)
  getDailyVolumeChange(
    @Param('poolIdOrAddress') poolIdOrAddress: string,
    @Query() query: PoolsVolumeChangeQuerySchema,
  ) {
    return this.poolsService.getPoolDailyVolumeChange(
      poolIdOrAddress,
      query.startHour,
      query.endHour,
    );
  }
}
