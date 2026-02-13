/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsDate } from 'class-validator';
import { Transform } from 'class-transformer';

export class TokensVolumeChangeQuerySchema {
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
