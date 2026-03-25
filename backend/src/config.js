const dotenv = require('dotenv');

dotenv.config();

module.exports = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl:
    process.env.DATABASE_URL || 'postgres://maxuser:change_me@db:5432/maxapp',
  backendPublicUrl: process.env.BACKEND_PUBLIC_URL || 'http://localhost:3000',
  miniappPublicUrl: process.env.MINIAPP_PUBLIC_URL || 'http://localhost:5173',
  maxBotToken: process.env.MAX_BOT_TOKEN || 'replace_me',
  maxWebhookSecret: process.env.MAX_WEBHOOK_SECRET || 'replace_me',
  miniappSharedSecret: process.env.MINIAPP_SHARED_SECRET || 'replace_me'
};
