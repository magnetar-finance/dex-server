/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { IsDate, IsEnum, IsOptional } from 'class-validator';
import { SharedQuerySchema } from '../shared/schema';
import { PoolType } from '../../../modules/database/entities/pool.entity';
import { Transform } from 'class-transformer';

export class PoolsQuerySchema extends SharedQuerySchema {
  @IsOptional()
  @IsEnum(PoolType)
  poolType?: PoolType;
}

export class PoolsVolumeChangeQuerySchema {
  @IsOptional()
  @IsDate()
  @Transform((transformerParams) => new Date(transformerParams.value))
  startHour?: Date;

  @IsOptional()
  @IsDate()
  @Transform((transformerParams) => new Date(transformerParams.value))
  endHour?: Date;
}
