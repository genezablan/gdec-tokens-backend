import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drop `community_invitations`.
 *
 * The feature shipped as invite-and-accept, then moved to direct-add to match
 * how Viva Engage works: everyone here is already an employee, so there is
 * nothing to consent to that leaving (one click) does not already cover, and an
 * accept step only creates somewhere for invitations to sit unanswered.
 *
 * Adding is now a straight insert into `community_members`, so this table has
 * no readers. It only ever existed on staging, and any rows in it were pending
 * invitations that are now moot.
 */
export class Migration1786300000000 implements MigrationInterface {
  name = 'Migration1786300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "community_invitations"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
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
    await queryRunner.query(
      `CREATE INDEX "IDX_community_invitations_user" ON "community_invitations" ("userId")`,
    );
  }
}
