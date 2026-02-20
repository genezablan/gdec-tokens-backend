import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1771571669001 implements MigrationInterface {
    name = 'Migration1771571669001'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "passwordResetToken" character varying(255)`);
        await queryRunner.query(`ALTER TABLE "users" ADD "passwordResetExpiry" TIMESTAMP WITH TIME ZONE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "passwordResetExpiry"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "passwordResetToken"`);
    }

}
