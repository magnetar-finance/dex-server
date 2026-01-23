import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import { Transaction } from './transaction.entity';
import { Pool } from './pool.entity';

@Entity('swap')
export class Swap {
  @PrimaryColumn('varchar')
  id: string;

  @ManyToOne(() => Transaction, (tx) => tx.swaps)
  @JoinColumn()
  transaction: Transaction;

  @Column('bigint')
  timestamp: string;

  @Index()
  @ManyToOne(() => Pool, (pool) => pool.swaps)
  @JoinColumn()
  pool: Pool;

  @Column()
  sender: string;

  @Column()
  from: string;

  @Column('decimal', { precision: 500, scale: 5 })
  amount0In: string;

  @Column('decimal', { precision: 500, scale: 5 })
  amount1In: string;

  @Column('decimal', { precision: 500, scale: 5 })
  amount0Out: string;

  @Column('decimal', { precision: 500, scale: 5 })
  amount1Out: string;

  @Column()
  to: string;

  @Column('bigint', { nullable: true })
  logIndex?: string;

  @Column('decimal', { precision: 500, scale: 5 })
  amountUSD: string;

  @Column('integer', { nullable: false, comment: 'Chain ID' })
  chainId: number;

  @VersionColumn()
  version: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  preSave() {
    this.id = `swap-${this.transaction.hash.toLowerCase()}-${this.chainId}`;
  }
}
