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

@Entity('pool_day_data')
export class PoolDayData {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column('int')
  date: number;

  @Index()
  @ManyToOne(() => Pool)
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
  dailyVolumeToken0: string;

  @Column('decimal', { precision: 500, scale: 5 })
  dailyVolumeToken1: string;

  @Column('decimal', { precision: 500, scale: 5 })
  dailyVolumeUSD: string;

  @Column('decimal', { precision: 500, scale: 5 })
  dailyVolumeETH: string;

  @Column('bigint')
  dailyTxns: string;

  @VersionColumn()
  version: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
