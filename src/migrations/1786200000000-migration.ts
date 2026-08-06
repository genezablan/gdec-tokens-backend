import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Community invitations — a community admin inviting someone in, the mirror of
 * `community_requests` where the person asks to join.
 *
 * Same shape as that table deliberately: the composite key makes a duplicate
 * invitation impossible, and presence of the row is the pending state, so there
 * is no status column that could disagree with `community_members`.
 *
 * `invitedAt` is `timestamptz` — every timestamp column became timezone-aware in
 * Migration1786100000000 and new ones must match, or the same eight-hour drift
 * comes back one column at a time.
 */
export class Migration1786200000000 implements MigrationInterface {
  name = 'Migration1786200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "community_invitations" (
        "communityId" character varying(100) NOT NULL,
        "userId" uuid NOT NULL,
        "invitedById" uuid NOT NULL,
        "invitedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_community_invitations" PRIMARY KEY ("communityId", "userId"),
        CONSTRAINT "FK_community_invitations_community" FOREIGN KEY ("communityId")
          REFERENCES "communities"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_community_invitations_user" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_community_invitations_inviter" FOREIGN KEY ("invitedById")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    // "What am I invited to?" is the invitee's view and runs on every page load.
    await queryRunner.query(
      `CREATE INDEX "IDX_community_invitations_user" ON "community_invitations" ("userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_community_invitations_user"`);
    await queryRunner.query(`DROP TABLE "community_invitations"`);
  }
}
