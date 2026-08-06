import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1782265500000 implements MigrationInterface {
    name = 'Migration1782265500000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "comment_likes" ("commentId" uuid NOT NULL, "userId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_comment_likes" PRIMARY KEY ("commentId", "userId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_comment_likes_userId" ON "comment_likes" ("userId") `);
        await queryRunner.query(`ALTER TABLE "comment_likes" ADD CONSTRAINT "FK_comment_likes_comment" FOREIGN KEY ("commentId") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "comment_likes" ADD CONSTRAINT "FK_comment_likes_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "comment_likes" DROP CONSTRAINT "FK_comment_likes_user"`);
        await queryRunner.query(`ALTER TABLE "comment_likes" DROP CONSTRAINT "FK_comment_likes_comment"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_comment_likes_userId"`);
        await queryRunner.query(`DROP TABLE "comment_likes"`);
    }
}
