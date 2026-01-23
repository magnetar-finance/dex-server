import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import { Pool } from './pool.entity';

@Entity('tokens')
export class Token {
  @PrimaryColumn('varchar')
  id: string;

  @Index()
  @Column('varchar', { nullable: false })
  address: string;

  @Column('varchar', { nullable: false })
  symbol: string;

  @Column('varchar', { nullable: false })
  name: string;

  @Column('int', { nullable: false })
  decimals: number;

  @Column('decimal', { precision: 500, scale: 5 })
  tradeVolume: string;

  @Column('decimal', { precision: 500, scale: 5 })
  tradeVolumeUSD: string;

  @Column('bigint', {
    transformer: {
      from(value: string | bigint | null | undefined): number {
        return value !== null && typeof value !== 'undefined'
          ? parseInt(value.toString())
          : 0;
      },
      to(value: number | null | undefined) {
        return value !== null && typeof value !== 'undefined'
          ? value.toString()
          : null;
      },
    },
  })
  txCount: number;

  @Column('decimal', { precision: 500, scale: 5 })
  totalLiquidity: string;

  @Column('decimal', { precision: 500, scale: 5 })
  totalLiquidityETH: string;

  @Column('decimal', { precision: 500, scale: 5 })
  totalLiquidityUSD: string;

  @Column('decimal', { precision: 500, scale: 5 })
  derivedETH: string;

  @Column('decimal', { precision: 500, scale: 5 })
  derivedUSD: string;

  @OneToMany(() => Pool, (pool) => pool.token0)
  basePools: Pool[];

  @OneToMany(() => Pool, (pool) => pool.token1)
  quotePools: Pool[];

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
