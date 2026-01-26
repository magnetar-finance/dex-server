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

  @Column('bigint', {
    nullable: false,
    transformer: {
      to: (value: number) => value?.toString(),
      from: (value: string) => (value ? Number(value) : value),
    },
  })
  timestamp: number;

  @Index()
  @ManyToOne(() => Pool, (pool) => pool.mints)
  @JoinColumn()
  pool: Pool;

  @Column('varchar', { nullable: false })
  to: string;

  @Column('decimal', {
    precision: 500,
    scale: 5,
    transformer: {
      to: (value: number) => value?.toString(),
      from: (value: string) => (value ? Number(value) : value),
    },
  })
  liquidity: number;

  @Column({ nullable: true })
  sender?: string;

  @Column('decimal', {
    nullable: true,
    transformer: {
      to: (value: number) => value?.toString(),
      from: (value: string) => (value ? Number(value) : value),
    },
  })
  amount0?: number;

  @Column('decimal', {
    nullable: true,
    transformer: {
      to: (value: number) => value?.toString(),
      from: (value: string) => (value ? Number(value) : value),
    },
  })
  amount1?: number;

  @Column('bigint', {
    nullable: true,
    transformer: {
      to: (value: number) => value?.toString(),
      from: (value: string) => (value ? Number(value) : value),
    },
  })
  logIndex?: number;

  @Column('decimal', {
    nullable: true,
    transformer: {
      to: (value: number) => value?.toString(),
      from: (value: string) => (value ? Number(value) : value),
    },
  })
  amountUSD?: number;

  @Column({ nullable: true })
  feeTo?: string;

  @Column('decimal', {
    nullable: true,
    transformer: {
      to: (value: number) => value?.toString(),
      from: (value: string) => (value ? Number(value) : value),
    },
  })
  feeLiquidity?: number;

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
