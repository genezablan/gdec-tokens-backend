import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1771813288649 implements MigrationInterface {
    name = 'Migration1771813288649'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."coaching_sessions_status_enum" RENAME TO "coaching_sessions_status_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."coaching_sessions_status_enum" AS ENUM('pending_coach_approval', 'scheduled', 'completed', 'no_show', 'cancelled', 'declined')`);
        await queryRunner.query(`ALTER TABLE "coaching_sessions" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "coaching_sessions" ALTER COLUMN "status" TYPE "public"."coaching_sessions_status_enum" USING "status"::"text"::"public"."coaching_sessions_status_enum"`);
        await queryRunner.query(`ALTER TABLE "coaching_sessions" ALTER COLUMN "status" SET DEFAULT 'scheduled'`);
        await queryRunner.query(`DROP TYPE "public"."coaching_sessions_status_enum_old"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."coaching_sessions_status_enum_old" AS ENUM('scheduled', 'completed', 'no_show', 'cancelled')`);
        await queryRunner.query(`ALTER TABLE "coaching_sessions" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "coaching_sessions" ALTER COLUMN "status" TYPE "public"."coaching_sessions_status_enum_old" USING "status"::"text"::"public"."coaching_sessions_status_enum_old"`);
        await queryRunner.query(`ALTER TABLE "coaching_sessions" ALTER COLUMN "status" SET DEFAULT 'scheduled'`);
        await queryRunner.query(`DROP TYPE "public"."coaching_sessions_status_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."coaching_sessions_status_enum_old" RENAME TO "coaching_sessions_status_enum"`);
    }

}
