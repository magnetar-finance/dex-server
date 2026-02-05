import { Global, Module } from '@nestjs/common';
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
import { Statistics } from './entities/statistics.entity';
import { GaugePosition } from './entities/gauge-position.entity';
import { TokenDayData } from './entities/token-day-data.entity';
import { LockPosition } from './entities/lock-position.entity';
import { LiquidityPosition } from './entities/lp-position.entity';
import { OverallDayData } from './entities/overall-day-data.entity';
import { User } from './entities/user.entity';

@Global()
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
      Statistics,
      GaugePosition,
      TokenDayData,
      LockPosition,
      LiquidityPosition,
      OverallDayData,
      User,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
