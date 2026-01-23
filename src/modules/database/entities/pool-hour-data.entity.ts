import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import { Pool } from './pool.entity';

@Entity('pool_hour_data')
export class PoolHourData {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column('int')
  hourStartUnix: number;

  @Index()
  @ManyToOne(() => Pool, (pool) => pool.poolHourData)
  @JoinColumn()
  pool: Pool;

  @Column('decimal', { precision: 500, scale: 5 })
  reserve0: string;

  @Column('decimal', { precision: 500, scale: 5 })
  reserve1: string;

  @Column('decimal', { precision: 500, scale: 5 })
  totalSupply: string;

  @Column('decimal', { precision: 500, scale: 5 })
  reserveUSD: string;

  @Column('decimal', { precision: 500, scale: 5 })
  reserveETH: string;

  @Column('decimal', { precision: 500, scale: 5 })
  hourlyVolumeToken0: string;

  @Column('decimal', { precision: 500, scale: 5 })
  hourlyVolumeToken1: string;

  @Column('decimal', { precision: 500, scale: 5 })
  hourlyVolumeUSD: string;

  @Column('decimal', { precision: 500, scale: 5 })
  hourlyVolumeETH: string;

  @Column('bigint')
  hourlyTxns: string;

  @VersionColumn()
  version: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
