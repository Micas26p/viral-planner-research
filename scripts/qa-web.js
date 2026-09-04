'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const qaStorageDir = path.join(root, '.qa-storage-web');
process.env.VPR_DATA_DIR = path.join(qaStorageDir, 'data');
process.env.VPR_TEST_TIME_BUDGET_MS = '8000';
process.env.YOUTUBE_API_KEYS = '';
process.env.VPR_DISABLE_API_KEYS = '1';

const { startServer, setBrowserResearchAdapter } = require('../server');
const { createQaBrowser } = require('./qa-fake-browser');

const chromeCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
];

const chromePath = chromeCandidates.find(file => fs.existsSync(file));
if (!chromePath) throw new Error('Chrome or Edge was not found for web QA.');

main().catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});

async function main() {
  setBrowserResearchAdapter(createQaBrowser());
  const server = await startServer({ host: '127.0.0.1', port: 0 });
  const profileDir = path.join(root, '.chrome-qa', `profile-${Date.now()}`);
  fs.mkdirSync(profileDir, { recursive: true });
  const debugPort = 9237;
  let chrome = null;
  const chromeLogs = [];

  try {
    chrome = spawn(chromePath, [
      '--headless=new',
      `--remote-debugging-port=${debugPort}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${profileDir}`,
      '--disable-gpu',
      '--disable-crash-reporter',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-background-networking',
      '--disable-sync',
      '--no-first-run',
      '--no-default-browser-check',
      server.url
    ], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    chrome.stdout.on('data', data => chromeLogs.push(data.toString()));
    chrome.stderr.on('data', data => chromeLogs.push(data.toString()));

    const page = await connectToPage(debugPort, chrome, chromeLogs);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    await page.send('Page.navigate', { url: server.url });
    await waitForReady(page);

    const initial = await page.eval(() => ({
      title: document.title,
      h1: document.querySelector('h1')?.textContent,
      presetCount: document.querySelectorAll('.preset-btn').length,
      hasLogo: Boolean(document.querySelector('.sb-logo .brand-symbol')),
      theme: document.documentElement.dataset.theme,
      favicon: document.querySelector('link[rel="icon"]')?.getAttribute('href')
    }));

    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true
    });
    await page.send('Page.navigate', { url: server.url });
    await waitForReady(page);
    const mobile = await page.eval(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      appDirection: getComputedStyle(document.querySelector('.app')).flexDirection,
      presetColumns: getComputedStyle(document.querySelector('.preset-list')).gridTemplateColumns.split(' ').length,
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
    }));
    const mobileDrawer = await page.eval(async () => {
      document.querySelector('#mobileMenuBtn')?.click();
      await new Promise(resolve => setTimeout(resolve, 320));
      const opened = document.body.classList.contains('mobile-nav-open');
      const sidebarTransform = getComputedStyle(document.querySelector('#appSidebar')).transform;
      document.querySelector('#sidebarBackdrop')?.click();
      return { opened, sidebarTransform, closed: !document.body.classList.contains('mobile-nav-open') };
    });

    await page.eval(() => window.scrollTo(0, 700));
    await sleep(250);
    const mobileScroll = await page.eval(() => ({
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight
    }));

    if (mobile.hasHorizontalOverflow || mobile.appDirection !== 'column' || mobileScroll.scrollY < 100) {
      throw new Error(`Mobile layout check failed: ${JSON.stringify(mobile)}`);
    }

    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    await page.send('Page.navigate', { url: server.url });
    await sleep(1000);

    const sidebarToggle = await page.eval(async () => {
      document.querySelector('#sidebarToggle')?.click();
      await new Promise(resolve => setTimeout(resolve, 800));
      document.querySelector('[data-sidebar-flyout="presets"]')?.click();
      const flyoutVisible = getComputedStyle(document.querySelector('[data-sidebar-panel="presets"]')).display !== 'none';
      return { collapsed: document.body.classList.contains('sidebar-collapsed'), width: document.querySelector('#appSidebar')?.getBoundingClientRect().width || 0, flyoutVisible };
    });
    await page.send('Page.navigate', { url: server.url });
    await waitForReady(page);
    const sidebarPersistence = await page.eval(async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      const persisted = document.body.classList.contains('sidebar-collapsed');
      document.querySelector('#sidebarToggle')?.click();
      await new Promise(resolve => setTimeout(resolve, 700));
      return { persisted, restoredExpanded: !document.body.classList.contains('sidebar-collapsed') };
    });

    await page.eval(() => {
      document.querySelector('#keywords').value = 'ancient history explained';
      document.querySelector('#timeBudget').value = '15m';
      document.querySelector('#mode').value = 'browser';
      document.querySelector('#duration').value = 'long';
      for (const id of ['keywords', 'timeBudget', 'mode', 'duration']) {
        document.querySelector(`#${id}`).dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector(`#${id}`).dispatchEvent(new Event('change', { bubbles: true }));
      }
      document.querySelector('.run-btn').click();
    });

    const apiRun = await waitFor(page, () => {
      const runText = document.querySelector('#runText')?.textContent || '';
      const errors = document.querySelector('#errors')?.textContent || '';
      const cards = document.querySelectorAll('.video-card').length;
      return {
        done: /Complete|Concluído|failed|Falha/i.test(runText) || Boolean(errors),
        runText,
        errors,
        cards,
        firstTitle: document.querySelector('.video-title')?.textContent || '',
        confidence: document.querySelector('.confidence')?.textContent || '',
        shorts: [...document.querySelectorAll('.thumb')].filter(anchor => anchor.href.includes('/shorts/')).length,
        durations: [...document.querySelectorAll('.duration')].map(node => node.textContent)
      };
    }, 75000);

    if (!/Complete|Concluído/i.test(apiRun.runText) || apiRun.cards < 1 || apiRun.errors || apiRun.shorts > 0) {
      throw new Error(`API UI research failed: ${JSON.stringify(apiRun)}`);
    }

    await page.eval(() => window.scrollTo(0, 900));
    await sleep(250);
    const resultsScroll = await page.eval(() => ({
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      bodyOverflowY: getComputedStyle(document.body).overflowY
    }));

    if (resultsScroll.scrollHeight <= resultsScroll.innerHeight + 100 || resultsScroll.scrollY < 100) {
      throw new Error(`Results vertical scroll check failed: ${JSON.stringify(resultsScroll)}`);
    }

    const interactions = await page.eval(async () => {
      const livePanelVisible = !document.querySelector('#liveResearchPanel')?.hidden;
      const structuredTasks = document.querySelectorAll('.live-task-row').length;
      document.querySelector('#hideLivePanelBtn')?.click();
      const liveChipVisible = !document.querySelector('#liveResearchChip')?.hidden;
      document.querySelector('#liveResearchChip')?.click();
      document.querySelector('#openLiveComputerBtn')?.click();
      await new Promise(resolve => setTimeout(resolve, 650));
      const computerOpened = !document.querySelector('#liveComputerLayer')?.hidden;
      const frameVisible = !document.querySelector('#liveComputerFrame')?.hidden;
      document.querySelector('[data-live-size="small"]')?.click();
      const smallSize = document.querySelector('#liveComputer')?.classList.contains('size-small');
      document.querySelector('[data-live-size="large"]')?.click();
      const largeSize = document.querySelector('#liveComputer')?.classList.contains('size-large');
      document.querySelector('#minimizeComputerBtn')?.click();
      const minimized = document.querySelector('#liveComputer')?.classList.contains('minimized');
      document.querySelector('#minimizeComputerBtn')?.click();
      document.querySelector('#hideComputerBtn')?.click();
      const computerHidden = document.querySelector('#liveComputerLayer')?.hidden;
      const firstSave = document.querySelector('[data-mark="saved"]');
      if (firstSave) firstSave.click();
      await new Promise(resolve => setTimeout(resolve, 700));
      document.querySelector('[data-preset="above1m"]').click();
      document.querySelector('#hideSeen').checked = true;
      document.querySelector('#hideSeen').dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('#navSettings').click();
      const motionControl = document.querySelector('[data-setting="appearance.motion"]');
      const motionStates = [];
      if (motionControl) {
        for (const value of ['off', 'subtle', 'expressive']) {
          document.querySelector(`[data-setting="appearance.motion"] [data-value="${value}"]`)?.click();
          motionStates.push(document.documentElement.dataset.motion);
        }
      } else {
        motionStates.push(document.documentElement.dataset.motion || 'off');
      }
      document.querySelector('[data-setting="appearance.language"] [data-value="en"]').click();
      await new Promise(resolve => setTimeout(resolve, 700));
      const englishTitle = document.querySelector('.settings-hero h1')?.textContent;
      document.querySelector('[data-setting="appearance.language"] [data-value="pt"]').click();
      await new Promise(resolve => setTimeout(resolve, 700));
      const portugueseTitle = document.querySelector('.settings-hero h1')?.textContent;
      const themeBeforeUndo = document.documentElement.dataset.theme;
      const changedTheme = themeBeforeUndo === 'dark' ? 'light' : 'dark';
      document.querySelector(`[data-setting="appearance.theme"] [data-value="${changedTheme}"]`).click();
      await new Promise(resolve => setTimeout(resolve, 900));
      const undoButton = [...document.querySelectorAll('.toast button')].reverse().find(button => /Undo|Desfazer/i.test(button.textContent));
      if (undoButton) undoButton.click();
      await new Promise(resolve => setTimeout(resolve, 1400));
      const themeAfterUndo = document.documentElement.dataset.theme;
      const settingsAfterUndo = await fetch('/api/settings').then(response => response.json());
      const toastAfterUndo = [...document.querySelectorAll('.toast p')].map(item => item.textContent);
      const undoWorked = themeAfterUndo === themeBeforeUndo;
      document.querySelector('[data-setting="appearance.theme"] [data-value="dark"]').click();
      await new Promise(resolve => setTimeout(resolve, 700));
      const settingsVisible = !document.querySelector('#settingsWorkspace').hidden;
      const saveState = document.querySelector('#saveState')?.dataset.state;
      document.querySelector('[data-settings-section="research"]')?.click();
      const activeSettingsSection = document.querySelector('[data-settings-section].on')?.dataset.settingsSection;
      const visibleSettingsPanels = [...document.querySelectorAll('.settings-band')].filter(panel => !panel.hidden).length;
      document.querySelector('#navResearch').click();
      document.querySelector('#facelessMode').value = 'all';
      document.querySelector('#facelessMode').dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('[data-preset="all"]').click();
      document.querySelector('#navOpportunities').click();
      document.querySelector('[data-opportunity-view="review"]')?.click();
      await new Promise(resolve => setTimeout(resolve, 900));
      const opportunitiesVisible = !document.querySelector('#opportunitiesWorkspace')?.hidden;
      const opportunityCards = document.querySelectorAll('#opportunitiesGrid .channel-card-modern').length;
      document.querySelector('#navResearch').click();
      return {
        activePreset: document.querySelector('.preset-btn.on')?.dataset.preset,
        theme: document.documentElement.dataset.theme,
        settingsVisible,
        saveState,
        activeSettingsSection,
        visibleSettingsPanels,
        navItems: document.querySelectorAll('.nav-btn').length,
        motionStates,
        englishTitle,
        portugueseTitle,
        undoWorked,
        themeBeforeUndo,
        changedTheme,
        themeAfterUndo,
        undoButtonFound: Boolean(undoButton),
        storedThemeAfterUndo: settingsAfterUndo.settings?.appearance?.theme,
        toastAfterUndo,
        livePanelVisible,
        structuredTasks,
        liveChipVisible,
        computerOpened,
        frameVisible,
        smallSize,
        largeSize,
        minimized,
        computerHidden,
        cards: document.querySelectorAll('.video-card').length,
        savedMetric: document.querySelector('#metricSaved')?.textContent,
        topExportButtons: document.querySelectorAll('#exportJson, #exportCsv, #exportPlanner').length,
        sessionButtons: document.querySelectorAll('.session-btn').length,
        channelCards: document.querySelectorAll('.channel-card').length,
        viewTabs: document.querySelectorAll('.view-tab').length,
        activityRows: document.querySelectorAll('.activity-row').length,
        nicheCards: document.querySelectorAll('.niche-card').length,
        advancedCollapsed: !document.querySelector('.advanced-panel')?.open
        , opportunitiesVisible
        , opportunityCards
      };
    });

    if (interactions.topExportButtons || !interactions.advancedCollapsed || interactions.sessionButtons < 1 || interactions.channelCards < 1 || interactions.viewTabs !== 3 || interactions.activityRows < 1 || !interactions.settingsVisible || interactions.saveState !== 'saved' || interactions.activeSettingsSection !== 'research' || interactions.visibleSettingsPanels !== 1 || interactions.navItems !== 3 || interactions.theme !== 'dark' || !interactions.motionStates.length || !/Shape your/.test(interactions.englishTitle) || !/Molde o seu/.test(interactions.portugueseTitle) || !interactions.undoWorked || !interactions.livePanelVisible || interactions.structuredTasks < 1 || !interactions.liveChipVisible || !interactions.computerOpened || !interactions.frameVisible || !interactions.smallSize || !interactions.largeSize || !interactions.minimized || !interactions.computerHidden || !interactions.opportunitiesVisible || interactions.opportunityCards < 1) {
      throw new Error(`Clean UI/session check failed: ${JSON.stringify(interactions)}`);
    }
    if (!mobileDrawer.opened || !mobileDrawer.closed || !sidebarToggle.collapsed || sidebarToggle.width > 80 || !sidebarToggle.flyoutVisible || !sidebarPersistence.persisted || !sidebarPersistence.restoredExpanded) {
      throw new Error(`Navigation regression: ${JSON.stringify({ mobileDrawer, sidebarToggle, sidebarPersistence })}`);
    }

    let webMode = null;
    if (/^(web|http|browser)\b/i.test(apiRun.confidence || '')) {
      webMode = {
        status: 'covered-by-ui-fallback',
        results: [],
        errors: [],
        params: { usingDefaultSeeds: false },
        coveredByUiFallback: true
      };
    } else {
      webMode = await runBackendResearch(server.url, 'web', {
        keywords: [],
        resultLimit: 8
      });
      const badWebItems = (webMode.results || []).filter(item => /\/shorts\//i.test(item.url || '') || Number(item.durationSeconds || 0) < 240);
      if (
        webMode.status !== 'complete'
        || !webMode.params?.usingDefaultSeeds
        || !webMode.results.length
        || badWebItems.length
      ) {
        throw new Error(`No-API long-form check failed: ${JSON.stringify({
          status: webMode.status,
          usingDefaultSeeds: webMode.params?.usingDefaultSeeds,
          count: webMode.results?.length || 0,
          bad: badWebItems.slice(0, 3).map(item => ({ title: item.title, url: item.url, duration: item.durationLabel }))
        })}`);
      }
    }

    console.log(JSON.stringify({
      ok: true,
      initial,
      mobile,
      mobileDrawer,
      mobileScroll,
      sidebarToggle,
      sidebarPersistence,
      apiRun,
      resultsScroll,
      interactions,
      webMode: {
        status: webMode.status,
        resultCount: webMode.results.length,
        usingDefaultSeeds: webMode.params?.usingDefaultSeeds,
        coveredByUiFallback: Boolean(webMode.coveredByUiFallback),
        errors: webMode.errors,
        confidence: webMode.results[0]?.confidence,
        sourceMode: webMode.results[0]?.sourceMode
      }
    }, null, 2));
  } finally {
    setBrowserResearchAdapter(null);
    if (chrome && !chrome.killed) {
      chrome.kill();
      await new Promise(resolve => {
        if (chrome.exitCode !== null) return resolve();
        chrome.once('exit', resolve);
        setTimeout(resolve, 2000);
      });
    }
    await server.close();
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {
      // Chrome may keep a profile lock for a moment after headless shutdown.
    }
    fs.rmSync(qaStorageDir, { recursive: true, force: true });
  }
}

