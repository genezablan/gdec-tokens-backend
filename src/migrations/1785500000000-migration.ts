import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Coach counter-proposal: the coach can propose a (new) time for a session —
 * from a pending booking, a scheduled session, or a pending cancellation —
 * and the employee approves, rejects, or asks for another date. Adds the
 * PENDING_EMPLOYEE_APPROVAL status plus the columns that carry the proposal.
 */
export class Migration1785500000000 implements MigrationInterface {
  name = 'Migration1785500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // This partial index's WHERE predicate binds `status` literals to the
    // enum type at creation time — it must be dropped before ALTER COLUMN
    // TYPE (which swaps in a new type) and recreated after, or Postgres
    // can't reconcile the old-typed predicate against the new column type.
    await queryRunner.query(`DROP INDEX "IDX_coaching_sessions_coach_scheduled_active"`);

    await queryRunner.query(`ALTER TYPE "public"."coaching_sessions_status_enum" RENAME TO "coaching_sessions_status_enum_old"`);
    await queryRunner.query(`CREATE TYPE "public"."coaching_sessions_status_enum" AS ENUM('pending_coach_approval', 'scheduled', 'pending_cancellation', 'pending_employee_approval', 'completed', 'no_show', 'cancelled', 'declined')`);
    await queryRunner.query(`ALTER TABLE "coaching_sessions" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE "coaching_sessions" ALTER COLUMN "status" TYPE "public"."coaching_sessions_status_enum" USING "status"::"text"::"public"."coaching_sessions_status_enum"`);
    await queryRunner.query(`ALTER TABLE "coaching_sessions" ALTER COLUMN "status" SET DEFAULT 'scheduled'`);
    // statusBeforeCancellation shares the enum type and must move with it.
    await queryRunner.query(`ALTER TABLE "coaching_sessions" ALTER COLUMN "statusBeforeCancellation" TYPE "public"."coaching_sessions_status_enum" USING "statusBeforeCancellation"::"text"::"public"."coaching_sessions_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."coaching_sessions_status_enum_old"`);

    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_coaching_sessions_coach_scheduled_active" ON "coaching_sessions" ("coachId", "scheduledAt") WHERE status NOT IN ('cancelled', 'declined', 'no_show')`);

    await queryRunner.query(`ALTER TABLE "coaching_sessions" ADD "proposedDate" date`);
    await queryRunner.query(`ALTER TABLE "coaching_sessions" ADD "proposedStartTime" TIME`);
    await queryRunner.query(`ALTER TABLE "coaching_sessions" ADD "proposedEndTime" TIME`);
    await queryRunner.query(`ALTER TABLE "coaching_sessions" ADD "proposalNote" text`);
    await queryRunner.query(`ALTER TABLE "coaching_sessions" ADD "employeeProposalNote" text`);
    await queryRunner.query(`ALTER TABLE "coaching_sessions" ADD "proposalReturnedAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "coaching_sessions" ADD "statusBeforeProposal" "public"."coaching_sessions_status_enum"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Any rows currently PENDING_EMPLOYEE_APPROVAL must revert before the value is dropped.
    await queryRunner.query(`UPDATE "coaching_sessions" SET "status" = COALESCE("statusBeforeProposal", 'scheduled') WHERE "status" = 'pending_employee_approval'`);

    await queryRunner.query(`ALTER TABLE "coaching_sessions" DROP COLUMN "statusBeforeProposal"`);
    await queryRunner.query(`ALTER TABLE "coaching_sessions" DROP COLUMN "proposalReturnedAt"`);
    await queryRunner.query(`ALTER TABLE "coaching_sessions" DROP COLUMN "employeeProposalNote"`);
    await queryRunner.query(`ALTER TABLE "coaching_sessions" DROP COLUMN "proposalNote"`);
    await queryRunner.query(`ALTER TABLE "coaching_sessions" DROP COLUMN "proposedEndTime"`);
    await queryRunner.query(`ALTER TABLE "coaching_sessions" DROP COLUMN "proposedStartTime"`);
    await queryRunner.query(`ALTER TABLE "coaching_sessions" DROP COLUMN "proposedDate"`);

    await queryRunner.query(`DROP INDEX "IDX_coaching_sessions_coach_scheduled_active"`);

    await queryRunner.query(`ALTER TYPE "public"."coaching_sessions_status_enum" RENAME TO "coaching_sessions_status_enum_old"`);
    await queryRunner.query(`CREATE TYPE "public"."coaching_sessions_status_enum" AS ENUM('pending_coach_approval', 'scheduled', 'pending_cancellation', 'completed', 'no_show', 'cancelled', 'declined')`);
    await queryRunner.query(`ALTER TABLE "coaching_sessions" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE "coaching_sessions" ALTER COLUMN "status" TYPE "public"."coaching_sessions_status_enum" USING "status"::"text"::"public"."coaching_sessions_status_enum"`);
    await queryRunner.query(`ALTER TABLE "coaching_sessions" ALTER COLUMN "status" SET DEFAULT 'scheduled'`);
    await queryRunner.query(`ALTER TABLE "coaching_sessions" ALTER COLUMN "statusBeforeCancellation" TYPE "public"."coaching_sessions_status_enum" USING "statusBeforeCancellation"::"text"::"public"."coaching_sessions_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."coaching_sessions_status_enum_old"`);

    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_coaching_sessions_coach_scheduled_active" ON "coaching_sessions" ("coachId", "scheduledAt") WHERE status NOT IN ('cancelled', 'declined', 'no_show')`);
  }
}
