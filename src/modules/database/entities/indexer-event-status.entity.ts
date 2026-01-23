import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

@Entity('indexer_event_statuses')
export class IndexerEventStatus {
  @PrimaryColumn('varchar')
  id: string;

  @Column('bigint', {
    nullable: false,
    comment: 'Last processed block for this event',
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
  lastBlockNumber: number;

  @Column('varchar', { nullable: false, comment: 'Event name' })
  eventName: string;

  @Column('integer', { nullable: false, comment: 'Chain ID' })
  chainId: number;

  @Column('varchar', { nullable: false })
  contractAddress: string;

  @VersionColumn()
  version: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  preSave() {
    this.id = `${this.eventName}-${this.contractAddress.toLowerCase()}:${this.chainId}`;
  }
}
