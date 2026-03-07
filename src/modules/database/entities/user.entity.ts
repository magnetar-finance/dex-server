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
import { LiquidityPosition } from './lp-position.entity';
import { GaugePosition } from './gauge-position.entity';
import { LockPosition } from './lock-position.entity';

@Entity('user')
export class User {
  @PrimaryColumn()
  id: string;

  @Index()
  @Column()
  address: string;

  @OneToMany(() => GaugePosition, (gp) => gp.account)
  gaugePositions: GaugePosition[];

  @OneToMany(() => LiquidityPosition, (lp) => lp.account)
  lpPositions: LiquidityPosition[];

  @OneToMany(() => LockPosition, (lp) => lp.owner)
  lockPositions: LockPosition[];

  @VersionColumn()
  version: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  preSave() {
    this.id = this.address.toLowerCase();
  }
}
