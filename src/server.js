require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { restoreAllSessions } = require('./sessionManager');
const { startScheduler } = require('./scheduler');
const { ensureBucket } = require('./storage');

const app = express();

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : [];

app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server requests (no origin) and listed origins
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS blocked: ${origin}`));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-api-key', 'Authorization']
}));

app.use(express.json());

app.use('/api/health', require('./routes/health'));
app.use('/api/session', require('./routes/session'));
app.use('/api/message', require('./routes/message'));

process.on('uncaughtException', (err) => console.error('Uncaught exception:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`EVA WhatsApp Backend running on port ${PORT}`);
  await ensureBucket();
  await restoreAllSessions();
  startScheduler();
});
