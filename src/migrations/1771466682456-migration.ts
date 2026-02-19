import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1771466682456 implements MigrationInterface {
    name = 'Migration1771466682456'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "token_requests" ADD "snapshotDepartment" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "token_requests" ADD "snapshotPosition" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "token_requests" ADD "snapshotManagerName" character varying(101)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "token_requests" DROP COLUMN "snapshotManagerName"`);
        await queryRunner.query(`ALTER TABLE "token_requests" DROP COLUMN "snapshotPosition"`);
        await queryRunner.query(`ALTER TABLE "token_requests" DROP COLUMN "snapshotDepartment"`);
    }

}
