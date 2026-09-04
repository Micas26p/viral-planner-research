'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const qaStorage = path.join(root, '.qa-storage-profiles');
process.env.VPR_DATA_DIR = path.join(qaStorage, 'data');
process.env.YOUTUBE_API_KEYS = '';
process.env.GEMINI_API_KEYS = '';
process.env.VPR_DISABLE_API_KEYS = '1';

const { startServer } = require('../server');

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});

async function main() {
  const server = await startServer({ host: '127.0.0.1', port: 0 });
  try {
    // 1. Fetch profiles list
    const res = await fetch(`${server.url}/api/research/browser/profiles`);
    assert.equal(res.status, 200, 'Profiles endpoint returned non-200');
    const data = await res.json();
    assert.equal(Array.isArray(data.profiles), true, 'Profiles is not an array');
    
    const anon = data.profiles.find(p => p.id === 'anonymous');
    const p1 = data.profiles.find(p => p.id === 'profile-1');
    const p2 = data.profiles.find(p => p.id === 'profile-2');

    assert.ok(anon, 'Anonymous profile missing');
    assert.ok(p1, 'Profile 1 missing');
    assert.ok(p2, 'Profile 2 missing');

    assert.equal(anon.partition, '');
    assert.equal(p1.partition, 'persist:vpr-profile-1');
    assert.equal(p2.partition, 'persist:vpr-profile-2');

    // 2. Update profile 1 label and niche
    const saveRes = await fetch(`${server.url}/api/research/browser/profiles/profile-1/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'História Medieval Warmed', niche: 'Documentários Históricos' })
    });
    assert.equal(saveRes.status, 200);
    const savedData = await saveRes.json();
    assert.equal(savedData.profile.label, 'História Medieval Warmed');
    assert.equal(savedData.profile.niche, 'Documentários Históricos');

    // 3. Verify updated profile persists on re-fetch
    const reRes = await fetch(`${server.url}/api/research/browser/profiles`);
    const reData = await reRes.json();
    const updatedP1 = reData.profiles.find(p => p.id === 'profile-1');
    assert.equal(updatedP1.label, 'História Medieval Warmed');
    assert.equal(updatedP1.niche, 'Documentários Históricos');

    // 4. Verify all_profiles enqueuing and sanitize logic
    const { sanitizeResearchBody } = require('../server').__test;
    const multiBody = sanitizeResearchBody({
      mode: 'browser',
      profileId: 'all_profiles',
      scrapeHomeFeed: true
    });
    assert.equal(multiBody.profileId, 'all_profiles');

    console.log('Warmed profiles QA passed successfully.');
  } finally {
    server.close();
    try { fs.rmSync(qaStorage, { recursive: true, force: true }); } catch {}
  }
}
