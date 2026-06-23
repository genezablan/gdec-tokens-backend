import { MigrationInterface, QueryRunner } from "typeorm";

/** Adds image attachments to announcements. */
export class Migration1782118093105 implements MigrationInterface {
    name = 'Migration1782118093105'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "announcements" ADD "attachments" jsonb NOT NULL DEFAULT '[]'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "announcements" DROP COLUMN "attachments"`);
    }
}