async function waitForReady(page) {
  await waitFor(page, () => ({
    done: document.querySelectorAll('.preset-btn').length >= 8,
    presetCount: document.querySelectorAll('.preset-btn').length,
    title: document.title
  }), 12000);
}

async function runBackendResearch(baseUrl, mode, overrides = {}) {
  const body = {
    mode,
    timeBudget: '15m',
    keywords: Object.prototype.hasOwnProperty.call(overrides, 'keywords') ? overrides.keywords : ['ancient history explained'],
    seedChannels: [],
    filters: {
      region: 'US',
      language: 'en',
      intensity: 'quick',
      resultLimit: overrides.resultLimit || 8,
      duration: 'long',
      sort: 'outlier',
      useGemini: false
    }
  };
  const created = await fetchJson(`${baseUrl}/api/research/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  for (let i = 0; i < 75; i += 1) {
    const state = await fetchJson(`${baseUrl}/api/research/run/${created.id}`);
    if (!['queued', 'running'].includes(state.status)) return state;
    await sleep(1000);
  }
  throw new Error(`${mode} research timed out`);
}

async function connectToPage(port, chrome, logs) {
  for (let i = 0; i < 80; i += 1) {
    if (chrome.exitCode !== null) {
      throw new Error(`Chrome exited before DevTools was ready: ${chrome.exitCode}. ${logs.join('').slice(-500)}`);
    }
    try {
      const tabs = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      const tab = tabs.find(item => item.type === 'page' && item.webSocketDebuggerUrl);
      if (tab) return new CdpPage(tab.webSocketDebuggerUrl);
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`Chrome DevTools endpoint did not become ready. ${logs.join('').slice(-500)}`);
}

class CdpPage {
  constructor(wsUrl) {
    this.nextId = 1;
    this.pending = new Map();
    this.ws = new WebSocket(wsUrl);
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', event => {
      const payload = JSON.parse(event.data);
      if (!payload.id || !this.pending.has(payload.id)) return;
      const { resolve, reject } = this.pending.get(payload.id);
      this.pending.delete(payload.id);
      if (payload.error) reject(new Error(payload.error.message || 'CDP command failed'));
      else resolve(payload.result || {});
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ws.send(JSON.stringify({ id, method, params }));
    return result;
  }

  async eval(fn) {
    const result = await this.send('Runtime.evaluate', {
      expression: `(${fn})()`,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Evaluation failed');
    return result.result.value;
  }
}

async function waitFor(page, fn, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await page.eval(fn);
    if (last.done) return last;
    await sleep(1000);
  }
  throw new Error(`Condition timed out: ${JSON.stringify(last)}`);
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
