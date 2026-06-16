import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1780466147005 implements MigrationInterface {
  name = 'Migration1780466147005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "tutorials" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying(200) NOT NULL, "category" character varying(100) NOT NULL, "description" text, "videoKey" character varying NOT NULL, "thumbnailKey" character varying, "durationSeconds" integer, "displayOrder" integer NOT NULL DEFAULT '0', "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_e9152ab79d78c6a5e4c7bd47f61" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "tutorials"`);
  }
}
