import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds heartbeat-based session duration tracking to login_events. Auth is
 * stateless JWT with no reliable logout signal, so the frontend pings a
 * heartbeat endpoint periodically while the app is open; durationSeconds
 * accumulates as long as consecutive heartbeats land within an idle window.
 */
export class Migration1784540000000 implements MigrationInterface {
  name = 'Migration1784540000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "login_events" ADD "lastHeartbeatAt" TIMESTAMPTZ`,
    );
    await queryRunner.query(
      `ALTER TABLE "login_events" ADD "durationSeconds" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "login_events" DROP COLUMN "durationSeconds"`,
    );
    await queryRunner.query(
      `ALTER TABLE "login_events" DROP COLUMN "lastHeartbeatAt"`,
    );
  }
}
