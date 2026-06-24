import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1782266000000 implements MigrationInterface {
    name = 'Migration1782266000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Post reactions: free-form value (emoji grapheme or "gif:<id>") instead of a fixed enum.
        await queryRunner.query(`ALTER TABLE "reactions" ALTER COLUMN "type" TYPE varchar USING "type"::text`);
        await queryRunner.query(`DROP TYPE "public"."reactions_type_enum"`);

        // Generalize comment "likes" into comment reactions carrying the same value string.
        await queryRunner.query(`ALTER TABLE "comment_likes" ADD COLUMN "value" varchar NOT NULL DEFAULT '👍'`);
        await queryRunner.query(`ALTER TABLE "comment_likes" RENAME CONSTRAINT "PK_comment_likes" TO "PK_comment_reactions"`);
        await queryRunner.query(`ALTER TABLE "comment_likes" RENAME CONSTRAINT "FK_comment_likes_comment" TO "FK_comment_reactions_comment"`);
        await queryRunner.query(`ALTER TABLE "comment_likes" RENAME CONSTRAINT "FK_comment_likes_user" TO "FK_comment_reactions_user"`);
        await queryRunner.query(`ALTER INDEX "public"."IDX_comment_likes_userId" RENAME TO "IDX_comment_reactions_userId"`);
        await queryRunner.query(`ALTER TABLE "comment_likes" RENAME TO "comment_reactions"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "comment_reactions" RENAME TO "comment_likes"`);
        await queryRunner.query(`ALTER INDEX "public"."IDX_comment_reactions_userId" RENAME TO "IDX_comment_likes_userId"`);
        await queryRunner.query(`ALTER TABLE "comment_likes" RENAME CONSTRAINT "FK_comment_reactions_user" TO "FK_comment_likes_user"`);
        await queryRunner.query(`ALTER TABLE "comment_likes" RENAME CONSTRAINT "FK_comment_reactions_comment" TO "FK_comment_likes_comment"`);
        await queryRunner.query(`ALTER TABLE "comment_likes" RENAME CONSTRAINT "PK_comment_reactions" TO "PK_comment_likes"`);
        await queryRunner.query(`ALTER TABLE "comment_likes" DROP COLUMN "value"`);

        // Restore the reaction enum, coercing any non-enum values back to 'like'.
        await queryRunner.query(`CREATE TYPE "public"."reactions_type_enum" AS ENUM('like', 'heart', 'celebrate', 'laugh', 'insightful')`);
        await queryRunner.query(`UPDATE "reactions" SET "type" = 'like' WHERE "type" NOT IN ('like', 'heart', 'celebrate', 'laugh', 'insightful')`);
        await queryRunner.query(`ALTER TABLE "reactions" ALTER COLUMN "type" TYPE "public"."reactions_type_enum" USING "type"::"public"."reactions_type_enum"`);
    }
}
