import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1771386015992 implements MigrationInterface {
    name = 'Migration1771386015992'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."development_options_type_enum" AS ENUM('task_offloading', 'coaching', 'learning_subsidy')`);
        await queryRunner.query(`CREATE TABLE "development_options" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "type" "public"."development_options_type_enum" NOT NULL, "name" character varying(100) NOT NULL, "description" text NOT NULL, "tokenCost" integer NOT NULL DEFAULT '1', "isActive" boolean NOT NULL DEFAULT true, "rules" json, "formTemplateUrl" character varying, "formTemplateFileName" character varying, "updatedById" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_ed350292c0e13d5b712bc7c1de1" UNIQUE ("type"), CONSTRAINT "PK_7b1d25001ca8c511d7ce2ca2402" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "development_options" ADD CONSTRAINT "FK_e32e75c83efd9c1231308da1367" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "development_options" DROP CONSTRAINT "FK_e32e75c83efd9c1231308da1367"`);
        await queryRunner.query(`DROP TABLE "development_options"`);
        await queryRunner.query(`DROP TYPE "public"."development_options_type_enum"`);
    }

}
