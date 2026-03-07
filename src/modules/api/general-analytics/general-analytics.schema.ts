/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { IsOptional, IsDate } from 'class-validator';
import { Transform } from 'class-transformer';
import { SharedQuerySchema } from '../shared/schema';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AllOverallDayDataQuerySchema extends SharedQuerySchema {
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
