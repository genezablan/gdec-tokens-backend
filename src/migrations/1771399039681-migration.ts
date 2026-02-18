import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1771399039681 implements MigrationInterface {
    name = 'Migration1771399039681'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."token_requests_type_enum" AS ENUM('task_offloading', 'coaching', 'learning_subsidy')`);
        await queryRunner.query(`CREATE TYPE "public"."token_requests_status_enum" AS ENUM('pending', 'manager_approved', 'approved', 'rejected', 'cancelled')`);
        await queryRunner.query(`CREATE TABLE "token_requests" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "employeeId" uuid NOT NULL, "developmentOptionId" uuid NOT NULL, "type" "public"."token_requests_type_enum" NOT NULL, "tokenCost" integer NOT NULL, "year" integer NOT NULL, "status" "public"."token_requests_status_enum" NOT NULL DEFAULT 'pending', "managerId" uuid, "managerApprovedAt" TIMESTAMP WITH TIME ZONE, "hrId" uuid, "hrApprovedAt" TIMESTAMP WITH TIME ZONE, "rejectedById" uuid, "rejectedByLevel" character varying(20), "rejectionComment" text, "rejectedAt" TIMESTAMP WITH TIME ZONE, "cancelledAt" TIMESTAMP WITH TIME ZONE, "formData" jsonb, "attachmentUrl" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_11b9e55b38a6164b224c5b6b166" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "token_requests" ADD CONSTRAINT "FK_fb1ebe87b5462b79df97d6c60c6" FOREIGN KEY ("employeeId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "token_requests" ADD CONSTRAINT "FK_6fafb1d74a90a0b8e0ee241e71d" FOREIGN KEY ("developmentOptionId") REFERENCES "development_options"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "token_requests" ADD CONSTRAINT "FK_f2d5af89021d2213c767a261904" FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "token_requests" ADD CONSTRAINT "FK_a03e985ed36970d92f32323a58a" FOREIGN KEY ("hrId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "token_requests" ADD CONSTRAINT "FK_d89c482d9b03997d00fe6febc40" FOREIGN KEY ("rejectedById") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "token_requests" DROP CONSTRAINT "FK_d89c482d9b03997d00fe6febc40"`);
        await queryRunner.query(`ALTER TABLE "token_requests" DROP CONSTRAINT "FK_a03e985ed36970d92f32323a58a"`);
        await queryRunner.query(`ALTER TABLE "token_requests" DROP CONSTRAINT "FK_f2d5af89021d2213c767a261904"`);
        await queryRunner.query(`ALTER TABLE "token_requests" DROP CONSTRAINT "FK_6fafb1d74a90a0b8e0ee241e71d"`);
        await queryRunner.query(`ALTER TABLE "token_requests" DROP CONSTRAINT "FK_fb1ebe87b5462b79df97d6c60c6"`);
        await queryRunner.query(`DROP TABLE "token_requests"`);
        await queryRunner.query(`DROP TYPE "public"."token_requests_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."token_requests_type_enum"`);
    }

}
