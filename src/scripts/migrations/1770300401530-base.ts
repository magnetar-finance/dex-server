import { MigrationInterface, QueryRunner } from 'typeorm';

export class Base1770300401530 implements MigrationInterface {
  name = 'Base1770300401530';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "overall_day_data" ADD "chain_id" integer NOT NULL`);
    await queryRunner.query(`COMMENT ON COLUMN "overall_day_data"."chain_id" IS 'Chain ID'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`COMMENT ON COLUMN "overall_day_data"."chain_id" IS 'Chain ID'`);
    await queryRunner.query(`ALTER TABLE "overall_day_data" DROP COLUMN "chain_id"`);
  }
}
