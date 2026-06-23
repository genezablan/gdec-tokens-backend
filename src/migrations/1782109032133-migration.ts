import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds post moderation status. New posts default to 'pending'; all posts that
 * already exist are backfilled to 'approved' so the live feed is unaffected.
 */
export class Migration1782109032133 implements MigrationInterface {
    name = 'Migration1782109032133'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."posts_status_enum" AS ENUM('pending', 'approved', 'rejected')`);
        await queryRunner.query(`ALTER TABLE "posts" ADD "status" "public"."posts_status_enum" NOT NULL DEFAULT 'pending'`);
        // Existing posts are already live — keep them visible.
        await queryRunner.query(`UPDATE "posts" SET "status" = 'approved'`);
        await queryRunner.query(`CREATE INDEX "IDX_posts_status_createdAt" ON "posts" ("status", "createdAt") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_posts_status_createdAt"`);
        await queryRunner.query(`ALTER TABLE "posts" DROP COLUMN "status"`);
        await queryRunner.query(`DROP TYPE "public"."posts_status_enum"`);
    }
}
