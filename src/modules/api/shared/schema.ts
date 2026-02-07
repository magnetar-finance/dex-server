import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { ChainIds } from '../../../common/variables';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SharedQuerySchema {
  @ApiPropertyOptional({ description: "Page number - Must be at least '1'" })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseInt(String(value)))
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Number of items to fetch - Default value is 20 ' })
  @IsOptional()
  @IsInt()
  @Transform(({ value }) => parseInt(String(value)))
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Optional chain ID',
    enum: ChainIds,
    example: ChainIds.DUSK_TESTNET,
  })
  @IsOptional()
  @IsEnum(ChainIds)
  @Transform(({ value }) => ChainIds[value as keyof typeof ChainIds])
  chainId?: ChainIds = ChainIds.DUSK_TESTNET;
}
