require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { restoreAllSessions } = require('./sessionManager');
const { startScheduler } = require('./scheduler');

const app = express();

app.use(cors({
  origin: '*',
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
  await restoreAllSessions();
  startScheduler();
});
