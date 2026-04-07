const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const BUCKET = 'whatsapp-sessions';

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_KEY not set');
  return createClient(url, key);
}

async function ensureBucket() {
  const supabase = getClient();
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw new Error(`Failed to list buckets: ${error.message}`);
  const exists = buckets?.find(b => b.name === BUCKET);
  if (!exists) {
    const { error: createErr } = await supabase.storage.createBucket(BUCKET, { public: false });
    if (createErr) throw new Error(`Failed to create bucket: ${createErr.message}`);
    console.log('Created whatsapp-sessions bucket in Supabase Storage');
  }
}

async function uploadSession(agentId) {
  const sessionDir = path.join(__dirname, '..', 'sessions', `agent-${agentId}`);
  if (!fs.existsSync(sessionDir)) return;
  const supabase = getClient();
  const files = fs.readdirSync(sessionDir);
  for (const file of files) {
    const filePath = path.join(sessionDir, file);
    const content = fs.readFileSync(filePath);
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(`${agentId}/${file}`, content, { upsert: true });
    if (error) console.error(`Failed to upload ${file} for agent ${agentId}:`, error.message);
  }
  console.log(`Session uploaded to Supabase Storage for agent ${agentId}`);
}

async function downloadSession(agentId) {
  const sessionDir = path.join(__dirname, '..', 'sessions', `agent-${agentId}`);
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
  const supabase = getClient();
  const { data: files, error } = await supabase.storage.from(BUCKET).list(agentId);
  if (error) {
    console.error(`Failed to list session files for agent ${agentId}:`, error.message);
    return false;
  }
  if (!files || files.length === 0) return false;
  for (const file of files) {
    const { data, error: dlErr } = await supabase.storage
      .from(BUCKET)
      .download(`${agentId}/${file.name}`);
    if (dlErr) {
      console.error(`Failed to download ${file.name} for agent ${agentId}:`, dlErr.message);
      continue;
    }
    if (data) {
      const buffer = Buffer.from(await data.arrayBuffer());
      fs.writeFileSync(path.join(sessionDir, file.name), buffer);
    }
  }
  console.log(`Session downloaded from Supabase Storage for agent ${agentId}`);
  return true;
}

async function deleteSession(agentId) {
  const supabase = getClient();
  const { data: files, error } = await supabase.storage.from(BUCKET).list(agentId);
  if (error) {
    console.error(`Failed to list session files for agent ${agentId}:`, error.message);
    return;
  }
  if (files && files.length > 0) {
    const paths = files.map(f => `${agentId}/${f.name}`);
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove(paths);
    if (rmErr) console.error(`Failed to delete session for agent ${agentId}:`, rmErr.message);
  }
  console.log(`Session deleted from Supabase Storage for agent ${agentId}`);
}

module.exports = { ensureBucket, uploadSession, downloadSession, deleteSession };
