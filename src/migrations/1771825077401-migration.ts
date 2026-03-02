import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1771825077401 implements MigrationInterface {
    name = 'Migration1771825077401'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "gender" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "location" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "position" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "employeeType" SET DEFAULT 'Rank and file'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "employeeType" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "position" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "location" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "gender" SET NOT NULL`);
    }

}
