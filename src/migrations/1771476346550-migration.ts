import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1771476346550 implements MigrationInterface {
    name = 'Migration1771476346550'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "coach_availability" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "coachId" uuid NOT NULL, "availableDate" date NOT NULL, "startTime" TIME NOT NULL, "endTime" TIME NOT NULL, "isBooked" boolean NOT NULL DEFAULT false, "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_724bd023435030c9e57ddb7b766" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."coaching_sessions_status_enum" AS ENUM('scheduled', 'completed', 'no_show', 'cancelled')`);
        await queryRunner.query(`CREATE TABLE "coaching_sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tokenRequestId" uuid NOT NULL, "coachId" uuid NOT NULL, "employeeId" uuid NOT NULL, "availabilityId" uuid, "sessionNumber" integer NOT NULL, "scheduledAt" TIMESTAMP WITH TIME ZONE NOT NULL, "status" "public"."coaching_sessions_status_enum" NOT NULL DEFAULT 'scheduled', "completedAt" TIMESTAMP WITH TIME ZONE, "sessionNotes" text, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_07f10cfa70c0d8ae79f65b94cd8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "coach_availability" ADD CONSTRAINT "FK_29b6ba44e9df48b3aa9d872deca" FOREIGN KEY ("coachId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "coaching_sessions" ADD CONSTRAINT "FK_8bc02b05b9d1cade717767c9dc9" FOREIGN KEY ("tokenRequestId") REFERENCES "token_requests"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "coaching_sessions" ADD CONSTRAINT "FK_686477ddbbef727794b59a8dffb" FOREIGN KEY ("coachId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "coaching_sessions" ADD CONSTRAINT "FK_c97bc9a8b5512525e1bbd891234" FOREIGN KEY ("employeeId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "coaching_sessions" ADD CONSTRAINT "FK_1cd9a13727a7dbe798e50f71905" FOREIGN KEY ("availabilityId") REFERENCES "coach_availability"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "coaching_sessions" DROP CONSTRAINT "FK_1cd9a13727a7dbe798e50f71905"`);
        await queryRunner.query(`ALTER TABLE "coaching_sessions" DROP CONSTRAINT "FK_c97bc9a8b5512525e1bbd891234"`);
        await queryRunner.query(`ALTER TABLE "coaching_sessions" DROP CONSTRAINT "FK_686477ddbbef727794b59a8dffb"`);
        await queryRunner.query(`ALTER TABLE "coaching_sessions" DROP CONSTRAINT "FK_8bc02b05b9d1cade717767c9dc9"`);
        await queryRunner.query(`ALTER TABLE "coach_availability" DROP CONSTRAINT "FK_29b6ba44e9df48b3aa9d872deca"`);
        await queryRunner.query(`DROP TABLE "coaching_sessions"`);
        await queryRunner.query(`DROP TYPE "public"."coaching_sessions_status_enum"`);
        await queryRunner.query(`DROP TABLE "coach_availability"`);
    }

}
