const app = require('./app');
const env = require('./config/env');
const prisma = require('./config/db');

const server = app.listen(env.port, () => {
  console.log(`Shiorra app listening on http://localhost:${env.port} (${env.nodeEnv})`);
});

async function shutdown(signal) {
  console.log(`\n${signal} received — closing gracefully...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  // Hard-kill after 10s in case something is hanging
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
