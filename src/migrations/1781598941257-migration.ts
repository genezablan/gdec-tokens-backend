import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1781598941257 implements MigrationInterface {
    name = 'Migration1781598941257'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."community_resources_type_enum" AS ENUM('sharepoint', 'onenote', 'planner', 'link')`);
        await queryRunner.query(`CREATE TABLE "community_resources" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "communityId" character varying(100) NOT NULL, "type" "public"."community_resources_type_enum" NOT NULL, "label" character varying(150) NOT NULL, "url" character varying(1000) NOT NULL, "sortOrder" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_3609bceca0b4652a56638c9842d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_6db5e7611ea6884b8f775eba1a" ON "community_resources" ("communityId") `);
        await queryRunner.query(`CREATE TYPE "public"."communities_privacy_enum" AS ENUM('public', 'private')`);
        await queryRunner.query(`CREATE TABLE "communities" ("id" character varying(100) NOT NULL, "name" character varying(150) NOT NULL, "slug" character varying(100), "description" text, "about" text, "avatarUrl" character varying(500), "coverUrl" character varying(500), "privacy" "public"."communities_privacy_enum" NOT NULL DEFAULT 'public', "topics" text array NOT NULL DEFAULT '{}', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_42d5225a80ac87aa1254dfe282c" UNIQUE ("slug"), CONSTRAINT "PK_fea1fe83c86ccde9d0a089e7ea2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."post_attachments_type_enum" AS ENUM('image', 'file')`);
        await queryRunner.query(`CREATE TABLE "post_attachments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "postId" uuid NOT NULL, "type" "public"."post_attachments_type_enum" NOT NULL, "url" character varying(1000) NOT NULL, "name" character varying(255), "sortOrder" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_791a1c9044e40ac5c37aab661f2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_c222ae4fc54be438ef6c1a64d5" ON "post_attachments" ("postId") `);
        await queryRunner.query(`CREATE TABLE "poll_options" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "postId" uuid NOT NULL, "label" character varying(80) NOT NULL, "sortOrder" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_f52aac4865d291e3658dedf9083" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_cb0bda42f5cfbcb5e85c2d2872" ON "poll_options" ("postId") `);
        await queryRunner.query(`CREATE TABLE "comments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "postId" uuid NOT NULL, "authorId" uuid NOT NULL, "text" text NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_8bf68bc960f2b69e818bdb90dcb" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_a4367f08021b501ba78f98ae01" ON "comments" ("postId", "createdAt") `);
        await queryRunner.query(`CREATE TYPE "public"."posts_type_enum" AS ENUM('discussion', 'question', 'praise', 'poll')`);
        await queryRunner.query(`CREATE TYPE "public"."posts_badge_enum" AS ENUM('kudos', 'thank-you', 'great-work', 'team-player', 'above-beyond', 'innovator')`);
        await queryRunner.query(`CREATE TABLE "posts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "communityId" character varying(100) NOT NULL, "authorId" uuid NOT NULL, "type" "public"."posts_type_enum" NOT NULL, "title" character varying(200), "body" text, "bodyHtml" text, "badge" "public"."posts_badge_enum", "topics" text array NOT NULL DEFAULT '{}', "pinned" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2829ac61eff60fcec60d7274b9e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_46bc204f43827b6f25e0133dbf" ON "posts" ("createdAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_923c7f509cfcb105d4f601b670" ON "posts" ("communityId", "createdAt") `);
        await queryRunner.query(`CREATE TYPE "public"."reactions_type_enum" AS ENUM('like', 'heart', 'celebrate', 'laugh', 'insightful')`);
        await queryRunner.query(`CREATE TABLE "reactions" ("postId" uuid NOT NULL, "userId" uuid NOT NULL, "type" "public"."reactions_type_enum" NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f275470c11fae3a72b7ce334b36" PRIMARY KEY ("postId", "userId"))`);
        await queryRunner.query(`CREATE TABLE "post_views" ("postId" uuid NOT NULL, "userId" uuid NOT NULL, "viewedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_fd26876697cd9b3ab516837c83f" PRIMARY KEY ("postId", "userId"))`);
        await queryRunner.query(`CREATE TABLE "post_praised" ("postId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_d47212efb9f8f21a759acb51fdb" PRIMARY KEY ("postId", "userId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_4c9d3a5477ecd95f0b959bb83c" ON "post_praised" ("userId") `);
        await queryRunner.query(`CREATE TABLE "post_mentions" ("postId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_d82dd2e2cdafd89ac83756d14b3" PRIMARY KEY ("postId", "userId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_df05aeb7b31151a17c28fe869b" ON "post_mentions" ("userId") `);
        await queryRunner.query(`CREATE TABLE "poll_votes" ("postId" uuid NOT NULL, "userId" uuid NOT NULL, "optionId" uuid NOT NULL, CONSTRAINT "PK_e82459519179b951128e91b3aea" PRIMARY KEY ("postId", "userId"))`);
        await queryRunner.query(`CREATE TABLE "community_requests" ("communityId" character varying(100) NOT NULL, "userId" uuid NOT NULL, "requestedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9870f2c419bd37263ea40a397d2" PRIMARY KEY ("communityId", "userId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_cc92d4ee0cd65d854d9e729df9" ON "community_requests" ("userId") `);
        await queryRunner.query(`CREATE TYPE "public"."community_members_role_enum" AS ENUM('admin', 'member')`);
        await queryRunner.query(`CREATE TABLE "community_members" ("communityId" character varying(100) NOT NULL, "userId" uuid NOT NULL, "role" "public"."community_members_role_enum" NOT NULL DEFAULT 'member', "joinedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_3c7513dc4939c966a2350e50d0b" PRIMARY KEY ("communityId", "userId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_dff8a6a8aabc10e2c61e57a45f" ON "community_members" ("userId") `);
        await queryRunner.query(`ALTER TABLE "community_resources" ADD CONSTRAINT "FK_6db5e7611ea6884b8f775eba1a1" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "post_attachments" ADD CONSTRAINT "FK_c222ae4fc54be438ef6c1a64d51" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "poll_options" ADD CONSTRAINT "FK_cb0bda42f5cfbcb5e85c2d28722" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "comments" ADD CONSTRAINT "FK_e44ddaaa6d058cb4092f83ad61f" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "comments" ADD CONSTRAINT "FK_4548cc4a409b8651ec75f70e280" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "posts" ADD CONSTRAINT "FK_e5f99a0b3edb7e1867f44b2cf4c" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "posts" ADD CONSTRAINT "FK_c5a322ad12a7bf95460c958e80e" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "reactions" ADD CONSTRAINT "FK_d9628397382a90981e26a915bc9" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "reactions" ADD CONSTRAINT "FK_f3e1d278edeb2c19a2ddad83f8e" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "post_views" ADD CONSTRAINT "FK_a05ca4e99f3345db11cfe91ee6e" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "post_views" ADD CONSTRAINT "FK_b7972ee9560985909e554848591" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "post_praised" ADD CONSTRAINT "FK_df5442756279a14d73bba73abd6" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "post_praised" ADD CONSTRAINT "FK_4c9d3a5477ecd95f0b959bb83c2" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "post_mentions" ADD CONSTRAINT "FK_633d695e8529c2edffffd40393c" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "post_mentions" ADD CONSTRAINT "FK_df05aeb7b31151a17c28fe869be" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "poll_votes" ADD CONSTRAINT "FK_5784315415db17cbd896ac780ae" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "poll_votes" ADD CONSTRAINT "FK_f33fc76e575b7a703a67868b1dc" FOREIGN KEY ("optionId") REFERENCES "poll_options"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "poll_votes" ADD CONSTRAINT "FK_0281387f2c63687277cd175c4f4" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "community_requests" ADD CONSTRAINT "FK_f2f30444cecc446cc71153bef47" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "community_requests" ADD CONSTRAINT "FK_cc92d4ee0cd65d854d9e729df99" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "community_members" ADD CONSTRAINT "FK_692f4422c79d6efe4f2cfbe6063" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "community_members" ADD CONSTRAINT "FK_dff8a6a8aabc10e2c61e57a45f2" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "community_members" DROP CONSTRAINT "FK_dff8a6a8aabc10e2c61e57a45f2"`);
        await queryRunner.query(`ALTER TABLE "community_members" DROP CONSTRAINT "FK_692f4422c79d6efe4f2cfbe6063"`);
        await queryRunner.query(`ALTER TABLE "community_requests" DROP CONSTRAINT "FK_cc92d4ee0cd65d854d9e729df99"`);
        await queryRunner.query(`ALTER TABLE "community_requests" DROP CONSTRAINT "FK_f2f30444cecc446cc71153bef47"`);
        await queryRunner.query(`ALTER TABLE "poll_votes" DROP CONSTRAINT "FK_0281387f2c63687277cd175c4f4"`);
        await queryRunner.query(`ALTER TABLE "poll_votes" DROP CONSTRAINT "FK_f33fc76e575b7a703a67868b1dc"`);
        await queryRunner.query(`ALTER TABLE "poll_votes" DROP CONSTRAINT "FK_5784315415db17cbd896ac780ae"`);
        await queryRunner.query(`ALTER TABLE "post_mentions" DROP CONSTRAINT "FK_df05aeb7b31151a17c28fe869be"`);
        await queryRunner.query(`ALTER TABLE "post_mentions" DROP CONSTRAINT "FK_633d695e8529c2edffffd40393c"`);
        await queryRunner.query(`ALTER TABLE "post_praised" DROP CONSTRAINT "FK_4c9d3a5477ecd95f0b959bb83c2"`);
        await queryRunner.query(`ALTER TABLE "post_praised" DROP CONSTRAINT "FK_df5442756279a14d73bba73abd6"`);
        await queryRunner.query(`ALTER TABLE "post_views" DROP CONSTRAINT "FK_b7972ee9560985909e554848591"`);
        await queryRunner.query(`ALTER TABLE "post_views" DROP CONSTRAINT "FK_a05ca4e99f3345db11cfe91ee6e"`);
        await queryRunner.query(`ALTER TABLE "reactions" DROP CONSTRAINT "FK_f3e1d278edeb2c19a2ddad83f8e"`);
        await queryRunner.query(`ALTER TABLE "reactions" DROP CONSTRAINT "FK_d9628397382a90981e26a915bc9"`);
        await queryRunner.query(`ALTER TABLE "posts" DROP CONSTRAINT "FK_c5a322ad12a7bf95460c958e80e"`);
        await queryRunner.query(`ALTER TABLE "posts" DROP CONSTRAINT "FK_e5f99a0b3edb7e1867f44b2cf4c"`);
        await queryRunner.query(`ALTER TABLE "comments" DROP CONSTRAINT "FK_4548cc4a409b8651ec75f70e280"`);
        await queryRunner.query(`ALTER TABLE "comments" DROP CONSTRAINT "FK_e44ddaaa6d058cb4092f83ad61f"`);
        await queryRunner.query(`ALTER TABLE "poll_options" DROP CONSTRAINT "FK_cb0bda42f5cfbcb5e85c2d28722"`);
        await queryRunner.query(`ALTER TABLE "post_attachments" DROP CONSTRAINT "FK_c222ae4fc54be438ef6c1a64d51"`);
        await queryRunner.query(`ALTER TABLE "community_resources" DROP CONSTRAINT "FK_6db5e7611ea6884b8f775eba1a1"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_dff8a6a8aabc10e2c61e57a45f"`);
        await queryRunner.query(`DROP TABLE "community_members"`);
        await queryRunner.query(`DROP TYPE "public"."community_members_role_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cc92d4ee0cd65d854d9e729df9"`);
        await queryRunner.query(`DROP TABLE "community_requests"`);
        await queryRunner.query(`DROP TABLE "poll_votes"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_df05aeb7b31151a17c28fe869b"`);
        await queryRunner.query(`DROP TABLE "post_mentions"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4c9d3a5477ecd95f0b959bb83c"`);
        await queryRunner.query(`DROP TABLE "post_praised"`);
        await queryRunner.query(`DROP TABLE "post_views"`);
        await queryRunner.query(`DROP TABLE "reactions"`);
        await queryRunner.query(`DROP TYPE "public"."reactions_type_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_923c7f509cfcb105d4f601b670"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_46bc204f43827b6f25e0133dbf"`);
        await queryRunner.query(`DROP TABLE "posts"`);
        await queryRunner.query(`DROP TYPE "public"."posts_badge_enum"`);
        await queryRunner.query(`DROP TYPE "public"."posts_type_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a4367f08021b501ba78f98ae01"`);
        await queryRunner.query(`DROP TABLE "comments"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cb0bda42f5cfbcb5e85c2d2872"`);
        await queryRunner.query(`DROP TABLE "poll_options"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c222ae4fc54be438ef6c1a64d5"`);
        await queryRunner.query(`DROP TABLE "post_attachments"`);
        await queryRunner.query(`DROP TYPE "public"."post_attachments_type_enum"`);
        await queryRunner.query(`DROP TABLE "communities"`);
        await queryRunner.query(`DROP TYPE "public"."communities_privacy_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6db5e7611ea6884b8f775eba1a"`);
        await queryRunner.query(`DROP TABLE "community_resources"`);
        await queryRunner.query(`DROP TYPE "public"."community_resources_type_enum"`);
    }

}
