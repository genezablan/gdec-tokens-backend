import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1782267000000 implements MigrationInterface {
    name = 'Migration1782267000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // A comment may carry a GIF (posted from the composer) alongside or instead of text.
        await queryRunner.query(`ALTER TABLE "comments" ADD COLUMN "gifUrl" varchar`);
        // Text is no longer mandatory at the DB level (a comment can be GIF-only).
        await queryRunner.query(`ALTER TABLE "comments" ALTER COLUMN "text" DROP NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`UPDATE "comments" SET "text" = '' WHERE "text" IS NULL`);
        await queryRunner.query(`ALTER TABLE "comments" ALTER COLUMN "text" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "comments" DROP COLUMN "gifUrl"`);
    }
}
