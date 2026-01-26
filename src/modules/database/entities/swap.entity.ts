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

  @Column('bigint', {
    transformer: {
      to: (value: number) => value?.toString(),
      from: (value: string) => (value ? Number(value) : value),
    },
  })
  timestamp: number;

  @Index()
  @ManyToOne(() => Pool, (pool) => pool.swaps)
  @JoinColumn()
  pool: Pool;

  @Column()
  sender: string;

  @Column()
  from: string;

  @Column('decimal', {
    precision: 500,
    scale: 5,
    transformer: {
      to: (value: number) => value?.toString(),
      from: (value: string) => (value ? Number(value) : value),
    },
  })
  amount0In: number;

  @Column('decimal', {
    precision: 500,
    scale: 5,
    transformer: {
      to: (value: number) => value?.toString(),
      from: (value: string) => (value ? Number(value) : value),
    },
  })
  amount1In: number;

  @Column('decimal', {
    precision: 500,
    scale: 5,
    transformer: {
      to: (value: number) => value?.toString(),
      from: (value: string) => (value ? Number(value) : value),
    },
  })
  amount0Out: number;

  @Column('decimal', {
    precision: 500,
    scale: 5,
    transformer: {
      to: (value: number) => value?.toString(),
      from: (value: string) => (value ? Number(value) : value),
    },
  })
  amount1Out: number;

  @Column()
  to: string;

  @Column('bigint', {
    nullable: true,
    transformer: {
      to: (value: number) => value?.toString(),
      from: (value: string) => (value ? Number(value) : value),
    },
  })
  logIndex?: number;

  @Column('decimal', {
    precision: 500,
    scale: 5,
    transformer: {
      to: (value: number) => value?.toString(),
      from: (value: string) => (value ? Number(value) : value),
    },
  })
  amountUSD: number;

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
