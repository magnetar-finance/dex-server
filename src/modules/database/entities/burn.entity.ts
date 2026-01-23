import {
  Entity,
  PrimaryColumn,
  ManyToOne,
  JoinColumn,
  Column,
  Index,
  VersionColumn,
  CreateDateColumn,
  UpdateDateColumn,
  BeforeInsert,
} from 'typeorm';
import { Pool } from './pool.entity';
import { Transaction } from './transaction.entity';

@Entity('burn')
export class Burn {
  @PrimaryColumn('varchar')
  id: string;

  @ManyToOne(() => Transaction, (tx) => tx.burns)
  @JoinColumn({ name: 'transactionId' })
  transaction: Transaction;

  @Column('bigint')
  timestamp: string;

  @Index()
  @ManyToOne(() => Pool, (pool) => pool.burns)
  @JoinColumn({ name: 'poolId' })
  pool: Pool;

  @Column('decimal', { precision: 500, scale: 5 })
  liquidity: string;

  @Column({ nullable: true })
  sender?: string;

  @Column('decimal', { nullable: true })
  amount0?: string;

  @Column('decimal', { nullable: true })
  amount1?: string;

  @Column({ nullable: true })
  to?: string;

  @Column('bigint', { nullable: true })
  logIndex?: string;

  @Column('decimal', { nullable: true })
  amountUSD?: string;

  @Column()
  needsComplete: boolean;

  @Column({ nullable: true })
  feeTo?: string;

  @Column('decimal', { nullable: true })
  feeLiquidity?: string;

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
    this.id = `burn-${this.transaction.hash.toLowerCase()}-${this.chainId}`;
  }
}
