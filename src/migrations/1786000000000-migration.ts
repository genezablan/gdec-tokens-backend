import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Record when a session's time was never checked against the coach's Outlook.
 *
 * The booking-time conflict check fails open — if Graph is unreachable or the
 * coach's refresh token has gone stale, the booking proceeds rather than making
 * scheduling depend on Microsoft's uptime. That was previously invisible outside
 * a log line, so a coach could be double-booked with no indication. This column
 * carries that fact through to the UI.
 *
 * Defaults to false: existing rows were booked under the old behaviour, and we
 * can't retroactively tell which ones skipped the check.
 */
export class Migration1786000000000 implements MigrationInterface {
  name = 'Migration1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "coaching_sessions" ADD "outlookCheckFailed" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "coaching_sessions" DROP COLUMN "outlookCheckFailed"`,
    );
  }
}
