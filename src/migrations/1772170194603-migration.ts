import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1772170194603 implements MigrationInterface {
    name = 'Migration1772170194603'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "profilePicture" character varying(500)`);
        await queryRunner.query(`ALTER TABLE "users" ADD "nickname" character varying(50)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "nickname"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "profilePicture"`);
    }

}
