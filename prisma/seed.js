const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const app = {
  name: 'TiltTrader Dev',
  apiKey: 'dev_api_key_123',
  platform: 'tilttrader',
  platformId: '53052',
  deriv_id: '53052',
  origin: 'studious-fishstick-jjpv7qrxqw435rwr-3000.app.github.dev',
  permissions: JSON.stringify(['authorize', 'query-user', 'websocket']),
};

async function main() {
  await prisma.app.upsert({
    where: {
      apiKey: app.apiKey,
    },
    update: app,
    create: app,
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });