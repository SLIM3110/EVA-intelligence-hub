const express = require('express');
const router = express.Router();
const sm = require('../sessionManager');

const auth = (req, res, next) => {
  if (req.headers['x-api-key'] !== process.env.WHATSAPP_API_KEY) {
    return res.status(401).json({ error: true, message: 'Unauthorised' });
  }
  next();
};

router.post('/start', auth, async (req, res) => {
  const { agentId } = req.body;
  if (!agentId) return res.status(400).json({ error: true, message: 'agentId required' });
  try {
    const result = await sm.createSession(agentId);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: true, message: e.message });
  }
});

router.get('/status', auth, async (req, res) => {
  const { agentId } = req.query;
  if (!agentId) return res.status(400).json({ error: true, message: 'agentId required' });
  const status = sm.getStatus(agentId);
  const qrCode = status === 'pending' ? sm.getQR(agentId) : null;
  res.json({ agentId, status, qrCode });
});

router.post('/disconnect', auth, async (req, res) => {
  const { agentId } = req.body;
  if (!agentId) return res.status(400).json({ error: true, message: 'agentId required' });
  await sm.disconnectSession(agentId);
  res.json({ success: true });
});

router.post('/pause', auth, async (req, res) => {
  const { agentId } = req.body;
  if (!agentId) return res.status(400).json({ error: true, message: 'agentId required' });
  try {
    await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/profiles?id=eq.${agentId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
        },
        body: JSON.stringify({ sending_paused: true })
      }
    );
    res.json({ success: true, status: 'paused' });
  } catch (e) {
    res.status(500).json({ error: true, message: e.message });
  }
});

router.post('/resume', auth, async (req, res) => {
  const { agentId } = req.body;
  if (!agentId) return res.status(400).json({ error: true, message: 'agentId required' });
  try {
    await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/profiles?id=eq.${agentId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
        },
        body: JSON.stringify({ sending_paused: false })
      }
    );
    res.json({ success: true, status: 'running' });
  } catch (e) {
    res.status(500).json({ error: true, message: e.message });
  }
});

module.exports = router;
