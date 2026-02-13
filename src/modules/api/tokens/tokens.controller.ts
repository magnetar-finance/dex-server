import { Controller, Get, HttpCode, HttpStatus, Param, Query } from '@nestjs/common';
import { ApiQuery, ApiTags, OmitType } from '@nestjs/swagger';
import { TokensService } from './tokens.service';
import { SharedQuerySchema } from '../shared/schema';

@ApiTags('Tokens')
@Controller('tokens')
export class TokensController {
  constructor(private readonly tokensService: TokensService) {}

  @Get(':tokenIdOrAddress')
  @HttpCode(HttpStatus.OK)
  getSingleToken(@Param('tokenIdOrAddress') tokenIdOrAddress: string) {
    return this.tokensService.getSingleToken(tokenIdOrAddress);
  }

  @Get(':tokenIdOrAddress/transactions')
  @HttpCode(HttpStatus.OK)
  @ApiQuery({ type: OmitType(SharedQuerySchema, ['chainId'] as const) })
  getTokenTransactions(
    @Param('tokenIdOrAddress') tokenIdOrAddress: string,
    @Query() query: Omit<SharedQuerySchema, 'chainId'>,
  ) {
    return this.tokensService.getTokenTransactions(tokenIdOrAddress, query.page, query.limit);
  }

  @Get(':tokenIdOrAddress/top-pools')
  @HttpCode(HttpStatus.OK)
  @ApiQuery({ type: OmitType(SharedQuerySchema, ['chainId', 'page'] as const) })
  getTokenTopPools(
    @Param('tokenIdOrAddress') tokenIdOrAddress: string,
    @Query() query: Omit<SharedQuerySchema, 'chainId' | 'page'>,
  ) {
    return this.tokensService.getTokenTopPools(tokenIdOrAddress, query.limit);
  }
}
