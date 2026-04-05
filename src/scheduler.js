const sessionManager = require('./sessionManager');

// SET THIS TO true FOR TESTING, false FOR PRODUCTION
const TEST_MODE = true;

async function supabaseFetch(path, options = {}) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  return res;
}

async function tick() {
  if (!TEST_MODE) {
    const uaeTime = new Date().toLocaleString('en-US', { timeZone: 'Asia/Dubai' });
    const uaeHour = new Date(uaeTime).getHours();
    if (uaeHour < 9 || uaeHour >= 19) {
      console.log(`Scheduler: outside UAE business hours (${uaeHour}:00), skipping`);
      return;
    }
  }

  const agentsRes = await supabaseFetch(
    '/profiles?whatsapp_session_status=eq.connected&is_active=eq.true&select=id'
  );
  const agents = await agentsRes.json();
  if (!Array.isArray(agents)) return;

  for (const agent of agents) {
    try { await processAgent(agent.id); }
    catch (e) { console.error(`Scheduler error for agent ${agent.id}:`, e.message); }
  }
}

async function processAgent(agentId) {
  const todayUAE = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });

  // Check daily cap
  const countRes = await supabaseFetch(
    `/messages_log?agent_id=eq.${agentId}&sent_at=gte.${todayUAE}T00:00:00+04:00&select=id`,
    { headers: { 'Prefer': 'count=exact' } }
  );
  const range = countRes.headers.get('content-range');
  const sentToday = range ? parseInt(range.split('/')[1]) : 0;
  if (sentToday >= 50) {
    console.log(`Agent ${agentId} hit daily cap of 50`);
    return;
  }

  // Check if agent has paused sending
  const profileRes = await supabaseFetch(`/profiles?id=eq.${agentId}&select=sending_paused`);
  const profiles = await profileRes.json();
  if (profiles.length > 0 && profiles[0].sending_paused === true) {
    console.log(`Agent ${agentId} has paused sending, skipping`);
    return;
  }

  // Time gap between messages
  if (!TEST_MODE) {
    const lastRes = await supabaseFetch(
      `/messages_log?agent_id=eq.${agentId}&order=sent_at.desc&limit=1&select=sent_at`
    );
    const lastLogs = await lastRes.json();
    if (lastLogs.length > 0) {
      const secondsSinceLast = (Date.now() - new Date(lastLogs[0].sent_at).getTime()) / 1000;
      const randomWait = 120 + Math.floor(Math.random() * 180);
      if (secondsSinceLast < randomWait) return;
    }
  }

  // Get next pending contact
  const contactRes = await supabaseFetch(
    `/owner_contacts?assigned_agent=eq.${agentId}&message_status=eq.pending&order=created_at.asc&limit=1`
  );
  const contacts = await contactRes.json();
  if (!contacts.length) return;

  const contact = contacts[0];

  try {
    await sessionManager.sendMessage(agentId, contact.number_1, contact.generated_message);

    await supabaseFetch(`/owner_contacts?id=eq.${contact.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ message_status: 'sent' })
    });

    await supabaseFetch('/messages_log', {
      method: 'POST',
      body: JSON.stringify({
        contact_id: contact.id,
        agent_id: agentId,
        number_used: contact.number_1,
        message_text: contact.generated_message,
        delivery_status: 'sent'
      })
    });

    await supabaseFetch('/rpc/increment_batch_sent', {
      method: 'POST',
      body: JSON.stringify({ batch_id: contact.uploaded_batch_id })
    });

    console.log(`${TEST_MODE ? '[TEST MODE] ' : ''}Sent to ${contact.number_1} for agent ${agentId}`);
  } catch (err) {
    console.error(`Send failed for contact ${contact.id}:`, err.message);
    await supabaseFetch(`/owner_contacts?id=eq.${contact.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ message_status: 'failed' })
    });
  }
}

function startScheduler() {
  if (TEST_MODE) {
    console.log('Scheduler running in TEST MODE — no time restrictions, no gaps between messages');
  } else {
    console.log('Scheduler running in PRODUCTION MODE — 9am to 7pm UAE, 2 to 5 min gaps');
  }
  setInterval(tick, TEST_MODE ? 10000 : 60000);
}

module.exports = { startScheduler };
