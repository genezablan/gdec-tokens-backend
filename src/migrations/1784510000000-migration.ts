import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1784510000000 implements MigrationInterface {
  name = 'Migration1784510000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "coachingWeeklyHours" jsonb`);

    // Backfill: fan the old single day-array + one start/end window out into
    // one { day, startTime, endTime } entry per previously-selected day.
    await queryRunner.query(`
      UPDATE "users"
      SET "coachingWeeklyHours" = (
        SELECT jsonb_agg(jsonb_build_object('day', d, 'startTime', "coachingStartTime", 'endTime', "coachingEndTime"))
        FROM unnest("coachingDays") AS d
      )
      WHERE "coachingDays" IS NOT NULL
        AND "coachingStartTime" IS NOT NULL
        AND "coachingEndTime" IS NOT NULL
    `);

    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "coachingDays"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "coachingStartTime"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "coachingEndTime"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "coachingDays" integer array`);
    await queryRunner.query(`ALTER TABLE "users" ADD "coachingStartTime" TIME`);
    await queryRunner.query(`ALTER TABLE "users" ADD "coachingEndTime" TIME`);

    // Collapse back to one row: use the first window's start/end as the
    // single window, and every window's day as a selected coaching day.
    await queryRunner.query(`
      UPDATE "users"
      SET "coachingDays" = (SELECT array_agg((w->>'day')::int) FROM jsonb_array_elements("coachingWeeklyHours") AS w),
          "coachingStartTime" = (SELECT (w->>'startTime')::time FROM jsonb_array_elements("coachingWeeklyHours") AS w ORDER BY w->>'day' LIMIT 1),
          "coachingEndTime" = (SELECT (w->>'endTime')::time FROM jsonb_array_elements("coachingWeeklyHours") AS w ORDER BY w->>'day' LIMIT 1)
      WHERE "coachingWeeklyHours" IS NOT NULL
    `);

    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "coachingWeeklyHours"`);
  }
}
