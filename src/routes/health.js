const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

router.post('/trigger', async (req, res) => {
  if (req.headers['x-api-key'] !== process.env.WHATSAPP_API_KEY) {
    return res.status(401).json({ error: true, message: 'Unauthorised' });
  }
  try {
    const { tick } = require('../scheduler');
    await tick();
    res.json({ success: true, message: 'Scheduler tick executed' });
  } catch (e) {
    res.status(500).json({ error: true, message: e.message });
  }
});

module.exports = router;
