const { Client, LocalAuth } = require('whatsapp-web.js');
const path = require('path');
const QRCode = require('qrcode');
const fs = require('fs');

const clients = new Map();
const qrCodes = new Map();
const statuses = new Map();

async function updateSupabaseStatus(agentId, status) {
  try {
    const baseUrl = process.env.SUPABASE_URL || 'https://guwmfmwyqrwvufchkzfc.supabase.co';
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;
    
    const res = await fetch(
      `${baseUrl}/rest/v1/profiles?id=eq.${agentId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`
        },
        body: JSON.stringify({ whatsapp_session_status: status })
      }
    );
    
    if (!res.ok) {
      console.error(`Failed to update status for agent ${agentId}:`, await res.text());
    } else {
      console.log(`Status updated to ${status} for agent ${agentId}`);
    }
  } catch (e) {
    console.error('Supabase status update error:', e.message);
  }
}

async function initClient(agentId) {
  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: `agent-${agentId}`,
      dataPath: path.join(__dirname, '..', 'sessions')
    }),
    puppeteer: {
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ]
    }
  });

  statuses.set(agentId, 'pending');
  clients.set(agentId, client);

  client.on('qr', async (qr) => {
    const base64 = await QRCode.toDataURL(qr);
    qrCodes.set(agentId, base64);
    statuses.set(agentId, 'pending');
    console.log(`QR ready for agent ${agentId}`);
    await updateSupabaseStatus(agentId, 'pending');
  });

  client.on('ready', async () => {
    statuses.set(agentId, 'connected');
    qrCodes.delete(agentId);
    console.log(`Agent ${agentId} connected`);
    await updateSupabaseStatus(agentId, 'connected');
  });

  client.on('authenticated', () => {
    statuses.set(agentId, 'connected');
  });

  client.on('disconnected', async (reason) => {
    console.log(`Agent ${agentId} disconnected: ${reason}`);
    statuses.set(agentId, 'disconnected');
    await updateSupabaseStatus(agentId, 'disconnected');
    setTimeout(() => {
      console.log(`Attempting reconnect for agent ${agentId}`);
      initClient(agentId);
    }, 30000);
  });

  client.on('auth_failure', async () => {
    statuses.set(agentId, 'disconnected');
    await updateSupabaseStatus(agentId, 'disconnected');
  });

  client.initialize();
  return client;
}

async function restoreAllSessions() {
  const sessionsDir = path.join(__dirname, '..', 'sessions');
  if (!fs.existsSync(sessionsDir)) return;
  const dirs = fs.readdirSync(sessionsDir).filter(d => d.startsWith('agent-'));

  console.log(`Restoring ${dirs.length} sessions with staggered startup...`);

  for (const dir of dirs) {
    const agentId = dir.replace('agent-', '');
    console.log(`Restoring session for agent: ${agentId}`);
    await initClient(agentId);
    // Wait 3 seconds between each agent to avoid RAM spike
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log('All sessions restored');
}

async function createSession(agentId) {
  if (clients.has(agentId) && statuses.get(agentId) === 'connected') {
    return { status: 'already_connected' };
  }
  if (clients.has(agentId)) {
    try { await clients.get(agentId).destroy(); } catch(e) {}
    clients.delete(agentId);
  }
  await initClient(agentId);
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (qrCodes.has(agentId)) break;
    if (statuses.get(agentId) === 'connected') return { status: 'already_connected' };
  }
  return { qrCode: qrCodes.get(agentId) || null, status: 'pending' };
}

function getStatus(agentId) {
  return statuses.get(agentId) || 'disconnected';
}

function getQR(agentId) {
  return qrCodes.get(agentId) || null;
}

async function sendMessage(agentId, number, message) {
  const client = clients.get(agentId);
  if (!client || statuses.get(agentId) !== 'connected') {
    throw new Error('Session not connected for this agent');
  }
  const chatId = `${number.replace(/\D/g, '')}@c.us`;
  const result = await client.sendMessage(chatId, message);
  return { messageId: result.id._serialized, timestamp: new Date().toISOString() };
}

async function disconnectSession(agentId) {
  const client = clients.get(agentId);
  if (client) {
    try { await client.destroy(); } catch(e) {}
  }
  clients.delete(agentId);
  qrCodes.delete(agentId);
  statuses.set(agentId, 'disconnected');
  const sessionPath = path.join(__dirname, '..', 'sessions', `agent-${agentId}`);
  if (fs.existsSync(sessionPath)) {
    fs.rmSync(sessionPath, { recursive: true });
  }
  await updateSupabaseStatus(agentId, 'disconnected');
}

module.exports = {
  createSession, getStatus, getQR,
  sendMessage, disconnectSession, restoreAllSessions
};
