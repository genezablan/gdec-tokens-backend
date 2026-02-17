import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1771298152973 implements MigrationInterface {
    name = 'Migration1771298152973'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."users_employeestatus_enum" RENAME TO "users_employeestatus_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."users_employeestatus_enum" AS ENUM('Regular', 'Probationary', 'Resigned', 'AWOL', 'Terminated')`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "employeeStatus" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "employeeStatus" TYPE "public"."users_employeestatus_enum" USING "employeeStatus"::"text"::"public"."users_employeestatus_enum"`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "employeeStatus" SET DEFAULT 'Regular'`);
        await queryRunner.query(`DROP TYPE "public"."users_employeestatus_enum_old"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."users_employeestatus_enum_old" AS ENUM('Regular', 'Probationary', 'Resigned', 'AWOL')`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "employeeStatus" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "employeeStatus" TYPE "public"."users_employeestatus_enum_old" USING "employeeStatus"::"text"::"public"."users_employeestatus_enum_old"`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "employeeStatus" SET DEFAULT 'Regular'`);
        await queryRunner.query(`DROP TYPE "public"."users_employeestatus_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."users_employeestatus_enum_old" RENAME TO "users_employeestatus_enum"`);
    }

}
