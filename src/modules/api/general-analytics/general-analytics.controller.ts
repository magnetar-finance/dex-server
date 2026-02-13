import { Controller, Get, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { SharedQuerySchema } from '../shared/schema';
import { GeneralAnalyticsService } from './general-analytics.service';
import { ApiQuery, ApiTags, OmitType } from '@nestjs/swagger';

@ApiTags('Analytics')
@Controller('analytics')
export class GeneralAnalyticsController {
  constructor(private readonly generalAnalyticsService: GeneralAnalyticsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiQuery({ type: OmitType(SharedQuerySchema, ['page', 'limit'] as const) })
  getStatistics(@Query() query: Omit<SharedQuerySchema, 'page' | 'limit'>) {
    return this.generalAnalyticsService.getStatistics(query.chainId);
  }

  @Get('top-pools')
  @HttpCode(HttpStatus.OK)
  @ApiQuery({ type: OmitType(SharedQuerySchema, ['page'] as const) })
  getTopPools(@Query() query: Omit<SharedQuerySchema, 'page'>) {
    return this.generalAnalyticsService.getTopPools(query.chainId, query.limit);
  }

  @Get('top-tokens')
  @HttpCode(HttpStatus.OK)
  @ApiQuery({ type: OmitType(SharedQuerySchema, ['page'] as const) })
  getTopTokens(@Query() query: Omit<SharedQuerySchema, 'page'>) {
    return this.generalAnalyticsService.getTopTokens(query.chainId, query.limit);
  }

  @Get('transactions/all')
  @HttpCode(HttpStatus.OK)
  getAllTransactions(@Query() query: SharedQuerySchema) {
    return this.generalAnalyticsService.getAllTransactions(query.chainId, query.limit);
  }
}
