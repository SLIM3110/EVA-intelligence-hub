const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const pino = require('pino');

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
    if (!res.ok) console.error(`Failed to update status:`, await res.text());
    else console.log(`Status updated to ${status} for agent ${agentId}`);
  } catch (e) {
    console.error('Supabase status update error:', e.message);
  }
}

async function initClient(agentId) {
  const sessionsDir = path.join(__dirname, '..', 'sessions', `agent-${agentId}`);
  if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionsDir);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: ['EVA Real Estate', 'Chrome', '1.0.0']
  });

  clients.set(agentId, sock);
  statuses.set(agentId, 'pending');

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const base64 = await QRCode.toDataURL(qr);
      qrCodes.set(agentId, base64);
      statuses.set(agentId, 'pending');
      console.log(`QR ready for agent ${agentId} — scan within 60 seconds`);
      await updateSupabaseStatus(agentId, 'pending');
    }

    if (connection === 'open') {
      statuses.set(agentId, 'connected');
      qrCodes.delete(agentId);
      console.log(`Agent ${agentId} connected`);
      await updateSupabaseStatus(agentId, 'connected');
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`Agent ${agentId} disconnected. Code: ${statusCode}. Reconnect: ${shouldReconnect}`);
      statuses.set(agentId, 'disconnected');
      await updateSupabaseStatus(agentId, 'disconnected');

      if (shouldReconnect) {
        console.log(`Reconnecting agent ${agentId} in 5 seconds...`);
        setTimeout(() => initClient(agentId), 5000);
      } else {
        console.log(`Agent ${agentId} logged out — clearing session`);
        clients.delete(agentId);
        qrCodes.delete(agentId);
        const sessionPath = path.join(__dirname, '..', 'sessions', `agent-${agentId}`);
        if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { recursive: true });
      }
    }
  });

  return sock;
}

async function restoreAllSessions() {
  const sessionsDir = path.join(__dirname, '..', 'sessions');
  if (!fs.existsSync(sessionsDir)) return;
  const dirs = fs.readdirSync(sessionsDir).filter(d => d.startsWith('agent-'));
  console.log(`Restoring ${dirs.length} sessions...`);
  for (const dir of dirs) {
    const agentId = dir.replace('agent-', '');
    console.log(`Restoring session for agent: ${agentId}`);
    try {
      await initClient(agentId);
    } catch (e) {
      console.error(`Failed to restore session for agent ${agentId}:`, e.message);
      // Clear corrupt session so next start generates fresh QR
      const sessionPath = path.join(__dirname, '..', 'sessions', `agent-${agentId}`);
      if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { recursive: true });
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  console.log('All sessions restored');
}

async function createSession(agentId) {
  if (clients.has(agentId) && statuses.get(agentId) === 'connected') {
    return { status: 'already_connected' };
  }

  // Kill any existing broken session
  if (clients.has(agentId)) {
    try { clients.get(agentId).end(); } catch (e) {}
    clients.delete(agentId);
    qrCodes.delete(agentId);
  }

  // If stale session files exist but socket is gone, clear them so Baileys starts fresh
  const sessionPath = path.join(__dirname, '..', 'sessions', `agent-${agentId}`);
  const credsFile = path.join(sessionPath, 'creds.json');
  if (fs.existsSync(credsFile)) {
    try {
      await initClient(agentId);
      // Wait to see if it reconnects automatically without needing a QR
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 1000));
        if (statuses.get(agentId) === 'connected') return { status: 'already_connected' };
        if (qrCodes.has(agentId)) break;
      }
      if (!qrCodes.has(agentId)) {
        // Restore failed — wipe credentials and start clean
        console.log(`Session restore failed for ${agentId}, starting clean`);
        try { clients.get(agentId)?.end(); } catch (e) {}
        clients.delete(agentId);
        qrCodes.delete(agentId);
        if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { recursive: true });
        await initClient(agentId);
      }
    } catch (e) {
      console.error(`Session restore error for ${agentId}:`, e.message);
      clients.delete(agentId);
      qrCodes.delete(agentId);
      if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { recursive: true });
      await initClient(agentId);
    }
  } else {
    await initClient(agentId);
  }

  // Wait up to 20 seconds for QR
  for (let i = 0; i < 20; i++) {
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
  const sock = clients.get(agentId);
  if (!sock || statuses.get(agentId) !== 'connected') {
    throw new Error('Session not connected for this agent');
  }
  const jid = `${number.replace(/\D/g, '')}@s.whatsapp.net`;
  await sock.sendMessage(jid, { text: message });
  return { messageId: `${agentId}-${Date.now()}`, timestamp: new Date().toISOString() };
}

async function disconnectSession(agentId) {
  const sock = clients.get(agentId);
  if (sock) {
    try { await sock.logout(); } catch (e) {}
  }
  clients.delete(agentId);
  qrCodes.delete(agentId);
  statuses.set(agentId, 'disconnected');
  const sessionPath = path.join(__dirname, '..', 'sessions', `agent-${agentId}`);
  if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { recursive: true });
  await updateSupabaseStatus(agentId, 'disconnected');
}

module.exports = {
  createSession, getStatus, getQR,
  sendMessage, disconnectSession, restoreAllSessions
};
