import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1782200000002 implements MigrationInterface {
  name = 'Migration1782200000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "coachingDays" integer array`,
    );
    await queryRunner.query(`ALTER TABLE "users" ADD "coachingStartTime" TIME`);
    await queryRunner.query(`ALTER TABLE "users" ADD "coachingEndTime" TIME`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "coachingSessionMinutes" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "coachingSessionMinutes"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "coachingEndTime"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "coachingStartTime"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "coachingDays"`);
  }
}
