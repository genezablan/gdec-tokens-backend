import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1781759560582 implements MigrationInterface {
    name = 'Migration1781759560582'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "lastLoginAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`CREATE TABLE "login_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_login_events" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_login_events_createdAt" ON "login_events" ("createdAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_login_events_userId_createdAt" ON "login_events" ("userId", "createdAt") `);
        await queryRunner.query(`ALTER TABLE "login_events" ADD CONSTRAINT "FK_login_events_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "login_events" DROP CONSTRAINT "FK_login_events_user"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_login_events_userId_createdAt"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_login_events_createdAt"`);
        await queryRunner.query(`DROP TABLE "login_events"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "lastLoginAt"`);
    }
}
