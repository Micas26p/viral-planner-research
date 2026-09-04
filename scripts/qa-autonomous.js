'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const qaRoot = path.join(root, '.qa-storage', 'autonomous-qa');
process.env.VPR_DATA_DIR = path.join(qaRoot, 'data');
process.env.VPR_TEST_TIME_BUDGET_MS = '12000';
process.env.VPR_TEST_SATURATION_WINDOW = '8';
process.env.VPR_TEST_SATURATION_WINDOWS = '2';
process.env.YOUTUBE_API_KEYS = '';
process.env.GEMINI_API_KEYS = '';
process.env.VPR_DISABLE_API_KEYS = '1';

fs.rmSync(qaRoot, { recursive: true, force: true });
fs.mkdirSync(process.env.VPR_DATA_DIR, { recursive: true });
const legacySessionsFile = path.join(process.env.VPR_DATA_DIR, 'research-sessions.json');
fs.writeFileSync(legacySessionsFile, JSON.stringify([{
  id: 'legacy-session',
  name: 'Legacy research',
  createdAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T00:01:00.000Z',
  params: { mode: 'web', keywords: ['legacy'] },
  discovery: {},
  niches: [],
  stats: { videos: 0, channels: 0, totalViews: 0, saved: 0 },
  results: []
}], null, 2));

const {
  startServer,
  setBrowserResearchAdapter,
  classifyFacelessChannel
} = require('../server');

const fakeBrowser = {
  visible: false,
  calls: 0,
  saturationMode: false,
  status() {
    return { available: true, visible: this.visible, activePages: 0, concurrency: 2, selectedWorker: 0, controlOwner: 'researcher', frameAvailable: true, workers: [{ id: 0, busy: false, url: 'https://www.youtube.com/results?search_query=qa' }], viewer: { state: this.visible ? 'visible' : 'hidden' }, profile: 'qa-anonymous' };
  },
  recommendedConcurrency() {
    return 2;
  },
  async executeTasks(tasks) {
    this.calls += tasks.length;
    await sleep(80);
    return tasks.map(fakeTaskOutput);
  },
  async show() {
    this.visible = true;
  },
  async hide() {
    this.visible = false;
  },
  async expand() { this.visible = true; },
  async minimize() { this.visible = true; },
  async setUserControl() {},
  async captureFrame() {
    return Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==', 'base64');
  }
};

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});

