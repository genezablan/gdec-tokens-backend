import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1780466553876 implements MigrationInterface {
  name = 'Migration1780466553876';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tutorials" ALTER COLUMN "videoKey" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tutorials" ALTER COLUMN "videoKey" SET NOT NULL`,
    );
  }
}
