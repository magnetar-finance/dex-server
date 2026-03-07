import { Module } from '@nestjs/common';
import { GeneralAnalyticsController } from './general-analytics.controller';
import { GeneralAnalyticsService } from './general-analytics.service';

@Module({
  controllers: [GeneralAnalyticsController],
  providers: [GeneralAnalyticsService],
})
export class GeneralAnalyticsModule {}
