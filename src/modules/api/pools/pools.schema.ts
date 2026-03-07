/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { IsDate, IsEnum, IsOptional } from 'class-validator';
import { SharedQuerySchema } from '../shared/schema';
import { PoolType } from '../../../modules/database/entities/pool.entity';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class PoolsQuerySchema extends SharedQuerySchema {
  @ApiPropertyOptional({
    description: 'Filter list by pool type',
    enum: PoolType,
    example: PoolType.CONCENTRATED,
  })
  @IsOptional()
  @IsEnum(PoolType)
  poolType?: PoolType;
}

export class PoolsVolumeChangeQuerySchema {
  @ApiPropertyOptional({ description: 'Start time' })
  @IsOptional()
  @IsDate()
  @Transform((transformerParams) => new Date(transformerParams.value))
  startHour?: Date;

  @ApiPropertyOptional({ description: 'End time' })
  @IsOptional()
  @IsDate()
  @Transform((transformerParams) => new Date(transformerParams.value))
  endHour?: Date;
}
