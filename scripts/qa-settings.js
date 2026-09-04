'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const qaStorage = path.join(root, '.qa-storage-settings');
process.env.VPR_DATA_DIR = path.join(qaStorage, 'data');
process.env.YOUTUBE_API_KEYS = '';
process.env.GEMINI_API_KEYS = '';
process.env.VPR_DISABLE_API_KEYS = '1';
process.env.VPR_DESKTOP = '1';

const { ResearchStore } = require('../lib/research-store');
const { startServer, setDesktopSettingsAdapter } = require('../server');
let appliedDesktop = null;
let openedDataFolder = false;
setDesktopSettingsAdapter({
  capabilities: () => ({ launchAtStartup: true, openDataFolder: true }),
  apply: (desktop, appearance) => { appliedDesktop = { desktop, appearance }; },
  openDataFolder: async () => { openedDataFolder = true; }
});

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});

async function main() {
  const server = await startServer({ host: '127.0.0.1', port: 0 });
  try {
    const initial = await request(server.url, '/api/settings');
    assert.equal(initial.settings.appearance.theme, 'auto');
    assert.equal(initial.settings.appearance.motion, 'expressive');
    assert.equal(initial.settings.appearance.sidebarCollapsed, false);
    assert.equal(initial.settings.research.timeBudget, '2h');

    const saved = await request(server.url, '/api/settings', {
      method: 'PATCH',
      body: { revision: initial.revision, changes: { appearance: { theme: 'dark', language: 'pt', motion: 'subtle', sidebarCollapsed: true }, research: { region: 'PT' }, desktop: { launchAtStartup: true } } }
    });
    assert.equal(saved.settings.appearance.theme, 'dark');
    assert.equal(saved.settings.appearance.language, 'pt');
    assert.equal(saved.settings.appearance.sidebarCollapsed, true);
    assert.equal(saved.settings.research.region, 'PT');
    assert.equal(appliedDesktop.desktop.launchAtStartup, true);
    assert.equal(appliedDesktop.appearance.language, 'pt');
    assert.equal(saved.revision, initial.revision + 1);

    const conflict = await request(server.url, '/api/settings', {
      method: 'PATCH', body: { revision: initial.revision, changes: { appearance: { theme: 'light' } } }, allowError: true
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.payload.settings.appearance.theme, 'dark');

    const exported = await fetch(`${server.url}/api/settings/export`);
    const exportText = await exported.text();
    assert.equal(exported.ok, true);
    assert.equal(exportText.includes('API_KEYS'), false);
    assert.equal(exportText.includes('AIza'), false);
    assert.equal(JSON.parse(exportText).settings.appearance.language, 'pt');

    const storage = await request(server.url, '/api/settings/storage');
    assert.equal(typeof storage.databaseBytes, 'number');
    const cleared = await request(server.url, '/api/settings/storage/clear', { method: 'POST', body: { target: 'cache' } });
    assert.equal(cleared.ok, true);

    const reset = await request(server.url, '/api/settings/reset', {
      method: 'POST', body: { revision: saved.revision, section: 'appearance' }
    });
    assert.equal(reset.settings.appearance.theme, 'auto');
    assert.equal(reset.settings.appearance.sidebarCollapsed, false);
    assert.equal(reset.settings.research.region, 'PT');

    const unavailable = await request(server.url, '/api/settings/integrations/youtube/test', { method: 'POST', body: {}, allowError: true });
    assert.equal(unavailable.status, 409);
    await request(server.url, '/api/settings/desktop/open-data', { method: 'POST', body: {} });
    assert.equal(openedDataFolder, true);

    console.log(JSON.stringify({ ok: true, initialRevision: initial.revision, savedRevision: saved.revision, resetRevision: reset.revision, storage }, null, 2));
  } finally {
    await server.close();
    const reopened = new ResearchStore(process.env.VPR_DATA_DIR);
    assert.equal(reopened.settingsProfile().sections.research.region, 'PT');
    reopened.close();
    setDesktopSettingsAdapter(null);
    fs.rmSync(qaStorage, { recursive: true, force: true });
  }
}

async function request(base, pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json();
  if (!response.ok && !options.allowError) throw new Error(`${pathname}: ${payload.error || response.status}`);
  return options.allowError ? { status: response.status, payload } : payload;
}
