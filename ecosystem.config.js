// Deliberately no `TZ` here.
//
// Pinning the process to Asia/Manila looked like cheap insurance, but it broke
// reads: the database session is UTC, and a `timestamp without time zone`
// column is materialised by node-postgres using the *process's* timezone, so
// pinning it made every stored timestamp read 8 hours off. Migration
// 1786100000000 converted those columns to `timestamptz`, and the scheduling
// code converts explicitly via common/utils/timezone.ts — between them the
// process timezone is now irrelevant, which is exactly what we want. Leaving
// the process on the host's UTC keeps it aligned with the database session.
//
// Note the deploy reloads with `--update-env` but *without* `--env production`,
// so only the plain `env` block below reaches the process.
const env = {};

module.exports = {
  apps: [
    {
      name: 'gdec-tokens-backend',
      script: 'dist/src/main.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env,
      env_production: {
        ...env,
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
    {
      name: 'gdec-tokens-backend-staging',
      script: 'dist/src/main.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env,
      env_production: {
        ...env,
        NODE_ENV: 'staging',
        PORT: 3000,
      },
    },
  ],
};
