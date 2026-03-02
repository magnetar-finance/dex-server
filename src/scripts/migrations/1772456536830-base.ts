import { MigrationInterface, QueryRunner } from "typeorm";

export class Base1772456536830 implements MigrationInterface {
    name = 'Base1772456536830'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "swap" ADD "has_been_processed" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "mints" ADD "has_been_processed" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "burn" ADD "has_been_processed" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`CREATE INDEX "IDX_1bb0a599979b86b5cf7b98d2a6" ON "swap" ("has_been_processed") `);
        await queryRunner.query(`CREATE INDEX "IDX_a032ee2382503df52124f96cac" ON "mints" ("has_been_processed") `);
        await queryRunner.query(`CREATE INDEX "IDX_f4993be039b97f7abae1669c78" ON "burn" ("has_been_processed") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_f4993be039b97f7abae1669c78"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a032ee2382503df52124f96cac"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1bb0a599979b86b5cf7b98d2a6"`);
        await queryRunner.query(`ALTER TABLE "burn" DROP COLUMN "has_been_processed"`);
        await queryRunner.query(`ALTER TABLE "mints" DROP COLUMN "has_been_processed"`);
        await queryRunner.query(`ALTER TABLE "swap" DROP COLUMN "has_been_processed"`);
    }

}
