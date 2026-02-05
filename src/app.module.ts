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
import { APP_PIPE } from '@nestjs/core';
import { ValidationPipe } from './pipes/validation.pipe';
import { PoolsModule } from './modules/api/pools/pools.module';

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
  ],
  controllers: [AppController],
  providers: [AppService, IndexerService, { provide: APP_PIPE, useClass: ValidationPipe }],
})
export class AppModule {}
