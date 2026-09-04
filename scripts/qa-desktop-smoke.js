'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const qaStorage = path.join(root, '.qa-storage', `desktop-qa-${process.pid}`);
const devRuntime = process.env.VPR_QA_DEV === '1';
const exe = devRuntime ? require('electron') : path.join(root, 'Viral Research.exe');
const logFile = path.join(qaStorage, 'data', 'desktop.log');
const liveViewer = process.env.VPR_QA_LIVE_VIEWER === '1';
const realTrail = process.env.VPR_QA_REAL_TRAIL === '1';

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});

async function main() {
  assert.equal(fs.existsSync(exe), true, 'Root desktop executable was not found');
  fs.rmSync(qaStorage, { recursive: true, force: true });
  fs.mkdirSync(path.join(qaStorage, 'data'), { recursive: true });
  const previousSize = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
  const child = spawn(exe, [...(devRuntime ? [root] : [])], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      VPR_BLANK_WINDOW: '1',
      VPR_QA_STORAGE_DIR: qaStorage,
      YOUTUBE_API_KEYS: '',
      GEMINI_API_KEYS: '',
      VPR_DISABLE_API_KEYS: '1',
      VPR_TEST_TIME_BUDGET_MS: realTrail ? '240000' : '25000',
      VPR_AUTONOMOUS_WATCH_SECONDS: realTrail ? '30' : '2',
      ...(liveViewer ? {} : { VPR_VIEWER_SMOKE: '1' })
    }
  });
  const processOutput = [];
  child.stdout.on('data', chunk => processOutput.push(chunk.toString()));
  child.stderr.on('data', chunk => processOutput.push(chunk.toString()));
  try {
    const url = await waitForUrl(previousSize, child);
    let health;
    let settings;
    let browser;
    try {
      [health, settings, browser] = await Promise.all([
        getJson(`${url}/api/health`),
        getJson(`${url}/api/settings`),
        getJson(`${url}/api/research/browser/status`)
      ]);
    } catch (error) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const logTail = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').slice(-1800) : '';
      throw new Error(`${error.message}; desktopExit=${child.exitCode}; output=${processOutput.join('').slice(-1400)}; log=${logTail}`);
    }
    assert.equal(health.ok, true);
    assert.equal(health.desktop, true);
    assert.equal(settings.capabilities.desktop, true);
    assert.equal(settings.capabilities.openDataFolder, true);
    assert.equal(browser.available, true);
    const windowBounds = readWindowBounds();
    assert.equal(windowBounds.width <= windowBounds.workWidth, true, 'Desktop width exceeded the usable display area');
    assert.equal(windowBounds.width / windowBounds.workWidth >= 0.99, true, 'Desktop width did not reach the requested display limit');
    assert.equal(windowBounds.height / windowBounds.workHeight >= 0.94 && windowBounds.height / windowBounds.workHeight <= 0.98, true, 'Desktop height did not remain near 96% of the usable display area');
    let shown;
    try {
      shown = await postJson(`${url}/api/research/browser/viewer/show`, { worker: 0 });
    } catch (error) {
      await new Promise(resolve => setTimeout(resolve, 500));
      throw new Error(`${error.message}; desktopExit=${child.exitCode}; output=${processOutput.join('').slice(-1000)}`);
    }
    assert.equal(shown.ok, true);
    assert.equal(shown.viewer.state, 'preview');
    assert.equal(shown.workers.length >= 1, true);
    const expanded = await postJson(`${url}/api/research/browser/viewer/expand`, { worker: 0 });
    assert.equal(expanded.viewer.state, 'expanded');
    let viewerEvidence;
    try {
      viewerEvidence = await waitForViewerFrame(url);
    } catch (error) {
      const browserDiagnostic = await getJson(`${url}/api/research/browser/status`).catch(diagnosticError => ({ error: diagnosticError.message }));
      const logTail = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').slice(-1800) : '';
      throw new Error(`${error.message}; browser=${JSON.stringify(browserDiagnostic)}; output=${processOutput.join('').slice(-1400)}; log=${logTail}`);
    }
    const viewerEvidenceType = viewerEvidence.headers.get('content-type') || '';
    let viewerEvidenceItems = null;
    assert.match(viewerEvidenceType, /image\/jpeg|application\/json/);
    if (/application\/json/.test(viewerEvidenceType)) {
      const snapshot = await viewerEvidence.clone().json();
      assert.equal(typeof snapshot.url, 'string');
      viewerEvidenceItems = Array.isArray(snapshot.items) ? snapshot.items.length : 0;
    }
    if (liveViewer && /image\/jpeg/.test(viewerEvidenceType)) {
      const screenshotDir = path.join(root, 'data', 'qa-screenshots');
      fs.mkdirSync(screenshotDir, { recursive: true });
      fs.writeFileSync(path.join(screenshotDir, 'desktop-live-real.jpg'), Buffer.from(await viewerEvidence.clone().arrayBuffer()));
      const realBrowserStatus = await getJson(`${url}/api/research/browser/status`);
      const attentionPage = realBrowserStatus.telemetry?.playerState === 'needs_attention' && realBrowserStatus.attention;
      if ((!/^https:\/\/(www\.)?youtube\.com\//.test(realBrowserStatus.lastUrl || '') && !attentionPage) || realBrowserStatus.telemetry?.playerState === 'network_error') {
        throw new Error(`Live viewer did not reach YouTube: ${JSON.stringify(realBrowserStatus)}`);
      }
    }
    let autonomousTrail = null;
    if (!liveViewer || realTrail) {
      const created = await postJson(`${url}/api/research/run`, {
        mode: 'browser',
        timeBudget: '15m',
        keywords: [realTrail ? 'ancient history documentary' : 'fixture faceless documentary'],
        filters: { duration: 'long', intensity: 'quick', resultLimit: 24, region: 'US', language: 'en' }
      });
      const completed = await waitForResearchJob(url, created.id, realTrail ? 285000 : 60000, realTrail);
      if (completed.status === 'needs_attention') {
        const attentionBrowser = await getJson(`${url}/api/research/browser/status`);
        assert.equal(realTrail, true, 'Fixture research unexpectedly requested attention');
        if (!attentionBrowser.attention) {
          throw new Error(`Challenge did not surface as browser attention: ${JSON.stringify({ job: completed.currentOperation, browser: attentionBrowser })}`);
        }
        autonomousTrail = {
          status: 'needs_attention',
          challenge: true,
          playerState: attentionBrowser.telemetry?.playerState,
          safeUrl: attentionBrowser.lastUrl
        };
      } else {
      assert.equal(completed.status, 'complete', `Autonomous fixture ended as ${completed.status}`);
      assert.equal(completed.results.length > 0, true, 'Autonomous browser produced no videos');
      assert.equal(completed.results.every(item => item.durationSeconds >= 240 && !/shorts/i.test(item.url || '')), true, 'Autonomous browser accepted short-form content');
      assert.equal(completed.results.every(item => item.publishedAt && Date.now() - new Date(item.publishedAt).getTime() <= 91 * 86400000), true, 'Autonomous browser accepted a trigger older than 90 days or without a reliable date');
      const storage = await getJson(`${url}/api/settings/storage`);
      assert.equal(storage.watchEvents > 0, true, 'Verified watch event was not persisted');
      if (!storage.verifiedWatchEvents) {
        throw new Error(`No watch reached its full content target: ${JSON.stringify({
          watchEvents: storage.watchEvents,
          bestWatchSeconds: storage.bestWatchSeconds,
          bestWatchTarget: storage.bestWatchTarget,
          bestWatchStatus: storage.bestWatchStatus,
          bestWatchDiagnostic: storage.bestWatchDiagnostic,
          currentOperation: completed.currentOperation,
          errors: completed.errors
        })}`);
      }
      assert.equal(storage.decisions > 0, true, 'Autonomous video decision was not persisted');
      if (realTrail) {
        assert.equal(completed.results.some(item => item.sourceMode === 'browser'), true, 'Real browser research produced no Chromium-sourced result');
      }
      const trailBrowser = await getJson(`${url}/api/research/browser/status`);
      assert.match(trailBrowser.profile?.partition || '', /^persist:vpr-niche-/);
      autonomousTrail = {
        videos: completed.results.length,
        channels: completed.channels.length,
        watchEvents: storage.watchEvents,
        verifiedWatchEvents: storage.verifiedWatchEvents,
        decisions: storage.decisions,
        stopReason: completed.discovery?.stopReason,
        profile: trailBrowser.profile?.id
      };
      }
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
    try {
      assert.equal((await getJson(`${url}/api/health`)).ok, true, 'Desktop process did not survive the internal anonymous viewer');
    } catch (error) {
      await new Promise(resolve => setTimeout(resolve, 500));
      throw new Error(`${error.message}; desktopExit=${child.exitCode}; output=${processOutput.join('').slice(-1200)}`);
    }
    let controlled;
    try {
      controlled = await postJson(`${url}/api/research/browser/viewer/take-control`, { worker: 0 });
    } catch (error) {
      await new Promise(resolve => setTimeout(resolve, 500));
      throw new Error(`${error.message}; desktopExit=${child.exitCode}; output=${processOutput.join('').slice(-1200)}`);
    }
    assert.equal(controlled.controlOwner, 'user');
    const released = await postJson(`${url}/api/research/browser/viewer/release-control`, { worker: 0 });
    assert.equal(released.controlOwner, 'researcher');
    const hidden = await postJson(`${url}/api/research/browser/viewer/hide`, { worker: 0 });
    assert.equal(hidden.viewer.state, 'hidden');
    console.log(JSON.stringify({ ok: true, processAlive: child.exitCode === null, url, desktop: health.desktop, windowBounds, settingsRevision: settings.revision, browserAvailable: browser.available, anonymousViewer: 'embedded-chromium', liveViewer, realTrail, visualEvidence: viewerEvidenceType, visualItems: viewerEvidenceItems, autonomousTrail, localViewer: true, viewerLifecycle: ['preview', 'expanded', 'user-control', 'released', 'hidden'] }, null, 2));
  } finally {
    if (child.exitCode === null) child.kill();
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
    await removeWithRetry(qaStorage);
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

async function waitForUrl(offset, child) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Desktop process exited with code ${child.exitCode}`);
    if (fs.existsSync(logFile)) {
      const log = fs.readFileSync(logFile, 'utf8').slice(offset);
      const matches = [...log.matchAll(/Server ready at (http:\/\/127\.0\.0\.1:\d+)/g)];
      if (matches.length) return matches.at(-1)[1];
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error('Desktop server did not become ready within 30 seconds');
}

function readWindowBounds() {
  const text = fs.readFileSync(logFile, 'utf8');
  const matches = [...text.matchAll(/Main window created\. bounds=(\d+)x(\d+) workArea=(\d+)x(\d+)/g)];
  const match = matches.at(-1);
  if (!match) throw new Error('Desktop window bounds were not logged');
  return { width: Number(match[1]), height: Number(match[2]), workWidth: Number(match[3]), workHeight: Number(match[4]) };
}

async function waitForViewerFrame(baseUrl) {
  const deadline = Date.now() + 20000;
  let lastStatus = 0;
  let lastSnapshotStatus = 0;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/research/browser/frame?worker=0&width=960&quality=55`);
    lastStatus = response.status;
    if (response.status === 200) return response;
    const snapshot = await fetch(`${baseUrl}/api/research/browser/snapshot`);
    lastSnapshotStatus = snapshot.status;
    if (snapshot.status === 200) {
      const data = await snapshot.clone().json().catch(() => ({}));
      if (!liveViewer || (Array.isArray(data.items) && data.items.length > 0)) return snapshot;
    }
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  throw new Error(`Embedded anonymous browser did not provide visual evidence; frame ${lastStatus}, snapshot ${lastSnapshotStatus}`);
}

async function waitForResearchJob(baseUrl, id, timeoutMs, stopOnAttention = false) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await getJson(`${baseUrl}/api/research/run/${encodeURIComponent(id)}`);
    if (['complete', 'cancelled', 'error'].includes(job.status) || (stopOnAttention && job.status === 'needs_attention')) return job;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Research fixture ${id} did not finish in time`);
}

async function getJson(url) {
  let response;
  try { response = await fetch(url); } catch (error) { throw new Error(`${url}: ${error.message}`); }
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

async function postJson(url, payload) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    throw new Error(`${url}: ${error.message}`);
  }
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status} ${await response.text()}`);
  return response.json();
}
