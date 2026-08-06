import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Only Learning Subsidy routes to HR for final approval. Task Offloading and
 * Internal Coaching finalize at first-level (manager / coach) approval.
 *
 * `requiresHrApproval` shipped defaulting to `true` for every option, and
 * DevelopmentOptionsService.seed() only merges `rules` into rows that already
 * exist — so deployed environments keep the wrong value unless it's set here.
 *
 * Admins can still change this per option in the UI afterwards; this migration
 * establishes the correct baseline, it doesn't lock the flag.
 */
export class Migration1785700000000 implements MigrationInterface {
  name = 'Migration1785700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "development_options" SET "requiresHrApproval" = false WHERE "type" IN ('task_offloading', 'coaching')`,
    );
    await queryRunner.query(
      `UPDATE "development_options" SET "requiresHrApproval" = true WHERE "type" = 'learning_subsidy'`,
    );

    // Requests already parked in `manager_approved` for the two types that no
    // longer route to HR are deliberately left alone. They stay visible in the HR
    // queue (which selects on status) so HR can clear the backlog by hand.
    // Auto-finalizing them here would deduct tokens with no approver behind it
    // and no audit trail.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore the original column default for every option.
    await queryRunner.query(
      `UPDATE "development_options" SET "requiresHrApproval" = true`,
    );
  }
}
