import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1782269000000 implements MigrationInterface {
    name = 'Migration1782269000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "token_balances" ADD "lastReminderCheckpoint" varchar`);
        await queryRunner.query(`ALTER TABLE "token_balances" ADD "lastReminderSentAt" timestamp`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "token_balances" DROP COLUMN "lastReminderSentAt"`);
        await queryRunner.query(`ALTER TABLE "token_balances" DROP COLUMN "lastReminderCheckpoint"`);
    }

}
