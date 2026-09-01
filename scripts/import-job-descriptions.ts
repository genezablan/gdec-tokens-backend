/**
 * Import job descriptions from a spreadsheet.
 *
 *   npx ts-node scripts/import-job-descriptions.ts job_descriptions.xlsx
 *
 * Expects two columns, matched case-insensitively:
 *   "Position"        — must equal users.position exactly, or nobody sees the result
 *   "Job Description" — the text the recommender reasons over
 *
 * Upserts on position, so re-running with a corrected sheet updates in place
 * rather than failing on the unique constraint.
 */
import { AppDataSource } from '../src/data-source';
import { JobDescription } from '../src/entities/job-description.entity';
import { User } from '../src/entities/user.entity';
import * as XLSX from 'xlsx';
import * as path from 'path';

/**
 * Read a column by any of several header spellings.
 *
 * Only primitive cells are accepted: xlsx hands back Dates and objects for some
 * cell types, and stringifying one of those would quietly write "[object
 * Object]" into a job description rather than failing.
 */
const pick = (row: Record<string, unknown>, ...names: string[]): string => {
  for (const key of Object.keys(row)) {
    const normalised = key.trim().toLowerCase();
    if (!names.some((n) => normalised === n.toLowerCase())) continue;
    const cell = row[key];
    if (typeof cell === 'string') return cell.trim();
    if (typeof cell === 'number' || typeof cell === 'boolean') {
      return String(cell);
    }
    return '';
  }
  return '';
};

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error(
      'Usage: ts-node scripts/import-job-descriptions.ts <file.xlsx>',
    );
    process.exit(1);
  }

  await AppDataSource.initialize();
  const jdRepo = AppDataSource.getRepository(JobDescription);
  const userRepo = AppDataSource.getRepository(User);

  const workbook = XLSX.readFile(file);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    workbook.Sheets[workbook.SheetNames[0]],
  );
  console.log(`Read ${rows.length} row(s) from ${path.basename(file)}`);

  // Positions actually held by active employees. A JD for a position nobody
  // holds is dead weight, and — far more likely — a typo that will silently
  // never match, so it is worth naming at import time rather than discovering
  // later when employees see nothing.
  const held = new Set(
    (
      await userRepo
        .createQueryBuilder('u')
        .select('DISTINCT u.position', 'position')
        .where('u."isActive" = true')
        .andWhere('u.position IS NOT NULL')
        .getRawMany<{ position: string }>()
    ).map((r) => r.position),
  );

  let created = 0;
  let updated = 0;
  const unmatched: string[] = [];
  const skipped: string[] = [];

  for (const row of rows) {
    const position = pick(row, 'position', 'job title', 'title');
    const content = pick(row, 'job description', 'description', 'jd');

    if (!position || !content) {
      skipped.push(position || '(blank)');
      continue;
    }
    if (!held.has(position)) unmatched.push(position);

    const existing = await jdRepo.findOne({ where: { position } });
    if (existing) {
      existing.content = content;
      existing.source = path.basename(file);
      await jdRepo.save(existing);
      updated++;
    } else {
      await jdRepo.save(
        jdRepo.create({ position, content, source: path.basename(file) }),
      );
      created++;
    }
  }

  console.log(`\n  created ${created}, updated ${updated}`);
  if (skipped.length) {
    console.log(
      `  skipped ${skipped.length} row(s) missing a position or description`,
    );
  }
  if (unmatched.length) {
    console.log(
      `\n  WARNING: ${unmatched.length} position(s) match no active employee — ` +
        `check for spelling differences against users.position:`,
    );
    unmatched.forEach((p) => console.log(`    - ${p}`));
  }

  const covered = await jdRepo.count();
  console.log(
    `\n  ${covered} of ${held.size} held positions now have a job description.`,
  );
  await AppDataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
