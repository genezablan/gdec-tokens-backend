import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1771392197068 implements MigrationInterface {
    name = 'Migration1771392197068'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "token_balances" ADD "boostTokens" integer NOT NULL DEFAULT '0'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "token_balances" DROP COLUMN "boostTokens"`);
    }

}
