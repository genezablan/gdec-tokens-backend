import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1771296898190 implements MigrationInterface {
    name = 'Migration1771296898190'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."users_authprovider_enum" AS ENUM('local', 'microsoft', 'google')`);
        await queryRunner.query(`CREATE TYPE "public"."users_gender_enum" AS ENUM('Male', 'Female')`);
        await queryRunner.query(`CREATE TYPE "public"."users_employeetype_enum" AS ENUM('Manager', 'Rank and file', 'Officer')`);
        await queryRunner.query(`CREATE TYPE "public"."users_employeestatus_enum" AS ENUM('Regular', 'Probationary')`);
        await queryRunner.query(`CREATE TYPE "public"."users_roles_enum" AS ENUM('employee', 'coach', 'approver', 'admin')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "employeeId" character varying(20) NOT NULL, "email" character varying(100) NOT NULL, "password" character varying, "authProvider" "public"."users_authprovider_enum" NOT NULL DEFAULT 'local', "providerId" character varying, "firstName" character varying(50) NOT NULL, "middleName" character varying(50), "lastName" character varying(50) NOT NULL, "gender" "public"."users_gender_enum" NOT NULL, "department" character varying(100) NOT NULL, "location" character varying(50) NOT NULL, "position" character varying(100) NOT NULL, "employeeType" "public"."users_employeetype_enum" NOT NULL, "employeeStatus" "public"."users_employeestatus_enum" NOT NULL DEFAULT 'Regular', "immediateSupervisorId" uuid, "contact" character varying(50), "separationDate" date, "roles" "public"."users_roles_enum" array NOT NULL DEFAULT '{employee}', "isActive" boolean NOT NULL DEFAULT true, "isPasswordChanged" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_a7191f881489123fab6c8e52738" UNIQUE ("employeeId"), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "FK_efc2de713fc4f8dbeaada1006a7" FOREIGN KEY ("immediateSupervisorId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_efc2de713fc4f8dbeaada1006a7"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "public"."users_roles_enum"`);
        await queryRunner.query(`DROP TYPE "public"."users_employeestatus_enum"`);
        await queryRunner.query(`DROP TYPE "public"."users_employeetype_enum"`);
        await queryRunner.query(`DROP TYPE "public"."users_gender_enum"`);
        await queryRunner.query(`DROP TYPE "public"."users_authprovider_enum"`);
    }

}
