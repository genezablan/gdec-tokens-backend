import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1771393060937 implements MigrationInterface {
    name = 'Migration1771393060937'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "development_options" ADD "formTemplateKey" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "development_options" DROP COLUMN "formTemplateKey"`);
    }

}
