import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes the community post moderation gate. Every post is public as soon as
 * it's created — there is no more pending/approved/rejected review step.
 */
export class Migration1784515000000 implements MigrationInterface {
  name = 'Migration1784515000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_posts_status_createdAt"`);
    await queryRunner.query(`ALTER TABLE "posts" DROP COLUMN "status"`);
    await queryRunner.query(`DROP TYPE "public"."posts_status_enum"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."posts_status_enum" AS ENUM('pending', 'approved', 'rejected')`);
    await queryRunner.query(`ALTER TABLE "posts" ADD "status" "public"."posts_status_enum" NOT NULL DEFAULT 'pending'`);
    await queryRunner.query(`UPDATE "posts" SET "status" = 'approved'`);
    await queryRunner.query(`CREATE INDEX "IDX_posts_status_createdAt" ON "posts" ("status", "createdAt") `);
  }
}
