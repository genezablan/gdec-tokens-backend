import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1782200000001 implements MigrationInterface {
  name = 'Migration1782200000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "coaching_sessions" ADD "graphEventId" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "coaching_sessions" ADD "teamsJoinUrl" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "coaching_sessions" ADD "calendarSyncStatus" character varying(20)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "coaching_sessions" DROP COLUMN "calendarSyncStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "coaching_sessions" DROP COLUMN "teamsJoinUrl"`,
    );
    await queryRunner.query(
      `ALTER TABLE "coaching_sessions" DROP COLUMN "graphEventId"`,
    );
  }
}
