import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add `job_descriptions` and `course_recommendations`.
 *
 * Job descriptions are keyed on job title, not on the employee: 404 active
 * staff share only 150 distinct positions, so per-employee rows would store the
 * same document 63 times over for Fulfillment Associates alone and pay for 63
 * identical AI runs.
 *
 * Recommendations are generated in batches and cached — a single run takes
 * ~70 seconds of web search, far too slow to do on page load.
 *
 * Hand-written rather than generated: `migration:generate` against the dev
 * database also emits foreign-key churn for coaching_sessions,
 * comment_mentions, comment_reactions, login_events, token_requests and
 * user_follows, which is pre-existing entity/DB drift unrelated to this
 * feature and must not ride along in it.
 */
export class Migration1786400000000 implements MigrationInterface {
  name = 'Migration1786400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "job_descriptions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "position" character varying(100) NOT NULL,
        "content" text NOT NULL,
        "source" character varying(200),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_job_descriptions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_job_descriptions_position" UNIQUE ("position")
      )
    `);

    await queryRunner.query(
      `CREATE TYPE "public"."course_recommendations_provider_enum" AS ENUM('udemy', 'coursera')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."course_recommendations_pricingmodel_enum" AS ENUM('one_time', 'subscription')`,
    );

    await queryRunner.query(`
      CREATE TABLE "course_recommendations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "jobDescriptionId" uuid NOT NULL,
        "provider" "public"."course_recommendations_provider_enum" NOT NULL,
        "title" character varying(300) NOT NULL,
        "url" character varying(500) NOT NULL,
        "level" character varying(60),
        "durationHours" integer,
        "whyItFits" text NOT NULL,
        "skillTargeted" character varying(200),
        "pricingModel" "public"."course_recommendations_pricingmodel_enum" NOT NULL DEFAULT 'one_time',
        "estimatedTokenCost" integer,
        "priceNote" text,
        "rank" integer NOT NULL DEFAULT 0,
        "generatedByModel" character varying(60) NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_course_recommendations" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_course_recommendations_jd_url" UNIQUE ("jobDescriptionId", "url")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_course_recommendations_jd_rank" ON "course_recommendations" ("jobDescriptionId", "rank")`,
    );
    await queryRunner.query(`
      ALTER TABLE "course_recommendations"
      ADD CONSTRAINT "FK_course_recommendations_job_description"
      FOREIGN KEY ("jobDescriptionId") REFERENCES "job_descriptions"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "course_recommendations" DROP CONSTRAINT "FK_course_recommendations_job_description"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_course_recommendations_jd_rank"`,
    );
    await queryRunner.query(`DROP TABLE "course_recommendations"`);
    await queryRunner.query(
      `DROP TYPE "public"."course_recommendations_pricingmodel_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."course_recommendations_provider_enum"`,
    );
    await queryRunner.query(`DROP TABLE "job_descriptions"`);
  }
}
