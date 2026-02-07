import { Controller, Get, HttpCode, HttpStatus, Param, Query } from '@nestjs/common';
import { SharedQuerySchema } from '../shared/schema';
import { PositionsService } from './positions.service';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Positions')
@Controller('positions')
export class PositionsController {
  constructor(private readonly positionsService: PositionsService) {}

  @Get('positions/:userAccount')
  @HttpCode(HttpStatus.OK)
  getLiquidityPositions(@Param('userAccount') account: string, @Query() query: SharedQuerySchema) {
    return this.positionsService.getLiquidityPositions(
      account,
      query.chainId,
      query.page,
      query.limit,
    );
  }
}
