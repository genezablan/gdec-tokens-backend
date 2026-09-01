/**
 * Generate cached course recommendations for stored job descriptions.
 *
 *   npx ts-node scripts/generate-course-recommendations.ts          # only positions with none
 *   npx ts-node scripts/generate-course-recommendations.ts --all    # regenerate everything
 *
 * Runs sequentially and takes roughly 70 seconds per position, so a full
 * 150-role batch is a multi-hour job — run it detached, not in a terminal you
 * intend to close. Costs about USD 0.26 per position.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { CourseRecommendationsService } from '../src/course-recommendations/course-recommendations.service';

async function main() {
  const all = process.argv.includes('--all');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const service = app.get(CourseRecommendationsService, { strict: false });
    const before = await service.coverage();
    console.log(
      `\n${before.withJobDescription} of ${before.positionsWithEmployees} held positions have a job description; ` +
        `${before.withRecommendations} already have courses.\n`,
    );

    const { generated, failed } = await service.regenerateAll({
      onlyMissing: !all,
    });

    console.log(`\nGenerated ${generated} position(s).`);
    if (failed.length) {
      console.log(`Failed ${failed.length}:`);
      failed.forEach((f) => console.log(`  - ${f.position}: ${f.reason}`));
    }

    const after = await service.coverage();
    console.log(
      `\n${after.withRecommendations} of ${after.positionsWithEmployees} held positions now have courses.`,
    );
    if (after.missing.length) {
      console.log(`\nStill missing a job description (most staff first):`);
      after.missing
        .slice(0, 10)
        .forEach((m) =>
          console.log(`  - ${m.position} (${m.employees} employees)`),
        );
    }
  } finally {
    await app.close();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
