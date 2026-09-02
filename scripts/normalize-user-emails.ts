/**
 * One-off cleanup for `users.email`.
 *
 * The employee importers wrote spreadsheet cells straight into the column, so
 * production holds addresses with leading/trailing whitespace, a stray tab, and
 * a couple of cells containing two addresses joined by newlines. Those rows
 * break two things:
 *
 *   1. Login and SSO — both look the user up with an exact `where: { email }`,
 *      so " lj092593@gmail.com" can never be matched.
 *   2. Every all-employee email — SES rejects an entire SendEmail call if one
 *      destination is malformed, which silently costs a whole BCC batch its
 *      copy. (EmailService now normalises at send time, so this script is about
 *      the stored data, not the blasts.)
 *
 * Dry run by default — prints what it would change and exits.
 *
 *   npm run fix:user-emails              # report only
 *   npm run fix:user-emails -- --apply   # write the unambiguous fixes
 *   npm run fix:user-emails -- --apply --pick-first
 *                                        # also resolve multi-address cells to
 *                                        # the first address listed
 */
import { AppDataSource } from '../src/data-source';
import { User } from '../src/entities/user.entity';

/** Same shape EmailService accepts — stricter than RFC 5322 on purpose. */
const EMAIL_ADDRESS = /^[^\s@<>,;"]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

type Verdict =
  | { kind: 'ok' }
  | { kind: 'whitespace'; to: string }
  | { kind: 'multiple'; to: string; others: string[] }
  | { kind: 'invalid' };

function classify(raw: string | null): Verdict {
  const parts = String(raw ?? '')
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => EMAIL_ADDRESS.test(p));

  if (parts.length === 0) return { kind: 'invalid' };
  if (parts.length > 1) {
    return { kind: 'multiple', to: parts[0], others: parts.slice(1) };
  }
  return parts[0] === raw ? { kind: 'ok' } : { kind: 'whitespace', to: parts[0] };
}

async function normalizeUserEmails() {
  const apply = process.argv.includes('--apply');
  const pickFirst = process.argv.includes('--pick-first');

  await AppDataSource.initialize();
  console.log('✅ Database connected');

  const repo = AppDataSource.getRepository(User);
  const users = await repo.find({
    select: { id: true, employeeId: true, email: true, isActive: true },
  });
  console.log(`👥 ${users.length} users\n`);

  // Every address currently in use, so a fix can't collide with another row —
  // the column is UNIQUE, and a collision means two people share an address.
  const taken = new Map<string, User>();
  for (const u of users) taken.set((u.email ?? '').toLowerCase(), u);

  const fixed: string[] = [];
  const needsDecision: string[] = [];
  const blocked: string[] = [];
  const unusable: string[] = [];

  for (const user of users) {
    const verdict = classify(user.email);
    if (verdict.kind === 'ok') continue;

    const label = `${user.employeeId ?? user.id}${user.isActive ? '' : ' (inactive)'}`;

    if (verdict.kind === 'invalid') {
      unusable.push(`  ${label}: ${JSON.stringify(user.email)} — no usable address`);
      continue;
    }

    const clash = taken.get(verdict.to.toLowerCase());
    if (clash && clash.id !== user.id) {
      blocked.push(
        `  ${label}: ${JSON.stringify(user.email)} → ${verdict.to} — already used by ${clash.employeeId ?? clash.id}`,
      );
      continue;
    }

    // Which address to keep out of a multi-address cell is a business call, not
    // a cleanup one, so it takes an explicit flag.
    if (verdict.kind === 'multiple' && !pickFirst) {
      needsDecision.push(
        `  ${label}: ${JSON.stringify(user.email)} — holds ${[verdict.to, ...verdict.others].join(' and ')}`,
      );
      continue;
    }

    const note =
      verdict.kind === 'multiple'
        ? ` (dropping ${verdict.others.join(', ')})`
        : '';
    fixed.push(`  ${label}: ${JSON.stringify(user.email)} → ${verdict.to}${note}`);

    if (apply) {
      await repo.update(user.id, { email: verdict.to });
      taken.delete((user.email ?? '').toLowerCase());
      taken.set(verdict.to.toLowerCase(), user);
    }
  }

  const section = (title: string, lines: string[]) => {
    if (lines.length === 0) return;
    console.log(`${title} (${lines.length})`);
    lines.forEach((l) => console.log(l));
    console.log('');
  };

  section(apply ? '✏️  Updated' : '✏️  Would update', fixed);
  section('❓ Needs a decision — re-run with --pick-first to keep the first', needsDecision);
  section('⛔ Blocked by the UNIQUE constraint — fix by hand', blocked);
  section('🚫 No usable address — HR needs to supply one', unusable);

  if (fixed.length === 0 && needsDecision.length === 0 && blocked.length === 0 && unusable.length === 0) {
    console.log('✅ Every address is already clean');
  } else if (!apply && fixed.length > 0) {
    console.log('Dry run — nothing was written. Re-run with --apply to commit.');
  }

  await AppDataSource.destroy();
}

normalizeUserEmails().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
