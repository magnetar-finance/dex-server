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
  @ManyToOne(() => Pool, (pool) => pool.burns)
  @JoinColumn()
  pool: Pool;

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

  @Column({ nullable: true })
  to?: string;

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

  @Column()
  needsComplete: boolean;

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
    this.id = `burn-${this.transaction.hash.toLowerCase()}-${this.chainId}`;
  }
}
