// Note: the deploy workflow reloads with `--update-env` but *without*
// `--env production`, so PM2 only applies the plain `env` block. Anything that
// must actually reach the process therefore has to live in `env` — the
// `env_production` blocks below are kept for manual `pm2 ... --env production`
// runs, which is why the values are duplicated.
const env = {
  // Pin the process clock to the business timezone. The app converts explicitly
  // (see common/utils/timezone.ts), so this is belt-and-braces — it stops a bare
  // `new Date('2026-08-10T09:00')` anywhere from silently resolving against the
  // host's zone, which on these UTC boxes is 8 hours out.
  TZ: 'Asia/Manila',
};

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
