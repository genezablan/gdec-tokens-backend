import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1771825583421 implements MigrationInterface {
    name = 'Migration1771825583421'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "isPendingApproval" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "isPendingApproval"`);
    }

}
