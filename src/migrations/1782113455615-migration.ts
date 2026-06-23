import { MigrationInterface, QueryRunner } from "typeorm";

/** Creates the announcements table (official Admin/HR broadcasts). */
export class Migration1782113455615 implements MigrationInterface {
    name = 'Migration1782113455615'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "announcements" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "authorId" uuid, "title" character varying(200) NOT NULL, "body" text, "bodyHtml" text, "pinned" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_announcements" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_announcements_createdAt" ON "announcements" ("createdAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_announcements_pinned_createdAt" ON "announcements" ("pinned", "createdAt") `);
        await queryRunner.query(`ALTER TABLE "announcements" ADD CONSTRAINT "FK_announcements_author" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "announcements" DROP CONSTRAINT "FK_announcements_author"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_announcements_pinned_createdAt"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_announcements_createdAt"`);
        await queryRunner.query(`DROP TABLE "announcements"`);
    }
}
