-- ─────────────────────────────────────────────────────────────────────────────
-- Delete a resigned employee whose stored address is the malformed
--   "araramos@gmail.com\r\n\r\na.ramos@greatdealscorp.com"
--
-- Run the whole file inside ONE transaction and read every report before you
-- COMMIT. Nothing here is reversible once committed.
--
-- Why a plain DELETE is not enough: 24 tables reference users. Most cascade,
-- so the delete silently destroys her token balance, community posts, comments,
-- reactions, login history and announcement reads. Seven columns across five
-- tables do NOT cascade — they are RESTRICT, so the DELETE aborts with a
-- foreign key violation until each one is cleared by hand. Steps 3-5 clear them
-- deliberately, so you can see exactly what is being given up.
--
-- The app has a guarded equivalent (DELETE /users/:id, admin only) that refuses
-- with 409 rather than destroying token-request history. This file exists
-- because the deletion was requested as SQL.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. Identify her ─────────────────────────────────────────────────────────
-- Matched with LIKE so the embedded CRLF never has to be typed literally.
CREATE TEMP TABLE target AS
SELECT id, "employeeId", email, "firstName", "lastName", "isActive"
FROM users
WHERE email LIKE 'araramos@gmail.com%';

SELECT * FROM target;
-- ►► STOP unless this returned EXACTLY ONE row and it is the right person.
--    More than one row means the LIKE is too loose — narrow it and start over.

-- ── 2. What is about to be destroyed ────────────────────────────────────────
-- Everything below CASCADEs away with her. Read the counts; they do not come back.
SELECT 'token_balances'    AS tbl, count(*) FROM token_balances    WHERE "userId"     IN (SELECT id FROM target)
UNION ALL SELECT 'posts',            count(*) FROM posts             WHERE "authorId"   IN (SELECT id FROM target)
UNION ALL SELECT 'comments',         count(*) FROM comments          WHERE "authorId"   IN (SELECT id FROM target)
UNION ALL SELECT 'reactions',        count(*) FROM reactions         WHERE "userId"     IN (SELECT id FROM target)
UNION ALL SELECT 'poll_votes',       count(*) FROM poll_votes        WHERE "userId"     IN (SELECT id FROM target)
UNION ALL SELECT 'login_events',     count(*) FROM login_events      WHERE "userId"     IN (SELECT id FROM target)
UNION ALL SELECT 'notifications',    count(*) FROM notifications     WHERE "userId"     IN (SELECT id FROM target)
UNION ALL SELECT 'community_members',count(*) FROM community_members WHERE "userId"     IN (SELECT id FROM target)
UNION ALL SELECT 'announcement_reads', count(*) FROM announcement_reads WHERE "userId"  IN (SELECT id FROM target);

-- These block the delete instead of cascading, so they must be cleared first.
SELECT 'token_requests (employee)'      AS ref, count(*) FROM token_requests    WHERE "employeeId"            IN (SELECT id FROM target)
UNION ALL SELECT 'token_requests (manager)',    count(*) FROM token_requests    WHERE "managerId"             IN (SELECT id FROM target)
UNION ALL SELECT 'token_requests (hr)',         count(*) FROM token_requests    WHERE "hrId"                  IN (SELECT id FROM target)
UNION ALL SELECT 'token_requests (rejectedBy)', count(*) FROM token_requests    WHERE "rejectedById"          IN (SELECT id FROM target)
UNION ALL SELECT 'token_requests (decidedBy)',  count(*) FROM token_requests    WHERE "lastDecisionById"      IN (SELECT id FROM target)
UNION ALL SELECT 'coaching_sessions (coach)',   count(*) FROM coaching_sessions WHERE "coachId"               IN (SELECT id FROM target)
UNION ALL SELECT 'coaching_sessions (employee)',count(*) FROM coaching_sessions WHERE "employeeId"            IN (SELECT id FROM target)
UNION ALL SELECT 'coaching_sessions (cancelBy)',count(*) FROM coaching_sessions WHERE "cancelRequestedById"   IN (SELECT id FROM target)
UNION ALL SELECT 'coach_availability',          count(*) FROM coach_availability WHERE "coachId"              IN (SELECT id FROM target)
UNION ALL SELECT 'development_options (updatedBy)', count(*) FROM development_options WHERE "updatedById"     IN (SELECT id FROM target)
UNION ALL SELECT 'users (reports to her)',      count(*) FROM users             WHERE "immediateSupervisorId" IN (SELECT id FROM target);

-- ►► If the second report is all zeros, skip to step 6 — nothing blocks the delete.

-- ── 3. Detach her from other people's records ───────────────────────────────
-- Approvals she made on SOMEONE ELSE's request: keep the request, drop the
-- attribution. Deleting these rows would erase another employee's history.
UPDATE token_requests SET "managerId"        = NULL WHERE "managerId"        IN (SELECT id FROM target);
UPDATE token_requests SET "hrId"             = NULL WHERE "hrId"             IN (SELECT id FROM target);
UPDATE token_requests SET "rejectedById"     = NULL WHERE "rejectedById"     IN (SELECT id FROM target);
UPDATE token_requests SET "lastDecisionById" = NULL WHERE "lastDecisionById" IN (SELECT id FROM target);
UPDATE coaching_sessions SET "cancelRequestedById" = NULL WHERE "cancelRequestedById" IN (SELECT id FROM target);
UPDATE development_options SET "updatedById" = NULL WHERE "updatedById"      IN (SELECT id FROM target);

-- Anyone reporting to her is orphaned — HR must reassign them afterwards.
SELECT id, "employeeId", "firstName", "lastName" FROM users
WHERE "immediateSupervisorId" IN (SELECT id FROM target);
UPDATE users SET "immediateSupervisorId" = NULL WHERE "immediateSupervisorId" IN (SELECT id FROM target);

-- ── 4. Her own coaching data ────────────────────────────────────────────────
DELETE FROM coach_availability WHERE "coachId" IN (SELECT id FROM target);
DELETE FROM coaching_sessions
WHERE "coachId" IN (SELECT id FROM target) OR "employeeId" IN (SELECT id FROM target);

-- ── 5. Her own token requests ───────────────────────────────────────────────
-- This is the audit trail of what she requested and what was approved. Gone.
DELETE FROM token_requests WHERE "employeeId" IN (SELECT id FROM target);

-- ── 6. The user row — everything in report 1 cascades away with it ──────────
DELETE FROM users WHERE id IN (SELECT id FROM target);

-- Expect 1.
SELECT count(*) AS should_be_zero FROM users WHERE email LIKE 'araramos@gmail.com%';

DROP TABLE target;

-- ►► COMMIT; only if every report above matched what you expected.
--    Otherwise: ROLLBACK;
ROLLBACK;
