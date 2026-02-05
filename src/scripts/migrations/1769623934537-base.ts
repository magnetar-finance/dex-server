import { MigrationInterface, QueryRunner } from 'typeorm';

export class Base1769623934537 implements MigrationInterface {
  name = 'Base1769623934537';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "tokens" ("id" character varying NOT NULL, "address" character varying NOT NULL, "symbol" character varying NOT NULL, "name" character varying NOT NULL, "decimals" integer NOT NULL, "trade_volume" numeric(500,5) NOT NULL, "trade_volume_usd" numeric(500,5) NOT NULL, "tx_count" bigint NOT NULL, "total_liquidity" numeric(500,5) NOT NULL, "total_liquidity_eth" numeric(500,5) NOT NULL, "total_liquidity_usd" numeric(500,5) NOT NULL, "derived_eth" numeric(500,5) NOT NULL, "derived_usd" numeric(500,5) NOT NULL, "chain_id" integer NOT NULL, "version" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_3001e89ada36263dabf1fb6210a" PRIMARY KEY ("id")); COMMENT ON COLUMN "tokens"."chain_id" IS 'Chain ID'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8887c0fb937bc0e9dc36cb62f3" ON "tokens" ("address") `,
    );
    await queryRunner.query(
      `CREATE TABLE "gauges" ("id" character varying NOT NULL, "address" character varying NOT NULL, "total_supply" numeric(500,5) NOT NULL, "fee_voting_reward" character varying NOT NULL, "bribe_voting_reward" character varying NOT NULL, "reward_rate" numeric(500,5) NOT NULL, "fees0" numeric(500,5) NOT NULL, "fees1" numeric(500,5) NOT NULL, "is_alive" boolean NOT NULL, "emission" numeric(500,5) NOT NULL, "chain_id" integer NOT NULL, "version" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deposit_pool_id" character varying, "reward_token_id" character varying, CONSTRAINT "PK_267c11fe6e224b453eb3ddf4f7a" PRIMARY KEY ("id")); COMMENT ON COLUMN "gauges"."chain_id" IS 'Chain ID'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_024f2f289383c6e75890f5d3e0" ON "gauges" ("address") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8d10346a05cea351dd17205c27" ON "gauges" ("deposit_pool_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5a9eb20325a5c2244c689d59c1" ON "gauges" ("reward_token_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d6d79d12c5f6531ae5da600cf7" ON "gauges" ("fee_voting_reward") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8aadc15086bc5a5414ca3c09d5" ON "gauges" ("bribe_voting_reward") `,
    );
    await queryRunner.query(
      `CREATE TABLE "swap" ("id" character varying NOT NULL, "timestamp" bigint NOT NULL, "sender" character varying NOT NULL, "from" character varying NOT NULL, "amount0_in" numeric(500,5) NOT NULL, "amount1_in" numeric(500,5) NOT NULL, "amount0_out" numeric(500,5) NOT NULL, "amount1_out" numeric(500,5) NOT NULL, "to" character varying NOT NULL, "log_index" bigint, "amount_usd" numeric(500,5) NOT NULL, "chain_id" integer NOT NULL, "version" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "transaction_id" character varying, "pool_id" character varying, CONSTRAINT "PK_4a10d0f359339acef77e7f986d9" PRIMARY KEY ("id")); COMMENT ON COLUMN "swap"."chain_id" IS 'Chain ID'`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_e78e7b899d2e3327494e5fe975" ON "swap" ("pool_id") `);
    await queryRunner.query(
      `CREATE TABLE "transaction" ("id" character varying NOT NULL, "hash" character varying NOT NULL, "block" bigint NOT NULL, "timestamp" bigint NOT NULL, "chain_id" integer NOT NULL, "version" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_89eadb93a89810556e1cbcd6ab9" PRIMARY KEY ("id")); COMMENT ON COLUMN "transaction"."chain_id" IS 'Chain ID'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_de4f0899c41c688529784bc443" ON "transaction" ("hash") `,
    );
    await queryRunner.query(
      `CREATE TABLE "mints" ("id" character varying NOT NULL, "timestamp" bigint NOT NULL, "to" character varying NOT NULL, "liquidity" numeric(500,5) NOT NULL, "sender" character varying, "amount0" numeric, "amount1" numeric, "log_index" bigint, "amount_usd" numeric, "fee_to" character varying, "fee_liquidity" numeric, "chain_id" integer NOT NULL, "version" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "transaction_id" character varying, "pool_id" character varying, CONSTRAINT "PK_357b35215f0af1f0a79dcd0ed04" PRIMARY KEY ("id")); COMMENT ON COLUMN "mints"."chain_id" IS 'Chain ID'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_701da7f5ffee9a73d2efbc7181" ON "mints" ("pool_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "pool_hour_data" ("id" character varying NOT NULL, "hour_start_unix" integer NOT NULL, "reserve0" numeric(500,5) NOT NULL, "reserve1" numeric(500,5) NOT NULL, "total_supply" numeric(500,5) NOT NULL, "reserve_usd" numeric(500,5) NOT NULL, "reserve_eth" numeric(500,5) NOT NULL, "hourly_volume_token0" numeric(500,5) NOT NULL, "hourly_volume_token1" numeric(500,5) NOT NULL, "hourly_volume_usd" numeric(500,5) NOT NULL, "hourly_volume_eth" numeric(500,5) NOT NULL, "hourly_txns" bigint NOT NULL, "version" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "pool_id" character varying, CONSTRAINT "PK_bd3e248a4a44a474ee2710ec329" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_45e83e45011ed1000559b91726" ON "pool_hour_data" ("pool_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."pools_pool_type_enum" AS ENUM('STABLE', 'VOLATILE', 'CONCENTRATED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "pools" ("id" character varying NOT NULL, "address" character varying NOT NULL, "name" character varying NOT NULL, "reserve0" numeric(500,5) NOT NULL, "reserve1" numeric(500,5) NOT NULL, "total_supply" numeric(500,5) NOT NULL, "reserve_eth" numeric(500,5) NOT NULL, "reserve_usd" numeric(500,5) NOT NULL, "token0_price" numeric(500,5) NOT NULL, "token1_price" numeric(500,5) NOT NULL, "volume_token0" numeric(500,5) NOT NULL, "volume_token1" numeric(500,5) NOT NULL, "volume_usd" numeric(500,5) NOT NULL, "volume_eth" numeric(500,5) NOT NULL, "tx_count" bigint NOT NULL, "created_at_timestamp" bigint NOT NULL, "created_at_block_number" bigint NOT NULL, "pool_type" "public"."pools_pool_type_enum" NOT NULL, "gauge_fees_usd" numeric(500,5) NOT NULL, "total_votes" numeric(500,5) NOT NULL, "total_fees_usd" numeric(500,5) NOT NULL, "total_bribes_usd" numeric(500,5) NOT NULL, "total_fees0" numeric(500,5) NOT NULL, "total_fees1" numeric(500,5) NOT NULL, "gauge_fees0_current_epoch" numeric(500,5) NOT NULL, "gauge_fees1_current_epoch" numeric(500,5) NOT NULL, "total_emissions" numeric(500,5) NOT NULL, "total_emissions_usd" numeric(500,5) NOT NULL, "tick_spacing" bigint, "chain_id" integer NOT NULL, "version" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "token0_id" character varying, "token1_id" character varying, "gauge_id" character varying, CONSTRAINT "PK_6708c86fc389259de3ee43230ee" PRIMARY KEY ("id")); COMMENT ON COLUMN "pools"."chain_id" IS 'Chain ID'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8f9d6a1e9ca7c169ba22b77d0e" ON "pools" ("address") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f6aebd4ec3048003ffb76bdb1a" ON "pools" ("gauge_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "burn" ("id" character varying NOT NULL, "timestamp" bigint NOT NULL, "liquidity" numeric(500,5) NOT NULL, "sender" character varying, "amount0" numeric, "amount1" numeric, "to" character varying, "log_index" bigint, "amount_usd" numeric, "needs_complete" boolean NOT NULL, "fee_to" character varying, "fee_liquidity" numeric, "chain_id" integer NOT NULL, "version" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "transaction_id" character varying, "pool_id" character varying, CONSTRAINT "PK_dcb4f14ee4534154b31116553f0" PRIMARY KEY ("id")); COMMENT ON COLUMN "burn"."chain_id" IS 'Chain ID'`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_22b68d0fc4aa2284f6305498d4" ON "burn" ("pool_id") `);
    await queryRunner.query(
      `CREATE TABLE "liquidity_position" ("id" character varying NOT NULL, "position" numeric(500,5) NOT NULL, "creation_block" bigint NOT NULL, "creation_transaction" character varying NOT NULL, "cl_position_token_id" bigint, "chain_id" integer NOT NULL, "version" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "pool_id" character varying, "account_id" character varying, CONSTRAINT "PK_db00d963c96b3914d26abe3c3d2" PRIMARY KEY ("id")); COMMENT ON COLUMN "liquidity_position"."chain_id" IS 'Chain ID'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1ea3a8c063d805618b13bc8a37" ON "liquidity_position" ("pool_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_56b5a18835c376d75dbe571f7b" ON "liquidity_position" ("account_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c6b50da31a256b3a7f4ddf9b8d" ON "liquidity_position" ("cl_position_token_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."lock_position_lock_type_enum" AS ENUM('MANAGED', 'NORMAL')`,
    );
    await queryRunner.query(
      `CREATE TABLE "lock_position" ("id" character varying NOT NULL, "position" numeric(500,5) NOT NULL, "creation_block" bigint NOT NULL, "creation_transaction" character varying NOT NULL, "lock_id" bigint NOT NULL, "lock_type" "public"."lock_position_lock_type_enum" NOT NULL, "permanent" boolean NOT NULL, "lock_reward_manager" character varying, "free_reward_manager" character varying, "unlock_time" bigint NOT NULL, "total_vote_weight_given" numeric(500,5) NOT NULL, "chain_id" integer NOT NULL, "version" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "owner_id" character varying, CONSTRAINT "PK_83e2d870d23ea4ddaecb6f78c9b" PRIMARY KEY ("id")); COMMENT ON COLUMN "lock_position"."chain_id" IS 'Chain ID'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_43a233da485c47e3f985f0cd98" ON "lock_position" ("owner_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4c27322d98d770b442f02f6cdb" ON "lock_position" ("lock_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_abefde8613b376145baaee9ab9" ON "lock_position" ("lock_reward_manager") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_52d1e2156e668445d9659fb9c1" ON "lock_position" ("free_reward_manager") `,
    );
    await queryRunner.query(
      `CREATE TABLE "user" ("id" character varying NOT NULL, "address" character varying NOT NULL, "version" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_cace4a159ff9f2512dd42373760" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_3122b4b8709577da50e89b6898" ON "user" ("address") `);
    await queryRunner.query(
      `CREATE TABLE "gauge_position" ("id" character varying NOT NULL, "amount_deposited" numeric(500,5) NOT NULL, "creation_transaction" character varying NOT NULL, "creation_block" bigint NOT NULL, "chain_id" integer NOT NULL, "version" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "gauge_id" character varying, "account_id" character varying, CONSTRAINT "PK_bf41a5aba76bc276ef373b56ac9" PRIMARY KEY ("id")); COMMENT ON COLUMN "gauge_position"."chain_id" IS 'Chain ID'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_51d75ef2de6c7ac831e80da38c" ON "gauge_position" ("gauge_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2a2a18373a495a61373132722c" ON "gauge_position" ("account_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "indexer_event_statuses" ("id" character varying NOT NULL, "last_block_number" bigint NOT NULL, "event_name" character varying NOT NULL, "chain_id" integer NOT NULL, "contract_address" character varying NOT NULL, "version" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_3c92a36580a54dd0a8d4ec2cc0e" PRIMARY KEY ("id")); COMMENT ON COLUMN "indexer_event_statuses"."last_block_number" IS 'Last processed block for this event'; COMMENT ON COLUMN "indexer_event_statuses"."event_name" IS 'Event name'; COMMENT ON COLUMN "indexer_event_statuses"."chain_id" IS 'Chain ID'`,
    );
    await queryRunner.query(
      `CREATE TABLE "overall_day_data" ("id" character varying NOT NULL, "date" integer NOT NULL, "volume_eth" numeric(500,5) NOT NULL, "volume_usd" numeric(500,5) NOT NULL, "liquidity_eth" numeric(500,5) NOT NULL, "liquidity_usd" numeric(500,5) NOT NULL, "tx_count" bigint NOT NULL, "fees_usd" numeric(500,5) NOT NULL, "total_trade_volume_eth" numeric(500,5) NOT NULL, "total_trade_volume_usd" numeric(500,5) NOT NULL, "version" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ed9607e00c1e7a1ef7781f75e8a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ab1e8bc53c547546463b9899fa" ON "overall_day_data" ("date") `,
    );
    await queryRunner.query(
      `CREATE TABLE "pool_day_data" ("id" character varying NOT NULL, "date" integer NOT NULL, "reserve0" numeric(500,5) NOT NULL, "reserve1" numeric(500,5) NOT NULL, "total_supply" numeric(500,5) NOT NULL, "reserve_usd" numeric(500,5) NOT NULL, "reserve_eth" numeric(500,5) NOT NULL, "daily_volume_token0" numeric(500,5) NOT NULL, "daily_volume_token1" numeric(500,5) NOT NULL, "daily_volume_usd" numeric(500,5) NOT NULL, "daily_volume_eth" numeric(500,5) NOT NULL, "daily_txns" bigint NOT NULL, "version" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "pool_id" character varying, CONSTRAINT "PK_712b106eb8cc6842af6ca4cab80" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2f4c9e466537cf8101cbdceaea" ON "pool_day_data" ("pool_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "statistics" ("id" integer NOT NULL, "tx_count" bigint NOT NULL, "total_pairs_created" bigint NOT NULL, "total_volume_locked_usd" numeric(500,5) NOT NULL, "total_volume_locked_eth" numeric(500,5) NOT NULL, "total_fees_usd" numeric(500,5) NOT NULL, "total_bribes_usd" numeric(500,5) NOT NULL, "total_trade_volume_usd" numeric(500,5) NOT NULL, "total_trade_volume_eth" numeric(500,5) NOT NULL, "version" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_c3769cca342381fa827a0f246a7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "token_day_data" ("id" character varying NOT NULL, "date" integer NOT NULL, "daily_volume_token" numeric(500,5) NOT NULL, "daily_volume_eth" numeric(500,5) NOT NULL, "daily_volume_usd" numeric(500,5) NOT NULL, "daily_txns" bigint NOT NULL, "total_liquidity_token" numeric(500,5) NOT NULL, "total_liquidity_eth" numeric(500,5) NOT NULL, "total_liquidity_usd" numeric(500,5) NOT NULL, "price_usd" numeric(500,5) NOT NULL, "price_eth" numeric(500,5) NOT NULL, "token_id" character varying, CONSTRAINT "PK_73fc06337215e86196b36822116" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b8950a8bc7b60231137573740e" ON "token_day_data" ("token_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "gauges" ADD CONSTRAINT "FK_8d10346a05cea351dd17205c272" FOREIGN KEY ("deposit_pool_id") REFERENCES "pools"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "gauges" ADD CONSTRAINT "FK_5a9eb20325a5c2244c689d59c1c" FOREIGN KEY ("reward_token_id") REFERENCES "tokens"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "swap" ADD CONSTRAINT "FK_78506c4050ae7cedd50b08c0dc5" FOREIGN KEY ("transaction_id") REFERENCES "transaction"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "swap" ADD CONSTRAINT "FK_e78e7b899d2e3327494e5fe975d" FOREIGN KEY ("pool_id") REFERENCES "pools"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "mints" ADD CONSTRAINT "FK_10d5dfb3a92f91cf0ac9cb559d5" FOREIGN KEY ("transaction_id") REFERENCES "transaction"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "mints" ADD CONSTRAINT "FK_701da7f5ffee9a73d2efbc71810" FOREIGN KEY ("pool_id") REFERENCES "pools"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "pool_hour_data" ADD CONSTRAINT "FK_45e83e45011ed1000559b91726f" FOREIGN KEY ("pool_id") REFERENCES "pools"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "pools" ADD CONSTRAINT "FK_7e3b2e9c356a0762bc64e280f5e" FOREIGN KEY ("token0_id") REFERENCES "tokens"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "pools" ADD CONSTRAINT "FK_7c546065bdf3d8bc850034ac9f9" FOREIGN KEY ("token1_id") REFERENCES "tokens"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "pools" ADD CONSTRAINT "FK_f6aebd4ec3048003ffb76bdb1a0" FOREIGN KEY ("gauge_id") REFERENCES "gauges"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "burn" ADD CONSTRAINT "FK_20ec76c5c56dd6b47dec5f0aaa8" FOREIGN KEY ("transaction_id") REFERENCES "transaction"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "burn" ADD CONSTRAINT "FK_22b68d0fc4aa2284f6305498d4e" FOREIGN KEY ("pool_id") REFERENCES "pools"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "liquidity_position" ADD CONSTRAINT "FK_1ea3a8c063d805618b13bc8a37b" FOREIGN KEY ("pool_id") REFERENCES "pools"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "liquidity_position" ADD CONSTRAINT "FK_56b5a18835c376d75dbe571f7bb" FOREIGN KEY ("account_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "lock_position" ADD CONSTRAINT "FK_43a233da485c47e3f985f0cd98c" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "gauge_position" ADD CONSTRAINT "FK_51d75ef2de6c7ac831e80da38c7" FOREIGN KEY ("gauge_id") REFERENCES "gauges"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "gauge_position" ADD CONSTRAINT "FK_2a2a18373a495a61373132722c5" FOREIGN KEY ("account_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "pool_day_data" ADD CONSTRAINT "FK_2f4c9e466537cf8101cbdceaea1" FOREIGN KEY ("pool_id") REFERENCES "pools"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "token_day_data" ADD CONSTRAINT "FK_b8950a8bc7b60231137573740ea" FOREIGN KEY ("token_id") REFERENCES "tokens"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "token_day_data" DROP CONSTRAINT "FK_b8950a8bc7b60231137573740ea"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pool_day_data" DROP CONSTRAINT "FK_2f4c9e466537cf8101cbdceaea1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "gauge_position" DROP CONSTRAINT "FK_2a2a18373a495a61373132722c5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "gauge_position" DROP CONSTRAINT "FK_51d75ef2de6c7ac831e80da38c7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lock_position" DROP CONSTRAINT "FK_43a233da485c47e3f985f0cd98c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "liquidity_position" DROP CONSTRAINT "FK_56b5a18835c376d75dbe571f7bb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "liquidity_position" DROP CONSTRAINT "FK_1ea3a8c063d805618b13bc8a37b"`,
    );
    await queryRunner.query(`ALTER TABLE "burn" DROP CONSTRAINT "FK_22b68d0fc4aa2284f6305498d4e"`);
    await queryRunner.query(`ALTER TABLE "burn" DROP CONSTRAINT "FK_20ec76c5c56dd6b47dec5f0aaa8"`);
    await queryRunner.query(`ALTER TABLE "pools" DROP CONSTRAINT "FK_f6aebd4ec3048003ffb76bdb1a0"`);
    await queryRunner.query(`ALTER TABLE "pools" DROP CONSTRAINT "FK_7c546065bdf3d8bc850034ac9f9"`);
    await queryRunner.query(`ALTER TABLE "pools" DROP CONSTRAINT "FK_7e3b2e9c356a0762bc64e280f5e"`);
    await queryRunner.query(
      `ALTER TABLE "pool_hour_data" DROP CONSTRAINT "FK_45e83e45011ed1000559b91726f"`,
    );
    await queryRunner.query(`ALTER TABLE "mints" DROP CONSTRAINT "FK_701da7f5ffee9a73d2efbc71810"`);
    await queryRunner.query(`ALTER TABLE "mints" DROP CONSTRAINT "FK_10d5dfb3a92f91cf0ac9cb559d5"`);
    await queryRunner.query(`ALTER TABLE "swap" DROP CONSTRAINT "FK_e78e7b899d2e3327494e5fe975d"`);
    await queryRunner.query(`ALTER TABLE "swap" DROP CONSTRAINT "FK_78506c4050ae7cedd50b08c0dc5"`);
    await queryRunner.query(
      `ALTER TABLE "gauges" DROP CONSTRAINT "FK_5a9eb20325a5c2244c689d59c1c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "gauges" DROP CONSTRAINT "FK_8d10346a05cea351dd17205c272"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_b8950a8bc7b60231137573740e"`);
    await queryRunner.query(`DROP TABLE "token_day_data"`);
    await queryRunner.query(`DROP TABLE "statistics"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_2f4c9e466537cf8101cbdceaea"`);
    await queryRunner.query(`DROP TABLE "pool_day_data"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ab1e8bc53c547546463b9899fa"`);
    await queryRunner.query(`DROP TABLE "overall_day_data"`);
    await queryRunner.query(`DROP TABLE "indexer_event_statuses"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_2a2a18373a495a61373132722c"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_51d75ef2de6c7ac831e80da38c"`);
    await queryRunner.query(`DROP TABLE "gauge_position"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_3122b4b8709577da50e89b6898"`);
    await queryRunner.query(`DROP TABLE "user"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_52d1e2156e668445d9659fb9c1"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_abefde8613b376145baaee9ab9"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_4c27322d98d770b442f02f6cdb"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_43a233da485c47e3f985f0cd98"`);
    await queryRunner.query(`DROP TABLE "lock_position"`);
    await queryRunner.query(`DROP TYPE "public"."lock_position_lock_type_enum"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_c6b50da31a256b3a7f4ddf9b8d"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_56b5a18835c376d75dbe571f7b"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_1ea3a8c063d805618b13bc8a37"`);
    await queryRunner.query(`DROP TABLE "liquidity_position"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_22b68d0fc4aa2284f6305498d4"`);
    await queryRunner.query(`DROP TABLE "burn"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_f6aebd4ec3048003ffb76bdb1a"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_8f9d6a1e9ca7c169ba22b77d0e"`);
    await queryRunner.query(`DROP TABLE "pools"`);
    await queryRunner.query(`DROP TYPE "public"."pools_pool_type_enum"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_45e83e45011ed1000559b91726"`);
    await queryRunner.query(`DROP TABLE "pool_hour_data"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_701da7f5ffee9a73d2efbc7181"`);
    await queryRunner.query(`DROP TABLE "mints"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_de4f0899c41c688529784bc443"`);
    await queryRunner.query(`DROP TABLE "transaction"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e78e7b899d2e3327494e5fe975"`);
    await queryRunner.query(`DROP TABLE "swap"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_8aadc15086bc5a5414ca3c09d5"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_d6d79d12c5f6531ae5da600cf7"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_5a9eb20325a5c2244c689d59c1"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_8d10346a05cea351dd17205c27"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_024f2f289383c6e75890f5d3e0"`);
    await queryRunner.query(`DROP TABLE "gauges"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_8887c0fb937bc0e9dc36cb62f3"`);
    await queryRunner.query(`DROP TABLE "tokens"`);
  }
}
