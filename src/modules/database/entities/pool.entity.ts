import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import { Token } from './token.entity';
import { Gauge } from './gauge.entity';
import { Mint } from './mint.entity';
import { Burn } from './burn.entity';
import { Swap } from './swap.entity';
import { PoolHourData } from './pool-hour-data.entity';

export enum PoolType {
  STABLE = 'STABLE',
  VOLATILE = 'VOLATILE',
  CONCENTRATED = 'CONCENTRATED',
}

@Entity('pools')
export class Pool {
  @PrimaryColumn('varchar')
  id: string;

  @Index()
  @Column()
  address: string;

  @Column()
  name: string;

  @ManyToOne(() => Token, (token) => token.basePools)
  @JoinColumn()
  token0: Token;

  @ManyToOne(() => Token, (token) => token.quotePools)
  @JoinColumn()
  token1: Token;

  @Column('decimal', { precision: 500, scale: 5 })
  reserve0: string;

  @Column('decimal', { precision: 500, scale: 5 })
  reserve1: string;

  @Column('decimal', { precision: 500, scale: 5 })
  totalSupply: string;

  @Column('decimal', { precision: 500, scale: 5 })
  reserveETH: string;

  @Column('decimal', { precision: 500, scale: 5 })
  reserveUSD: string;

  @Column('decimal', { precision: 500, scale: 5 })
  token0Price: string;

  @Column('decimal', { precision: 500, scale: 5 })
  token1Price: string;

  @Column('decimal', { precision: 500, scale: 5 })
  volumeToken0: string;

  @Column('decimal', { precision: 500, scale: 5 })
  volumeToken1: string;

  @Column('decimal', { precision: 500, scale: 5 })
  volumeUSD: string;

  @Column('decimal', { precision: 500, scale: 5 })
  volumeETH: string;

  @Column('bigint')
  txCount: string;

  @Column('bigint')
  createdAtTimestamp: string;

  @Column('bigint')
  createdAtBlockNumber: string;

  @OneToMany(() => PoolHourData, (phd) => phd.pool)
  poolHourData: PoolHourData[];

  @OneToMany(() => Mint, (mint) => mint.pool)
  mints: Mint[];

  @OneToMany(() => Burn, (burn) => burn.pool)
  burns: Burn[];

  @OneToMany(() => Swap, (swap) => swap.pool)
  swaps: Swap[];

  @Column({ type: 'enum', enum: PoolType })
  poolType: PoolType;

  @Column('decimal', { precision: 500, scale: 5 })
  gaugeFeesUSD: string;

  @Column('decimal', { precision: 500, scale: 5 })
  totalVotes: string;

  @Column('decimal', { precision: 500, scale: 5 })
  totalFeesUSD: string;

  @Column('decimal', { precision: 500, scale: 5 })
  totalBribesUSD: string;

  @Column('decimal', { precision: 500, scale: 5 })
  totalFees0: string;

  @Column('decimal', { precision: 500, scale: 5 })
  totalFees1: string;

  @Column('decimal', { precision: 500, scale: 5 })
  gaugeFees0CurrentEpoch: string;

  @Column('decimal', { precision: 500, scale: 5 })
  gaugeFees1CurrentEpoch: string;

  @Column('decimal', { precision: 500, scale: 5 })
  totalEmissions: string;

  @Column('decimal', { precision: 500, scale: 5 })
  totalEmissionsUSD: string;

  @Index()
  @ManyToOne(() => Gauge, { nullable: true })
  @JoinColumn()
  gauge?: Gauge;

  @Column('bigint', { nullable: true })
  tickSpacing?: string;

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
