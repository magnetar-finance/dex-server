import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CacheModule } from './modules/cache/cache.module';
import { getCachingConfigFactory, loadRedisConfig } from './config/cache.config';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getPostgresConfigFactory, loadPostgresConfig } from './config/database.config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from './modules/database/database.module';
import { BlockchainModule } from './modules/blockchain/blockchain.module';
import loadChainInfo from './config/blockchain.config';
import { IndexerService } from './modules/indexer/indexer.service';
import { EventEmitterModule } from '@nestjs/event-emitter';
import appConfig from './config/app.config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ValidationPipe } from './pipes/validation.pipe';
import { PoolsModule } from './modules/api/pools/pools.module';
import { PositionsModule } from './modules/api/positions/positions.module';
import { GeneralAnalyticsModule } from './modules/api/general-analytics/general-analytics.module';
import { TransformService } from './interceptors/transform.interceptor';
import { ExceptionHandler } from './filters/exception.filter';
import { LoggingService } from './interceptors/logging.interceptor';
import { TokensModule } from './modules/api/tokens/tokens.module';

@Module({
  imports: [
    EventEmitterModule.forRoot({
      newListener: true,
      global: true,
    }),
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      load: [loadRedisConfig, loadPostgresConfig, appConfig],
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      useFactory: getPostgresConfigFactory,
      inject: [ConfigService],
    }),
    CacheModule.registerAsync({
      useFactory: getCachingConfigFactory,
      inject: [ConfigService],
    }),
    BlockchainModule.forRoot(loadChainInfo()),
    DatabaseModule,
    PoolsModule,
    PositionsModule,
    GeneralAnalyticsModule,
    TokensModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    IndexerService,
    { provide: APP_PIPE, useClass: ValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: TransformService },
    { provide: APP_INTERCEPTOR, useClass: LoggingService },
    { provide: APP_FILTER, useClass: ExceptionHandler },
  ],
})
export class AppModule {}
