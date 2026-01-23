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
import { Mint } from './mint.entity';
import { Burn } from './burn.entity';
import { Swap } from './swap.entity';

@Entity('transaction')
export class Transaction {
  @PrimaryColumn()
  id: string;

  @Index()
  @Column()
  hash: string;

  @Column('bigint')
  block: string;

  @Column('bigint')
  timestamp: string;

  @OneToMany(() => Mint, (mint) => mint.transaction)
  mints: Mint[];

  @OneToMany(() => Burn, (burn) => burn.transaction)
  burns: Burn[];

  @OneToMany(() => Swap, (swap) => swap.transaction)
  swaps: Swap[];

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
    this.id = `${this.hash.toLowerCase()}-${this.chainId}`;
  }
}
