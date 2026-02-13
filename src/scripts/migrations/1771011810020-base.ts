import { MigrationInterface, QueryRunner } from 'typeorm';

export class Base1771011810020 implements MigrationInterface {
  name = 'Base1771011810020';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "stats" ("id" character varying NOT NULL, "tx_count" bigint NOT NULL, "total_pairs_created" bigint NOT NULL, "total_volume_locked_usd" numeric(500,5) NOT NULL, "total_volume_locked_eth" numeric(500,5) NOT NULL, "total_fees_usd" numeric(500,5) NOT NULL, "total_bribes_usd" numeric(500,5) NOT NULL, "total_trade_volume_usd" numeric(500,5) NOT NULL, "total_trade_volume_eth" numeric(500,5) NOT NULL, "chain_id" integer NOT NULL, "version" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_c76e93dfef28ba9b6942f578ab1" PRIMARY KEY ("id")); COMMENT ON COLUMN "stats"."chain_id" IS 'Chain ID'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "stats"`);
  }
}
