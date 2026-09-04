'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'data', 'qa-screenshots');
const qaStorageDir = path.join(root, `.qa-storage-visual-${process.pid}`);
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
if (!chromePath) throw new Error('Chrome or Edge was not found for visual QA.');

main().catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  // Use the synthetic process map for visual QA; functional web QA covers JPEG frames.
  setBrowserResearchAdapter(createQaBrowser({ available: false }));
  const server = await startServer({ host: '127.0.0.1', port: 0 });
  const profileDir = path.join(root, '.chrome-qa', `visual-${Date.now()}`);
  fs.mkdirSync(profileDir, { recursive: true });
  const debugPort = 9241;
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

    await setViewport(page, 1440, 900, false);
    await page.send('Page.navigate', { url: server.url });
    await waitForReady(page);
    const initial = await page.eval(pageSummary);
    if (initial.hasHorizontalOverflow || initial.strategyDotText || initial.strategyDescriptionWidth < 220 || (initial.locale === 'pt' && initial.strategyTitle === 'All Videos')) {
      throw new Error(`Desktop composer validation failed: ${JSON.stringify(initial)}`);
    }
    await screenshot(page, 'desktop-initial.png');

    const collapsedSidebar = await page.eval(async () => {
      document.querySelector('#sidebarToggle')?.click();
      await new Promise(resolve => setTimeout(resolve, 650));
      return {
        collapsed: document.body.classList.contains('sidebar-collapsed'),
        width: document.querySelector('#appSidebar')?.getBoundingClientRect().width || 0,
        hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
      };
    });
    if (!collapsedSidebar.collapsed || collapsedSidebar.width > 80 || collapsedSidebar.hasHorizontalOverflow) throw new Error(`Collapsed sidebar validation failed: ${JSON.stringify(collapsedSidebar)}`);
    await screenshot(page, 'desktop-sidebar-collapsed.png');
    await page.eval(() => document.querySelector('#sidebarToggle')?.click());
    await sleep(500);

    await page.eval(() => {
      document.querySelector('#navSettings').click();
      document.querySelector('[data-setting="appearance.theme"] [data-value="dark"]').click();
    });
    await sleep(900);
    await screenshot(page, 'desktop-settings-dark.png');
    await page.eval(() => {
      document.querySelector('[data-settings-section="research"]')?.click();
      document.querySelector('[data-setting-input="research.mode"]').closest('.select-shell').querySelector('.select-trigger').click();
    });
    await sleep(900);
    const controlState = await page.eval(() => {
      const select = document.querySelector('[data-setting-input="research.mode"]');
      const menu = select.closest('.select-shell').querySelector('.select-menu');
      const value = select.closest('.select-shell').querySelector('.select-value');
      const valueStyle = getComputedStyle(value);
      return {
        theme: document.documentElement.dataset.theme,
        motion: document.documentElement.dataset.motion,
        settingsVisible: !document.querySelector('#settingsWorkspace').hidden,
        researchHidden: document.querySelector('#researchWorkspace').hidden && getComputedStyle(document.querySelector('#researchWorkspace')).display === 'none',
        settingsBands: document.querySelectorAll('.settings-band').length,
        saveState: document.querySelector('#saveState')?.dataset.state,
        activeSection: document.querySelector('[data-settings-section].on')?.dataset.settingsSection,
        visiblePanels: [...document.querySelectorAll('.settings-band')].filter(panel => !panel.hidden).length,
        menuVisible: Boolean(menu && !menu.hidden),
        options: menu?.querySelectorAll('.select-option').length || 0,
        value: value?.textContent || '',
        textTransform: valueStyle.textTransform,
        fontFamily: valueStyle.fontFamily,
        hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
      };
    });
    if (controlState.theme !== 'dark' || !controlState.settingsVisible || !controlState.researchHidden || controlState.settingsBands !== 5 || controlState.activeSection !== 'research' || controlState.visiblePanels !== 1 || controlState.saveState !== 'saved' || !controlState.menuVisible || controlState.options !== 4 || controlState.hasHorizontalOverflow) {
      throw new Error(`Liquid controls validation failed: ${JSON.stringify(controlState)}`);
    }
    await screenshot(page, 'desktop-settings-research-dark.png');
    await page.eval(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      document.querySelector('#navResearch').click();
    });

    await page.eval(() => {
      document.querySelector('#keywords').value = 'history documentary';
      document.querySelector('#timeBudget').value = '15m';
      document.querySelector('#mode').value = 'browser';
      document.querySelector('#duration').value = 'long';
      for (const id of ['keywords', 'timeBudget', 'mode', 'duration']) {
        document.querySelector(`#${id}`).dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector(`#${id}`).dispatchEvent(new Event('change', { bubbles: true }));
      }
      document.querySelector('.run-btn').click();
    });

    const run = await waitFor(page, () => {
      const runText = document.querySelector('#runText')?.textContent || '';
      const errors = document.querySelector('#errors')?.textContent || '';
      return {
        done: /Complete|Concluído|failed|Falha/i.test(runText) || Boolean(errors),
        runText,
        errors,
        cards: document.querySelectorAll('.video-card').length,
        resultSub: document.querySelector('#resultSub')?.textContent || '',
        scrollHeight: document.documentElement.scrollHeight,
        viewport: `${window.innerWidth}x${window.innerHeight}`
      };
    }, 90000);

    if (!/Complete|Concluído/i.test(run.runText) || run.errors) {
      throw new Error(`Visual research run failed: ${JSON.stringify(run)}`);
    }
    await page.eval(() => document.querySelector('[data-view="videos"]')?.click());
    const renderedVideos = await waitFor(page, () => ({
      done: document.querySelectorAll('.video-card').length > 0,
      cards: document.querySelectorAll('.video-card').length
    }), 10000);
    if (!renderedVideos.done) throw new Error(`Lazy video grid did not render: ${JSON.stringify(renderedVideos)}`);
    const thumbnails = await waitForThumbnails(page);
    await screenshot(page, 'desktop-results.png');

    const channelWorkspace = await page.eval(async () => {
      document.querySelector('#facelessMode').value = 'all';
      document.querySelector('#facelessMode').dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('[data-view="channels"]')?.click();
      await new Promise(resolve => setTimeout(resolve, 500));
      const card = document.querySelector('#channelGrid .channel-card-modern');
      card?.scrollIntoView({ block: 'start' });
      window.scrollBy(0, -86);
      const cover = card?.querySelector('.channel-cover');
      return {
        cards: document.querySelectorAll('#channelGrid .channel-card-modern').length,
        coverWidth: cover?.getBoundingClientRect().width || 0,
        coverHeight: cover?.getBoundingClientRect().height || 0,
        avatars: document.querySelectorAll('#channelGrid .channel-avatar').length,
        metricGroups: document.querySelectorAll('#channelGrid .channel-metrics').length,
        hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
      };
    });
    if (channelWorkspace.cards < 1 || channelWorkspace.avatars < 1 || channelWorkspace.metricGroups < 1 || channelWorkspace.coverWidth / Math.max(channelWorkspace.coverHeight, 1) < 1.7 || channelWorkspace.hasHorizontalOverflow) {
      throw new Error(`Modern channel grid validation failed: ${JSON.stringify(channelWorkspace)}`);
    }
    await screenshot(page, 'desktop-channels-modern.png');
    await page.eval(() => document.querySelector('#channelGrid [data-channel-detail]')?.click());
    const channelDetail = await waitFor(page, () => ({
      done: document.querySelector('#channelDetailLayer')?.classList.contains('open') && !document.querySelector('#channelDetailLoading')?.hidden === false,
      open: document.querySelector('#channelDetailLayer')?.classList.contains('open'),
      title: document.querySelector('.channel-detail-title h2')?.textContent || '',
      uploads: document.querySelectorAll('.channel-upload').length,
      width: document.querySelector('#channelDetail')?.getBoundingClientRect().width || 0
    }), 10000);
    if (!channelDetail.open || !channelDetail.title || channelDetail.width < 500) throw new Error(`Channel detail validation failed: ${JSON.stringify(channelDetail)}`);
    await screenshot(page, 'desktop-channel-detail.png');
    await page.eval(() => document.querySelector('[data-detail-close]')?.click());
    await sleep(350);

    await page.eval(() => {
      window.scrollTo(0, 0);
      document.querySelector('#navOpportunities')?.click();
      document.querySelector('[data-opportunity-view="review"]')?.click();
    });
    const opportunities = await waitFor(page, () => ({
      done: document.querySelectorAll('#opportunitiesGrid .channel-card-modern').length > 0,
      cards: document.querySelectorAll('#opportunitiesGrid .channel-card-modern').length,
      summary: document.querySelectorAll('#opportunitiesSummary > div').length,
      formats: document.querySelectorAll('#opportunityFormatMap .format-map-item').length,
      visible: !document.querySelector('#opportunitiesWorkspace')?.hidden,
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
    }), 10000);
    if (!opportunities.visible || opportunities.cards < 1 || opportunities.summary !== 5 || opportunities.formats < 1 || opportunities.hasHorizontalOverflow) {
      throw new Error(`Opportunities workspace validation failed: ${JSON.stringify(opportunities)}`);
    }
    await screenshot(page, 'desktop-opportunities.png');
    await page.eval(() => document.querySelector('#navResearch')?.click());
    await sleep(300);

    const livePanel = await page.eval(() => ({
      visible: !document.querySelector('#liveResearchPanel')?.hidden,
      tasks: document.querySelectorAll('#liveTaskTree .live-task-row').length,
      phase: document.querySelector('#livePhase')?.textContent || '',
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
    }));
    if (!livePanel.visible || livePanel.tasks < 1 || livePanel.hasHorizontalOverflow) {
      throw new Error(`Live activity panel validation failed: ${JSON.stringify(livePanel)}`);
    }
    await page.eval(() => document.querySelector('#openLiveComputerBtn')?.click());
    await sleep(1000);
    const desktopViewer = await page.eval(liveComputerSummary);
    if (!desktopViewer.visible || !desktopViewer.synthetic || desktopViewer.width < 700 || desktopViewer.hasHorizontalOverflow) {
      throw new Error(`Desktop live computer validation failed: ${JSON.stringify(desktopViewer)}`);
    }
    await screenshot(page, 'desktop-live-computer.png');
    await page.eval(() => document.querySelector('#minimizeComputerBtn')?.click());
    await sleep(350);
    const minimizedViewer = await page.eval(liveComputerSummary);
    if (!minimizedViewer.minimized || minimizedViewer.height > 80) {
      throw new Error(`Minimized live computer validation failed: ${JSON.stringify(minimizedViewer)}`);
    }
    await screenshot(page, 'desktop-live-computer-minimized.png');
    await page.eval(() => document.querySelector('#minimizeComputerBtn')?.click());
    await sleep(250);

    // Responsive layout is CSS-driven. Switching mobile emulation after the
    // popup is mounted changes Chromium's layout scale without a navigation.
    await setViewport(page, 390, 844, false);
    await sleep(500);
    const mobileViewer = await page.eval(liveComputerSummary);
    if (!mobileViewer.visible || mobileViewer.width > 390 || mobileViewer.right > 391 || mobileViewer.bottom > 845 || mobileViewer.hasHorizontalOverflow) {
      throw new Error(`Mobile live computer overflow detected: ${JSON.stringify(mobileViewer)}`);
    }
    await screenshot(page, 'mobile-live-computer.png');
    await page.eval(() => document.querySelector('#hideComputerBtn')?.click());
    await page.send('Page.navigate', { url: server.url });
    await waitForReady(page);
    const mobile = await page.eval(pageSummary);
    if (mobile.hasHorizontalOverflow) throw new Error(`Mobile overflow detected: ${JSON.stringify(mobile)}`);
    await screenshot(page, 'mobile-initial.png');
    await page.eval(() => document.querySelector('#navSettings').click());
    await sleep(300);
    const mobileSettings = await page.eval(() => ({
      visible: !document.querySelector('#settingsWorkspace').hidden,
      bands: document.querySelectorAll('.settings-band').length,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
    }));
    if (mobileSettings.hasHorizontalOverflow) throw new Error(`Mobile settings overflow detected: ${JSON.stringify(mobileSettings)}`);
    await screenshot(page, 'mobile-settings.png');
    await page.eval(async () => {
      document.querySelector('#navResearch')?.click();
      document.querySelector('.session-btn')?.click();
      await new Promise(resolve => setTimeout(resolve, 900));
      document.querySelector('#facelessMode').value = 'all';
      document.querySelector('#facelessMode').dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('[data-view="channels"]')?.click();
      window.scrollTo(0, document.querySelector('#channelGrid')?.offsetTop - 80);
    });
    const mobileChannels = await page.eval(() => ({
      cards: document.querySelectorAll('#channelGrid .channel-card-modern').length,
      cardWidth: document.querySelector('#channelGrid .channel-card-modern')?.getBoundingClientRect().width || 0,
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
    }));
    if (mobileChannels.cards < 1 || mobileChannels.cardWidth > 390 || mobileChannels.hasHorizontalOverflow) throw new Error(`Mobile channel grid failed: ${JSON.stringify(mobileChannels)}`);
    await screenshot(page, 'mobile-channels-modern.png');
    await page.eval(() => {
      window.scrollTo(0, 0);
      document.querySelector('#navOpportunities')?.click();
      document.querySelector('[data-opportunity-view="review"]')?.click();
    });
    const mobileOpportunities = await waitFor(page, () => ({
      done: document.querySelectorAll('#opportunitiesGrid .channel-card-modern').length > 0,
      cards: document.querySelectorAll('#opportunitiesGrid .channel-card-modern').length,
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
    }), 10000);
    if (mobileOpportunities.hasHorizontalOverflow) throw new Error(`Mobile opportunities overflow: ${JSON.stringify(mobileOpportunities)}`);
    await screenshot(page, 'mobile-opportunities.png');

    console.log(JSON.stringify({
      ok: true,
      initial,
      collapsedSidebar,
      controlState,
      run,
      thumbnails,
      channelWorkspace,
      channelDetail,
      opportunities,
      livePanel,
      desktopViewer,
      minimizedViewer,
      mobileViewer,
      mobile,
      mobileSettings,
      mobileChannels,
      mobileOpportunities,
      screenshots: [
        path.join(outDir, 'desktop-initial.png'),
        path.join(outDir, 'desktop-sidebar-collapsed.png'),
        path.join(outDir, 'desktop-settings-dark.png'),
        path.join(outDir, 'desktop-settings-research-dark.png'),
        path.join(outDir, 'desktop-results.png'),
        path.join(outDir, 'desktop-channels-modern.png'),
        path.join(outDir, 'desktop-channel-detail.png'),
        path.join(outDir, 'desktop-opportunities.png'),
        path.join(outDir, 'desktop-live-computer.png'),
        path.join(outDir, 'desktop-live-computer-minimized.png'),
        path.join(outDir, 'mobile-live-computer.png'),
        path.join(outDir, 'mobile-initial.png'),
        path.join(outDir, 'mobile-settings.png'),
        path.join(outDir, 'mobile-channels-modern.png'),
        path.join(outDir, 'mobile-opportunities.png')
      ]
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
    await removeWithRetry(profileDir);
    await removeWithRetry(qaStorageDir);
  }
}

async function removeWithRetry(target) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error.code)) throw error;
      if (attempt === 7) {
        console.warn(`QA cleanup deferred: ${target}`);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
}

