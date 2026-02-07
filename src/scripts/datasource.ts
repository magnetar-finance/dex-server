import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { DEFAULT_POSTGRES_URI } from '../common/variables';
import path from 'path';
import { Burn } from '../modules/database/entities/burn.entity';
import { GaugePosition } from '../modules/database/entities/gauge-position.entity';
import { Gauge } from '../modules/database/entities/gauge.entity';
import { IndexerEventStatus } from '../modules/database/entities/indexer-event-status.entity';
import { LockPosition } from '../modules/database/entities/lock-position.entity';
import { LiquidityPosition } from '../modules/database/entities/lp-position.entity';
import { Mint } from '../modules/database/entities/mint.entity';
import { OverallDayData } from '../modules/database/entities/overall-day-data.entity';
import { PoolDayData } from '../modules/database/entities/pool-day-data.entity';
import { PoolHourData } from '../modules/database/entities/pool-hour-data.entity';
import { Pool } from '../modules/database/entities/pool.entity';
import { Statistics } from '../modules/database/entities/statistics.entity';
import { Swap } from '../modules/database/entities/swap.entity';
import { TokenDayData } from '../modules/database/entities/token-day-data.entity';
import { Token } from '../modules/database/entities/token.entity';
import { User } from '../modules/database/entities/user.entity';
import { Transaction } from '../modules/database/entities/transaction.entity';
import { DataSource } from 'typeorm';
import 'dotenv/config';

const ds = new DataSource({
  url: process.env.POSTGRES_URI || DEFAULT_POSTGRES_URI,
  type: 'postgres',
  entities: [
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
  ],
  migrationsRun: false,
  migrations: [path.join(__dirname, './migrations/*.{ts,js}')],
  namingStrategy: new SnakeNamingStrategy(),
  ssl:
    process.env.CLOUD_PLATFORM === 'render'
      ? {
          rejectUnauthorized: false,
        }
      : false,
});

export default ds;
