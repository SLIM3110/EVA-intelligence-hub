const express = require('express');
const router = express.Router();
const sm = require('../sessionManager');

const auth = (req, res, next) => {
  if (req.headers['x-api-key'] !== process.env.WHATSAPP_API_KEY) {
    return res.status(401).json({ error: true, message: 'Unauthorised' });
  }
  next();
};

router.post('/send', auth, async (req, res) => {
  const { agentId, number, message } = req.body;
  if (!agentId || !number || !message) {
    return res.status(400).json({ error: true, message: 'agentId, number, and message are all required' });
  }
  try {
    const result = await sm.sendMessage(agentId, number, message);
    res.json({ success: true, ...result });
  } catch (e) {
    const code = e.message.includes('not connected') ? 403 : 500;
    res.status(code).json({ error: true, message: e.message });
  }
});

module.exports = router;
