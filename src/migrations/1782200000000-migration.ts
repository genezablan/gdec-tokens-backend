import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1782200000000 implements MigrationInterface {
  name = 'Migration1782200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "calendar_connections" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "provider" character varying(20) NOT NULL DEFAULT 'microsoft', "accountEmail" character varying(255), "accessTokenEnc" text, "refreshTokenEnc" text, "expiresAt" TIMESTAMP WITH TIME ZONE, "scopes" text, "connectedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_calendar_connections_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_calendar_connections_userId" ON "calendar_connections" ("userId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_connections" ADD CONSTRAINT "FK_calendar_connections_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "calendar_connections" DROP CONSTRAINT "FK_calendar_connections_userId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_calendar_connections_userId"`,
    );
    await queryRunner.query(`DROP TABLE "calendar_connections"`);
  }
}
