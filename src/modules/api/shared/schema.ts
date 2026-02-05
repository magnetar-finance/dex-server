import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { ChainIds } from '../../../common/variables';

export class SharedQuerySchema {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseInt(String(value)))
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Transform(({ value }) => parseInt(String(value)))
  limit?: number = 20;

  @IsOptional()
  @IsEnum(ChainIds)
  chainId?: ChainIds = ChainIds.DUSK_TESTNET;
}
