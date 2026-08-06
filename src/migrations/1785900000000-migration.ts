import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Emoji reactions on announcements.
 *
 * Keyed on (announcementId, userId, emoji) so a user can react with several
 * different emoji but never the same one twice — the key enforces it, so the
 * toggle is a plain insert-or-delete with no read-modify-write in between.
 *
 * The emoji itself is the value rather than a foreign key to a lookup table: the
 * set is small, fixed in the frontend, and changing it shouldn't need a
 * migration. Stored as varchar(16) because a single emoji can be several code
 * points once modifiers and ZWJ sequences are involved.
 */
export class Migration1785900000000 implements MigrationInterface {
  name = 'Migration1785900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "announcement_reactions" (
        "announcementId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "emoji" character varying(16) NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_announcement_reactions" PRIMARY KEY ("announcementId", "userId", "emoji"),
        CONSTRAINT "FK_announcement_reactions_announcement" FOREIGN KEY ("announcementId")
          REFERENCES "announcements"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_announcement_reactions_user" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    // Counting reactions per announcement is the read path; the composite PK
    // leads with announcementId but this keeps the grouped count index-only.
    await queryRunner.query(
      `CREATE INDEX "IDX_announcement_reactions_announcement" ON "announcement_reactions" ("announcementId", "emoji")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_announcement_reactions_announcement"`,
    );
    await queryRunner.query(`DROP TABLE "announcement_reactions"`);
  }
}
