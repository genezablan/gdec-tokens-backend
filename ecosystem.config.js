module.exports = {
  apps: [
    {
      name: 'gdec-tokens-backend',
      script: 'dist/src/main.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env_production: {
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
      env_production: {
        NODE_ENV: 'staging',
        PORT: 3000,
      },
    },
  ],
};
