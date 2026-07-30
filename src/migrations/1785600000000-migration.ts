import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Approval undo: records the last approve/reject decision on a request so the
 * approver who made it (or an admin) can reverse it within
 * APPROVAL_UNDO_WINDOW_MS.
 *
 * `previousStatus` is not redundant with `lastDecisionType` — an HR rejection is
 * legal from both `pending` and `manager_approved`, so the status to restore
 * cannot be inferred from the decision type alone and must be captured.
 *
 * These columns live on the request (rather than in a separate decisions table)
 * so every list endpoint carries undo state without an extra query or join.
 */
export class Migration1785600000000 implements MigrationInterface {
  name = 'Migration1785600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "token_requests" ADD "lastDecisionAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "token_requests" ADD "lastDecisionById" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "token_requests" ADD "lastDecisionType" character varying(30)`,
    );
    await queryRunner.query(
      `ALTER TABLE "token_requests" ADD "previousStatus" "public"."token_requests_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "token_requests" ADD "lastDecisionUndoneAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "token_requests" ADD CONSTRAINT "FK_token_requests_lastDecisionById" FOREIGN KEY ("lastDecisionById") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "token_requests" DROP CONSTRAINT "FK_token_requests_lastDecisionById"`,
    );
    await queryRunner.query(
      `ALTER TABLE "token_requests" DROP COLUMN "lastDecisionUndoneAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "token_requests" DROP COLUMN "previousStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "token_requests" DROP COLUMN "lastDecisionType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "token_requests" DROP COLUMN "lastDecisionById"`,
    );
    await queryRunner.query(
      `ALTER TABLE "token_requests" DROP COLUMN "lastDecisionAt"`,
    );
  }
}
