const express = require('express');
const cors = require('cors');
const config = require('./config');
const db = require('./db');
const healthRoutes = require('./routes/health.routes');
const botRoutes = require('./routes/bot.routes');
const miniappRoutes = require('./routes/miniapp.routes');

const app = express();

app.use(cors());
app.use(express.json());

app.use(healthRoutes);
app.use(botRoutes);
app.use(miniappRoutes);

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: 'Route not found.'
  });
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({
    ok: false,
    error: 'Internal server error.'
  });
});

async function waitForDatabase(maxAttempts, delayMs) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await db.checkConnection();
      return;
    } catch (error) {
      console.log(`Database is not ready yet (attempt ${attempt}/${maxAttempts}).`);

      if (attempt === maxAttempts) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function start() {
  await waitForDatabase(20, 2000);

  app.listen(config.port, () => {
    console.log(`Backend listening on port ${config.port}`);
  });
}

start().catch((error) => {
  console.error('Failed to start backend:', error);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  await db.closePool();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await db.closePool();
  process.exit(0);
});
