import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1785300000000 implements MigrationInterface {
  name = 'Migration1785300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "development_options" ADD "requiresHrApproval" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "token_requests" ADD "slaRemindedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "token_requests" ADD "slaEscalatedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "token_requests" DROP COLUMN "slaEscalatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "token_requests" DROP COLUMN "slaRemindedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "development_options" DROP COLUMN "requiresHrApproval"`,
    );
  }
}
