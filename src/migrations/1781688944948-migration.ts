import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1781688944948 implements MigrationInterface {
    name = 'Migration1781688944948'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "comment_mentions" ("commentId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_comment_mentions" PRIMARY KEY ("commentId", "userId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_comment_mentions_userId" ON "comment_mentions" ("userId") `);
        await queryRunner.query(`ALTER TABLE "comment_mentions" ADD CONSTRAINT "FK_comment_mentions_comment" FOREIGN KEY ("commentId") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "comment_mentions" ADD CONSTRAINT "FK_comment_mentions_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "comment_mentions" DROP CONSTRAINT "FK_comment_mentions_user"`);
        await queryRunner.query(`ALTER TABLE "comment_mentions" DROP CONSTRAINT "FK_comment_mentions_comment"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_comment_mentions_userId"`);
        await queryRunner.query(`DROP TABLE "comment_mentions"`);
    }
}
