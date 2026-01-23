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
import { Token } from './token.entity';

@Entity('gauges')
export class Gauge {
  @PrimaryColumn('varchar')
  id: string;

  @Index()
  @Column('varchar')
  address: string;

  @Index()
  @ManyToOne(() => Pool)
  @JoinColumn()
  depositPool: Pool;

  @Index()
  @ManyToOne(() => Token)
  @JoinColumn()
  rewardToken: Token;

  @Column('decimal', { precision: 500, scale: 5 })
  totalSupply: string;

  @Index()
  @Column()
  feeVotingReward: string;

  @Index()
  @Column()
  bribeVotingReward: string;

  @Column('decimal', { precision: 500, scale: 5 })
  rewardRate: string;

  @Column('decimal', { precision: 500, scale: 5 })
  fees0: string;

  @Column('decimal', { precision: 500, scale: 5 })
  fees1: string;

  @Column()
  isAlive: boolean;

  @Column('decimal', { precision: 500, scale: 5 })
  emission: string;

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
    this.id = `${this.address.toLowerCase()}-${this.chainId}`;
  }
}
