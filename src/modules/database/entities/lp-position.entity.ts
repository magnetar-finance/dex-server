import {
  BeforeInsert,
  BeforeUpdate,
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
import { User } from './user.entity';

@Entity('liquidity_position')
export class LiquidityPosition {
  @PrimaryColumn()
  id: string;

  @Index()
  @ManyToOne(() => Pool)
  @JoinColumn()
  pool: Pool;

  @Index()
  @ManyToOne(() => User, (user) => user.lpPositions, { nullable: true })
  @JoinColumn()
  account?: User;

  @Column('decimal', {
    precision: 500,
    scale: 5,
    transformer: {
      to: (value: number) => value?.toString(),
      from: (value: string) => (value ? Number(value) : value),
    },
  })
  position: number;

  @Column('bigint', {
    transformer: {
      to: (value: number) => value?.toString(),
      from: (value: string) => (value ? Number(value) : value),
    },
  })
  creationBlock: number;

  @Column()
  creationTransaction: string;

  @Index()
  @Column('bigint', {
    nullable: true,
    transformer: {
      to: (value: number) => value?.toString(),
      from: (value: string) => (value ? Number(value) : value),
    },
  })
  clPositionTokenId?: number;

  @Column('integer', { nullable: false, comment: 'Chain ID' })
  chainId: number;

  @VersionColumn()
  version: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  @BeforeUpdate()
  preSave() {
    this.id = this.account
      ? `${this.pool.address.toLowerCase()}-${this.account.address.toLowerCase()}-${this.chainId}`
      : `${this.pool.address.toLowerCase()}-${Date.now()}-${this.chainId}`;
  }
}
