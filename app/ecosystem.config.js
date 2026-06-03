// PM2 process definition — `pm2 start ecosystem.config.js --env production`
module.exports = {
  apps: [
    {
      name: 'shiorra-app',
      script: 'src/server.js',
      instances: 'max',
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