async function waitForReady(page) {
  await waitFor(page, () => ({
    done: document.querySelectorAll('.preset-btn').length >= 8,
    presetCount: document.querySelectorAll('.preset-btn').length,
    title: document.title
  }), 12000);
}

async function waitForThumbnails(page) {
  try {
    return await waitFor(page, () => {
      const images = [...document.querySelectorAll('.thumb img')].slice(0, 6);
      const loaded = images.filter(img => img.complete && img.naturalWidth > 0).length;
      const missing = images.filter(img => img.closest('.thumb')?.classList.contains('missing')).length;
      return {
        done: images.length > 0 && loaded + missing >= Math.min(3, images.length),
        total: images.length,
        loaded,
        missing
      };
    }, 15000);
  } catch (err) {
    return { warning: err && err.message ? err.message : String(err) };
  }
}

function pageSummary() {
  const strategyDescription = document.querySelector('#presetStrategy > div > span');
  return {
    title: document.title,
    locale: document.documentElement.lang,
    theme: document.documentElement.dataset.theme,
    h1: document.querySelector('h1')?.textContent || '',
    presetCount: document.querySelectorAll('.preset-btn').length,
    cards: document.querySelectorAll('.video-card').length,
    canvas: Boolean(document.querySelector('#cv')),
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    strategyDotText: document.querySelector('.preset-strategy-dot')?.textContent || '',
    strategyTitle: document.querySelector('#presetStrategy b')?.textContent || '',
    strategyDescriptionWidth: Math.round(strategyDescription?.getBoundingClientRect().width || 0),
    hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
  };
}

function liveComputerSummary() {
  const layer = document.querySelector('#liveComputerLayer');
  const popup = document.querySelector('#liveComputer');
  const synthetic = document.querySelector('#syntheticComputer');
  const rect = popup?.getBoundingClientRect();
  return {
    visible: Boolean(layer && !layer.hidden && popup),
    minimized: popup?.classList.contains('minimized') || false,
    synthetic: Boolean(synthetic && !synthetic.hidden),
    width: Math.round(rect?.width || 0),
    height: Math.round(rect?.height || 0),
    right: Math.round(rect?.right || 0),
    bottom: Math.round(rect?.bottom || 0),
    hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
  };
}

async function setViewport(page, width, height, mobile) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile
  });
}

async function screenshot(page, name) {
  const result = await page.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false
  });
  fs.writeFileSync(path.join(outDir, name), Buffer.from(result.data, 'base64'));
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
