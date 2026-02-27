import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1772161615939 implements MigrationInterface {
    name = 'Migration1772161615939'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "notifications" ADD "metadata" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN "metadata"`);
    }

}
