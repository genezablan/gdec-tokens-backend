import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1782268000000 implements MigrationInterface {
    name = 'Migration1782268000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Follow graph powering profile follower/following counts + the Follow button.
        await queryRunner.query(`CREATE TABLE "user_follows" ("followerId" uuid NOT NULL, "followingId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_user_follows" PRIMARY KEY ("followerId", "followingId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_user_follows_followingId" ON "user_follows" ("followingId") `);
        await queryRunner.query(`ALTER TABLE "user_follows" ADD CONSTRAINT "FK_user_follows_follower" FOREIGN KEY ("followerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_follows" ADD CONSTRAINT "FK_user_follows_following" FOREIGN KEY ("followingId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);

        // Community admins can designate members as "experts" (right-rail panel).
        await queryRunner.query(`ALTER TABLE "community_members" ADD COLUMN "expert" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "community_members" DROP COLUMN "expert"`);
        await queryRunner.query(`ALTER TABLE "user_follows" DROP CONSTRAINT "FK_user_follows_following"`);
        await queryRunner.query(`ALTER TABLE "user_follows" DROP CONSTRAINT "FK_user_follows_follower"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_user_follows_followingId"`);
        await queryRunner.query(`DROP TABLE "user_follows"`);
    }
}
