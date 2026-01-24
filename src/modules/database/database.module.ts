import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Burn } from './entities/burn.entity';
import { Gauge } from './entities/gauge.entity';
import { IndexerEventStatus } from './entities/indexer-event-status.entity';
import { Mint } from './entities/mint.entity';
import { PoolDayData } from './entities/pool-day-data.entity';
import { PoolHourData } from './entities/pool-hour-data.entity';
import { Pool } from './entities/pool.entity';
import { Swap } from './entities/swap.entity';
import { Token } from './entities/token.entity';
import { Transaction } from './entities/transaction.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Burn,
      Gauge,
      IndexerEventStatus,
      Mint,
      PoolDayData,
      PoolHourData,
      Pool,
      Swap,
      Token,
      Transaction,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
