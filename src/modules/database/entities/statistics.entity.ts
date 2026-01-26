import {
  Entity,
  PrimaryColumn,
  Column,
  BeforeInsert,
  CreateDateColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

@Entity('statistics')
export class Statistics {
  @PrimaryColumn()
  id: number;

  @Column('bigint', {
    transformer: {
      to: (value: number) => value?.toString(),
      from: (value: string) => (value ? Number(value) : value),
    },
  })
  txCount: number;

  @Column('bigint', {
    transformer: {
      to: (value: number) => value?.toString(),
      from: (value: string) => (value ? Number(value) : value),
    },
  })
  totalPairsCreated: number;

  @Column('decimal', {
    precision: 500,
    scale: 5,
    transformer: {
      to: (value: number) => value?.toString(),
      from: (value: string) => (value ? Number(value) : value),
    },
  })
  totalVolumeLockedUSD: number;

  @Column('decimal', {
    precision: 500,
    scale: 5,
    transformer: {
      to: (value: number) => value?.toString(),
      from: (value: string) => (value ? Number(value) : value),
    },
  })
  totalVolumeLockedETH: number;

  @Column('decimal', {
    precision: 500,
    scale: 5,
    transformer: {
      to: (value: number) => value?.toString(),
      from: (value: string) => (value ? Number(value) : value),
    },
  })
  totalFeesUSD: number;

  @Column('decimal', {
    precision: 500,
    scale: 5,
    transformer: {
      to: (value: number) => value?.toString(),
      from: (value: string) => (value ? Number(value) : value),
    },
  })
  totalBribesUSD: number;

  @Column('decimal', {
    precision: 500,
    scale: 5,
    transformer: {
      to: (value: number) => value?.toString(),
      from: (value: string) => (value ? Number(value) : value),
    },
  })
  totalTradeVolumeUSD: number;

  @Column('decimal', {
    precision: 500,
    scale: 5,
    transformer: {
      to: (value: number) => value?.toString(),
      from: (value: string) => (value ? Number(value) : value),
    },
  })
  totalTradeVolumeETH: number;

  @VersionColumn()
  version: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  oneRowGuard() {
    this.id = 1;
  }
}
