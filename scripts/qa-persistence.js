'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ResearchStore } = require('../lib/research-store');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vpr-persistence-'));

try {
  let store = new ResearchStore(dataDir);
  const origin = Date.now() - 60 * 60000;
  for (let index = 0; index < 55; index += 1) {
    const updatedAt = new Date(origin + index * 60000).toISOString();
    store.saveSession({
      id: `session-${String(index).padStart(2, '0')}`,
      name: `Session ${index}`,
      createdAt: updatedAt,
      updatedAt,
      completedAt: '',
      status: index === 54 ? 'running' : 'complete',
      progress: index === 54 ? 47 : 100,
      results: index === 54 ? [{ videoId: 'partial-video', channelId: 'partial-channel' }] : []
    });
  }
  store.saveSession({
    ...store.getSession('session-54'),
    status: 'paused',
    message: 'Paused safely when the application closed',
    updatedAt: new Date(origin + 56 * 60000).toISOString()
  });
  store.close();

  store = new ResearchStore(dataDir);
  const restored = store.getSession('session-54');
  assert.equal(restored.status, 'paused');
  assert.equal(restored.progress, 47);
  assert.equal(restored.results[0].videoId, 'partial-video');

  const first = store.listSessionsPage(40);
  assert.equal(first.sessions.length, 40);
  assert.ok(first.nextCursor);
  assert.equal(first.sessions[0].id, 'session-54');

  const second = store.listSessionsPage(40, first.nextCursor);
  assert.equal(second.sessions.length, 15);
  assert.equal(second.nextCursor, '');
  assert.equal(new Set([...first.sessions, ...second.sessions].map(item => item.id)).size, 55);
  store.close();

  console.log(JSON.stringify({ ok: true, restored: restored.id, pages: [first.sessions.length, second.sessions.length] }));
} finally {
  fs.rmSync(dataDir, { recursive: true, force: true });
}