async function main() {
  const archiveDocumentary = classifyFacelessChannel({
    channelTitle: 'History Archive Files',
    description: 'Narrated documentaries built from public archives and historical footage.',
    channelPublishedAt: new Date(Date.now() - 45 * 86400000).toISOString(),
    visualSignals: { available: true, faceHeavyRatio: 0.82 }
  }, Array.from({ length: 12 }, (_, index) => ({
    title: `Untold history documentary archive episode ${index + 1}`
  })));
  assert(archiveDocumentary.status === 'strict', 'Archive/celebrity faces incorrectly disqualified a faceless documentary');

  const presenterPodcast = classifyFacelessChannel({
    channelTitle: 'John Smith Podcast',
    description: 'Weekly host interviews, podcast conversations and on-camera reactions.',
    channelPublishedAt: new Date(Date.now() - 30 * 86400000).toISOString(),
    visualSignals: { available: true, faceHeavyRatio: 0.9 }
  }, Array.from({ length: 12 }, (_, index) => ({
    title: `My interview with a creator on the podcast ${index + 1}`
  })));
  assert(presenterPodcast.status === 'rejected', 'A presenter-led interview/podcast was accepted as faceless');

  const ambiguous = classifyFacelessChannel({
    channelTitle: 'Curious Signal',
    description: ''
  }, [{ title: 'A curious story explained' }]);
  assert(ambiguous.status === 'review', 'A low-evidence faceless candidate did not enter Review');

  setBrowserResearchAdapter(fakeBrowser);
  const server = await startServer({ host: '127.0.0.1', port: 0 });
  try {
    const health = await json(`${server.url}/api/health`);
    assert(health.browser?.available, 'Browser capability missing from health');
    assert(health.youtube?.configured === 0, 'Browser QA must not load YouTube API keys');
    const migratedSessions = await json(`${server.url}/api/research/sessions`);
    assert(migratedSessions.sessions?.some(session => session.id === 'legacy-session'), 'Legacy JSON session was not migrated');
    assert(fs.existsSync(`${legacySessionsFile}.pre-sqlite.bak`), 'Legacy session backup was not preserved');

    const created = await json(`${server.url}/api/research/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'browser',
        timeBudget: '15m',
        keywords: ['future cities documentary'],
        filters: {
          intensity: 'quick',
          resultLimit: 80,
          duration: 'long',
          region: 'US',
          language: 'en',
          sort: 'outlier',
          useGemini: false
        }
      })
    });

    const eventResponse = await fetch(`${server.url}/api/research/run/${created.id}/events`);
    assert(eventResponse.ok && /text\/event-stream/.test(eventResponse.headers.get('content-type') || ''), 'SSE endpoint unavailable');
    eventResponse.body.cancel();

    await sleep(20);
    await json(`${server.url}/api/research/run/${created.id}/pause`, { method: 'POST' });
    const paused = await json(`${server.url}/api/research/run/${created.id}`);
    assert(paused.status === 'paused', 'Job did not pause');
    await json(`${server.url}/api/research/run/${created.id}/resume`, { method: 'POST' });

    const completed = await waitForJob(server.url, created.id, 20000);
    assert(completed.status === 'complete', `Autonomous job ended as ${completed.status}`);
    assert((completed.channels || []).length >= 10, `Autonomous graph found only ${(completed.channels || []).length} channels`);
    assert((completed.results || []).length >= 10, `Autonomous graph retained only ${(completed.results || []).length} videos`);
    assert((completed.results || []).every(item => !/\/shorts\//i.test(item.url || '') && Number(item.durationSeconds) >= 240), 'Short-form result escaped filtering');
    assert((completed.results || []).every(item => item.publishedAt && Date.now() - new Date(item.publishedAt).getTime() <= 91 * 86400000), 'A trigger video older than 90 days escaped filtering');
    assert((completed.channels || []).every(channel =>
      Number.isFinite(Number(channel.facelessScore))
      && Number.isFinite(Number(channel.facelessConfidence))
      && ['strict', 'review', 'rejected'].includes(channel.facelessStatus)
    ), 'Faceless classification fields are incomplete');
    assert(Number(completed.discovery?.completedTasks) > 1, 'Graph queue did not process multiple task types');
    assert(completed.currentOperation?.phase, 'Current operation telemetry is missing');
    assert((completed.activity || []).some(item => item.phase && item.taskType && item.status), 'Structured activity telemetry is missing');
    assert(fakeBrowser.calls > 1, 'Browser adapter was not exercised');

    const review = await json(`${server.url}/api/opportunities?view=review&limit=500`);
    assert(Array.isArray(review.channels) && review.channels.length > 0, 'Ambiguous faceless candidates were not routed to Review');
    const favoriteId = completed.channels[0].channelId;
    await json(`${server.url}/api/research/channel/favorite`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channelId: favoriteId, favorite: true })
    });
    const favorites = await json(`${server.url}/api/opportunities?view=favorites&limit=500`);
    assert(favorites.channels.some(channel => channel.channelId === favoriteId), 'Favorite channel was not persisted');
    const detail = await json(`${server.url}/api/channels/${encodeURIComponent(favoriteId)}`);
    assert(detail.channel?.channelId === favoriteId && Array.isArray(detail.videos), 'Channel detail endpoint is incomplete');

    const shown = await json(`${server.url}/api/research/browser/show`, { method: 'POST' });
    assert(shown.visible, 'Research browser show command failed');
    const hidden = await json(`${server.url}/api/research/browser/hide`, { method: 'POST' });
    assert(!hidden.visible, 'Research browser hide command failed');
    const frame = await fetch(`${server.url}/api/research/browser/frame?worker=0&width=420&quality=40`);
    assert(frame.status === 200 && /image\/jpeg/.test(frame.headers.get('content-type') || ''), 'Live frame endpoint failed');
    const expanded = await json(`${server.url}/api/research/browser/viewer/expand`, { method: 'POST' });
    assert(expanded.visible, 'Viewer expand command failed');

    fakeBrowser.saturationMode = true;
    const saturationRun = await json(`${server.url}/api/research/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'browser', timeBudget: '15m', keywords: ['saturation test'], filters: { intensity: 'quick', resultLimit: 30, duration: 'long' } })
    });
    const saturated = await waitForJob(server.url, saturationRun.id, 20000);
    assert(saturated.status === 'complete', `Saturation job ended as ${saturated.status}`);
    assert(saturated.discovery?.stopReason === 'saturation', `Expected saturation stop, received ${saturated.discovery?.stopReason}`);
    fakeBrowser.saturationMode = false;

    const cancelRun = await json(`${server.url}/api/research/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'browser', timeBudget: '6h', keywords: ['cancel test'], filters: { intensity: 'deep', resultLimit: 20, duration: 'long' } })
    });
    await json(`${server.url}/api/research/run/${cancelRun.id}/cancel`, { method: 'POST' });
    const cancelled = await waitForJob(server.url, cancelRun.id, 8000);
    assert(cancelled.status === 'cancelled', 'Job did not cancel');

    assert(fs.existsSync(path.join(process.env.VPR_DATA_DIR, 'research.db')), 'SQLite database was not created');
    console.log(JSON.stringify({
      ok: true,
      channels: completed.channels.length,
      videos: completed.results.length,
      completedTasks: completed.discovery.completedTasks,
      queueStop: completed.discovery.stopReason,
      saturationStop: saturated.discovery.stopReason,
      browserCalls: fakeBrowser.calls,
      pauseResume: true,
      cancelled: true,
      sqlite: true,
      jsonMigration: true,
      facelessClassified: completed.channels.length,
      reviewCandidates: review.channels.length,
      favoritePersisted: true,
      channelDetail: true,
      classifierFixtures: {
        archiveDocumentary: archiveDocumentary.status,
        presenterPodcast: presenterPodcast.status,
        ambiguous: ambiguous.status
      },
      apiKeysLoaded: health.youtube.configured
    }, null, 2));
  } finally {
    setBrowserResearchAdapter(null);
    await server.close();
    fs.rmSync(qaRoot, { recursive: true, force: true });
  }
}

function fakeTaskOutput(task) {
  if (task.type === 'featured_channels') return { items: [] };
  if (task.depth >= 3 && !fakeBrowser.saturationMode) return { items: [] };
  const base = safeId(task.payload.query || task.payload.videoId || task.payload.channelId || task.id);
  const count = task.type === 'keyword_search' || task.type === 'query_expansion' ? 14 : task.type === 'related_video' ? 3 : 2;
  return {
    items: Array.from({ length: count }, (_, index) => {
      const channelSeed = fakeBrowser.saturationMode ? `saturation-channel-${index % 3}` : `${base}-${task.depth}-${index}`;
      const videoSeed = fakeBrowser.saturationMode ? `${task.id}-${index}` : `${task.type}-${base}-${index}`;
      const channelId = `UC${stableId(channelSeed, 22)}`;
      const videoId = stableId(videoSeed, 11);
      const isShortFixture = count > 4 && index === count - 2;
      const isOldFixture = count > 4 && index === count - 1;
      return {
        videoId,
        title: `${task.payload.query || task.payload.title || 'Research'} insight ${index}`,
        url: isShortFixture ? `https://www.youtube.com/shorts/${videoId}` : `https://www.youtube.com/watch?v=${videoId}`,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        durationSeconds: isShortFixture ? 42 : 900 + index * 60,
        durationLabel: `1${index}:00`,
        publishedAt: new Date(Date.now() - (isOldFixture ? 95 : index + 1) * 86400000).toISOString(),
        viewCount: 100000 + index * 50000,
        channelId,
        channelTitle: `Research Channel ${task.depth}-${index}`,
        subscriberCount: 5000 + index * 100,
        channelVideoCount: 20 + index,
        sourceMode: 'browser',
        confidence: 0.7
      };
    })
  };
}

async function waitForJob(baseUrl, id, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await json(`${baseUrl}/api/research/run/${id}`);
    if (['complete', 'error', 'cancelled'].includes(job.status)) return job;
    await sleep(120);
  }
  throw new Error(`Job ${id} timed out`);
}

async function json(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function safeId(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'research';
}

function stableId(value, length) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, length);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
