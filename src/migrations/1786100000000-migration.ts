import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Store every timestamp as `timestamptz` instead of a naive `timestamp`.
 *
 * 19 columns — every `@CreateDateColumn`/`@UpdateDateColumn` that shipped
 * without an explicit type — were `timestamp without time zone`. A naive column
 * carries no offset, so node-postgres builds the JS Date using *the reading
 * process's* timezone. That made a stored value mean different instants
 * depending on where the app ran: with the process on UTC a request created at
 * 1:51 PM Manila rendered correctly, and with the process on Asia/Manila the
 * same row rendered as 5:51 AM.
 *
 * The stored values are unambiguous despite the type: the column default is
 * `now()` and the database session is UTC, so every existing value is a UTC
 * wall clock. `AT TIME ZONE 'UTC'` therefore reinterprets them exactly, without
 * shifting any real instant.
 *
 * After this, the interpretation no longer depends on the process timezone at
 * all — which is what makes the scheduling code's explicit conversions
 * (common/utils/timezone.ts) the single place timezone logic lives.
 */
const COLUMNS: [table: string, column: string][] = [
  ['calendar_connections', 'createdAt'],
  ['calendar_connections', 'updatedAt'],
  ['coach_availability', 'createdAt'],
  ['coach_availability', 'updatedAt'],
  ['coaching_sessions', 'createdAt'],
  ['coaching_sessions', 'updatedAt'],
  ['development_options', 'createdAt'],
  ['development_options', 'updatedAt'],
  ['login_events', 'createdAt'],
  ['notifications', 'createdAt'],
  ['token_balances', 'createdAt'],
  ['token_balances', 'updatedAt'],
  ['token_balances', 'lastReminderSentAt'],
  ['token_requests', 'createdAt'],
  ['token_requests', 'updatedAt'],
  ['tutorials', 'createdAt'],
  ['tutorials', 'updatedAt'],
  ['users', 'createdAt'],
  ['users', 'updatedAt'],
];

export class Migration1786100000000 implements MigrationInterface {
  name = 'Migration1786100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column] of COLUMNS) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE timestamptz USING "${column}" AT TIME ZONE 'UTC'`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Back to a naive column holding the UTC wall clock, matching what was
    // there before.
    for (const [table, column] of COLUMNS) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE timestamp USING "${column}" AT TIME ZONE 'UTC'`,
      );
    }
  }
}
