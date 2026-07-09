import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1782270000000 implements MigrationInterface {
    name = 'Migration1782270000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_coaching_sessions_coach_scheduled_active" ON "coaching_sessions" ("coachId", "scheduledAt") WHERE status NOT IN ('cancelled', 'declined', 'no_show')`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_coaching_sessions_coach_scheduled_active"`);
    }

}
