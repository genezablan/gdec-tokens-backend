import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Announcement categories, acknowledgements and per-user read state.
 *
 * Adds the three things the announcements board needs to answer "what still
 * needs my attention": a category to group by, a flag marking an announcement as
 * requiring explicit acknowledgement, and two join tables recording who has read
 * and who has acknowledged each one.
 *
 * Both join tables use a composite primary key rather than a surrogate id — a
 * user reads or acknowledges a given announcement at most once, so the key *is*
 * the identity and `ON CONFLICT DO NOTHING` makes both operations idempotent
 * without a prior SELECT. Rows are cascade-deleted with their announcement or
 * user, since neither is meaningful on its own.
 */
export class Migration1785800000000 implements MigrationInterface {
  name = 'Migration1785800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "announcements" ADD "category" character varying(20)`,
    );
    await queryRunner.query(
      `ALTER TABLE "announcements" ADD "requiresAcknowledgement" boolean NOT NULL DEFAULT false`,
    );

    await queryRunner.query(`
      CREATE TABLE "announcement_reads" (
        "announcementId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "readAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_announcement_reads" PRIMARY KEY ("announcementId", "userId"),
        CONSTRAINT "FK_announcement_reads_announcement" FOREIGN KEY ("announcementId")
          REFERENCES "announcements"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_announcement_reads_user" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    // The hot query is "everything this user has read", so index the user side;
    // the composite PK already covers lookups that lead with announcementId.
    await queryRunner.query(
      `CREATE INDEX "IDX_announcement_reads_user" ON "announcement_reads" ("userId")`,
    );

    await queryRunner.query(`
      CREATE TABLE "announcement_acknowledgements" (
        "announcementId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "acknowledgedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_announcement_acks" PRIMARY KEY ("announcementId", "userId"),
        CONSTRAINT "FK_announcement_acks_announcement" FOREIGN KEY ("announcementId")
          REFERENCES "announcements"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_announcement_acks_user" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_announcement_acks_user" ON "announcement_acknowledgements" ("userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_announcement_acks_user"`);
    await queryRunner.query(`DROP TABLE "announcement_acknowledgements"`);
    await queryRunner.query(`DROP INDEX "IDX_announcement_reads_user"`);
    await queryRunner.query(`DROP TABLE "announcement_reads"`);
    await queryRunner.query(
      `ALTER TABLE "announcements" DROP COLUMN "requiresAcknowledgement"`,
    );
    await queryRunner.query(
      `ALTER TABLE "announcements" DROP COLUMN "category"`,
    );
  }
}
