import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1771391621277 implements MigrationInterface {
    name = 'Migration1771391621277'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "token_balances" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "year" integer NOT NULL, "allocated" integer NOT NULL DEFAULT '6', "used" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_aa4d4b12202a078545f46f66062" UNIQUE ("userId", "year"), CONSTRAINT "PK_e12dc361a93cf25efa25d0a4cdc" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "token_balances" ADD CONSTRAINT "FK_a9f4195c452704e9fe3064197aa" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "token_balances" DROP CONSTRAINT "FK_a9f4195c452704e9fe3064197aa"`);
        await queryRunner.query(`DROP TABLE "token_balances"`);
    }

}
