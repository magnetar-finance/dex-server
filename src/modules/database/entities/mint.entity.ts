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
import { Pool } from './pool.entity';
import { Transaction } from './transaction.entity';

@Entity('mints')
export class Mint {
  @PrimaryColumn('varchar')
  id: string;

  @ManyToOne(() => Transaction, (tx) => tx.mints)
  @JoinColumn()
  transaction: Transaction;

  @Column('bigint', { nullable: false })
  timestamp: string;

  @Index()
  @ManyToOne(() => Pool, (pool) => pool.mints)
  @JoinColumn()
  pool: Pool;

  @Column('varchar', { nullable: false })
  to: string;

  @Column('decimal', { precision: 500, scale: 5 })
  liquidity: string;

  @Column({ nullable: true })
  sender?: string;

  @Column('decimal', { nullable: true })
  amount0?: string;

  @Column('decimal', { nullable: true })
  amount1?: string;

  @Column('bigint', { nullable: true })
  logIndex?: string;

  @Column('decimal', { nullable: true })
  amountUSD?: string;

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
    this.id = `mint-${this.transaction.hash.toLowerCase()}-${this.chainId}`;
  }
}
