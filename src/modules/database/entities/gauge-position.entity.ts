import {
  Entity,
  PrimaryColumn,
  Index,
  ManyToOne,
  JoinColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  VersionColumn,
  BeforeInsert,
} from 'typeorm';
import { Gauge } from './gauge.entity';
import { User } from './user.entity';

@Entity('gauge_position')
export class GaugePosition {
  @PrimaryColumn()
  id: string;

  @Index()
  @ManyToOne(() => Gauge)
  @JoinColumn()
  gauge: Gauge;

  @Column('decimal', {
    precision: 500,
    scale: 5,
    transformer: {
      to: (value: number) => value?.toString(),
      from: (value: string) => (value ? Number(value) : value),
    },
  })
  amountDeposited: number;

  @Index()
  @ManyToOne(() => User, (user) => user.gaugePositions)
  @JoinColumn()
  account: User;

  @Column()
  creationTransaction: string;

  @Column('bigint', {
    transformer: {
      to: (value: number) => value?.toString(),
      from: (value: string) => (value ? Number(value) : value),
    },
  })
  creationBlock: number;

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
    this.id = `${this.account.address.toString()}-${this.gauge.address.toString()}-${this.chainId}`;
  }
}
