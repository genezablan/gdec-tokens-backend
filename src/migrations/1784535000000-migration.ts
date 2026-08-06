import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mutual-consent cancellation for coaching sessions: either party can request
 * to cancel a SCHEDULED session, but it only actually cancels once the other
 * party approves. Adds the PENDING_CANCELLATION status plus the bookkeeping
 * columns needed to track and (if declined) revert the request.
 */
export class Migration1784535000000 implements MigrationInterface {
  name = 'Migration1784535000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // This partial index's WHERE predicate binds `status` literals to the
    // enum type at creation time — it must be dropped before ALTER COLUMN
    // TYPE (which swaps in a new type) and recreated after, or Postgres
    // can't reconcile the old-typed predicate against the new column type.
    await queryRunner.query(`DROP INDEX "IDX_coaching_sessions_coach_scheduled_active"`);

    await queryRunner.query(`ALTER TYPE "public"."coaching_sessions_status_enum" RENAME TO "coaching_sessions_status_enum_old"`);
    await queryRunner.query(`CREATE TYPE "public"."coaching_sessions_status_enum" AS ENUM('pending_coach_approval', 'scheduled', 'pending_cancellation', 'completed', 'no_show', 'cancelled', 'declined')`);
    await queryRunner.query(`ALTER TABLE "coaching_sessions" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE "coaching_sessions" ALTER COLUMN "status" TYPE "public"."coaching_sessions_status_enum" USING "status"::"text"::"public"."coaching_sessions_status_enum"`);
    await queryRunner.query(`ALTER TABLE "coaching_sessions" ALTER COLUMN "status" SET DEFAULT 'scheduled'`);
    await queryRunner.query(`DROP TYPE "public"."coaching_sessions_status_enum_old"`);

    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_coaching_sessions_coach_scheduled_active" ON "coaching_sessions" ("coachId", "scheduledAt") WHERE status NOT IN ('cancelled', 'declined', 'no_show')`);

    await queryRunner.query(`ALTER TABLE "coaching_sessions" ADD "cancelRequestedById" uuid`);
    await queryRunner.query(`ALTER TABLE "coaching_sessions" ADD "cancelReason" text`);
    await queryRunner.query(`ALTER TABLE "coaching_sessions" ADD "statusBeforeCancellation" "public"."coaching_sessions_status_enum"`);
    await queryRunner.query(`ALTER TABLE "coaching_sessions" ADD CONSTRAINT "FK_coaching_sessions_cancelRequestedById" FOREIGN KEY ("cancelRequestedById") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "coaching_sessions" DROP CONSTRAINT "FK_coaching_sessions_cancelRequestedById"`);
    await queryRunner.query(`ALTER TABLE "coaching_sessions" DROP COLUMN "statusBeforeCancellation"`);
    await queryRunner.query(`ALTER TABLE "coaching_sessions" DROP COLUMN "cancelReason"`);
    await queryRunner.query(`ALTER TABLE "coaching_sessions" DROP COLUMN "cancelRequestedById"`);

    // Any rows currently PENDING_CANCELLATION must revert before the value is dropped.
    await queryRunner.query(`UPDATE "coaching_sessions" SET "status" = 'scheduled' WHERE "status" = 'pending_cancellation'`);

    await queryRunner.query(`DROP INDEX "IDX_coaching_sessions_coach_scheduled_active"`);

    await queryRunner.query(`ALTER TYPE "public"."coaching_sessions_status_enum" RENAME TO "coaching_sessions_status_enum_old"`);
    await queryRunner.query(`CREATE TYPE "public"."coaching_sessions_status_enum" AS ENUM('pending_coach_approval', 'scheduled', 'completed', 'no_show', 'cancelled', 'declined')`);
    await queryRunner.query(`ALTER TABLE "coaching_sessions" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE "coaching_sessions" ALTER COLUMN "status" TYPE "public"."coaching_sessions_status_enum" USING "status"::"text"::"public"."coaching_sessions_status_enum"`);
    await queryRunner.query(`ALTER TABLE "coaching_sessions" ALTER COLUMN "status" SET DEFAULT 'scheduled'`);
    await queryRunner.query(`DROP TYPE "public"."coaching_sessions_status_enum_old"`);

    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_coaching_sessions_coach_scheduled_active" ON "coaching_sessions" ("coachId", "scheduledAt") WHERE status NOT IN ('cancelled', 'declined', 'no_show')`);
  }
}
