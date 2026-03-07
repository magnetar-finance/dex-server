import {
  Entity,
  PrimaryColumn,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  BeforeInsert,
  CreateDateColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import { User } from './user.entity';

export enum LockType {
  MANAGED = 'MANAGED',
  NORMAL = 'NORMAL',
}

@Entity('lock_position')
export class LockPosition {
  @PrimaryColumn()
  id: string;

  @Column('decimal', {
    precision: 500,
    scale: 5,
    transformer: {
      to: (value: number) => value?.toString(),
      from: (value: string) => (value ? Number(value) : value),
    },
  })
  position: number;

  @Index()
  @ManyToOne(() => User, (user) => user.lockPositions)
  @JoinColumn()
  owner: User;

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
    transformer: {
      to: (value: number) => value?.toString(),
      from: (value: string) => (value ? Number(value) : value),
    },
  })
  lockId: number;

  @Column({ type: 'enum', enum: LockType })
  lockType: LockType;

  @Column()
  permanent: boolean;

  @Index()
  @Column({ nullable: true })
  lockRewardManager?: string;

  @Index()
  @Column({ nullable: true })
  freeRewardManager?: string;

  @Column('bigint', {
    transformer: {
      to: (value: number) => value?.toString(),
      from: (value: string) => (value ? Number(value) : value),
    },
  })
  unlockTime: number;

  @Column('decimal', {
    precision: 500,
    scale: 5,
    transformer: {
      to: (value: number) => value?.toString(),
      from: (value: string) => (value ? Number(value) : value),
    },
  })
  totalVoteWeightGiven: number;

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
    this.id = `${this.owner.address.toLowerCase()}-${this.lockId}-${this.chainId}`;
  }
}
