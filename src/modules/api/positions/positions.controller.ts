import { Controller, Get, HttpCode, HttpStatus, Param, Query } from '@nestjs/common';
import { SharedQuerySchema } from '../shared/schema';
import { PositionsService } from './positions.service';
import { ApiQuery, ApiTags, OmitType } from '@nestjs/swagger';

@ApiTags('Positions')
@Controller('positions')
export class PositionsController {
  constructor(private readonly positionsService: PositionsService) {}

  @Get(':userAccount')
  @HttpCode(HttpStatus.OK)
  getLiquidityPositions(@Param('userAccount') account: string, @Query() query: SharedQuerySchema) {
    return this.positionsService.getLiquidityPositions(
      account,
      query.chainId,
      query.page,
      query.limit,
    );
  }

  @Get(':userAccount/stats')
  @HttpCode(HttpStatus.OK)
  @ApiQuery({ type: OmitType(SharedQuerySchema, ['page', 'limit'] as const) })
  getPositionStats(
    @Param('userAccount') account: string,
    @Query() query: Omit<SharedQuerySchema, 'page' | 'limit'>,
  ) {
    return this.positionsService.getPositionStats(account, query.chainId);
  }
}
