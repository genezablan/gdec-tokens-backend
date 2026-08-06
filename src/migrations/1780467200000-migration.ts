import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1780467200000 implements MigrationInterface {
  name = 'Migration1780467200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "headline" character varying(120)`,
    );
    await queryRunner.query(`ALTER TABLE "users" ADD "bio" text`);
    await queryRunner.query(`ALTER TABLE "users" ADD "specialties" text array`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "yearsExperience" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "maxCoachesPerCycle" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "maxCoachesPerCycle"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "yearsExperience"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "specialties"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "bio"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "headline"`);
  }
}
