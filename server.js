'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const dotenv = require('dotenv');
const { ResearchStore } = require('./lib/research-store');
const {
  CLASSIFIER_VERSION: FACELESS_CLASSIFIER_VERSION,
  MIN_CONSISTENCY_VIDEOS,
  finiteMetric,
  stableChannelKey,
  applyChannelBaselines,
  computeDataCoverage,
  classifyFacelessChannel: classifyFacelessChannelV3,
  buildFormatFingerprint,
  buildOpportunityDossier,
  estimateVelocitySignal,
  evaluateBabyChannel,
  generateViralAngles
} = require('./lib/opportunity-engine');
const { deconstructVideo } = require('./lib/video-deconstructor');
const { generateViralBlueprint, formatBlueprintAsMarkdown, generateProductionMasterdeckMarkdown, SCRIPT_STYLES } = require('./lib/blueprint-generator');
const { sendTelegramAlert, sendDiscordAlert, sendGenericWebhookAlert, evaluateSentinelCandidate, SentinelEngine } = require('./lib/sentinel-service');
const { evaluateArbitrage } = require('./lib/arbitrage-engine');
const { analyzeThumbnail } = require('./lib/thumb-analyzer');

const ROOT = __dirname;
const STORAGE_DIR = process.env.VPR_STORAGE_DIR || ROOT;
dotenv.config({ path: path.join(STORAGE_DIR, '.env'), override: true });
if (process.env.VPR_DISABLE_API_KEYS === '1') {
  process.env.YOUTUBE_API_KEYS = '';
  process.env.GEMINI_API_KEYS = '';
}

const DATA_DIR = process.env.VPR_DATA_DIR || path.join(STORAGE_DIR, 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4317);

const DEFAULT_REGION = 'US';
const DEFAULT_LANGUAGE = 'en';
const DEFAULT_RECENT_DAYS = 90;
const DISCOVERY_WINDOWS_DAYS = [7, 30, 90];
const DEFAULT_FACELESS_THRESHOLD = 70;
const DEFAULT_FACELESS_CONFIDENCE = 0.6;
const DEFAULT_FACELESS_KEYWORDS = [
  'business documentary',
  'technology documentary',
  'space documentary explained',
  'money documentary explained'
];
const DEFAULT_INTENSITY = 'normal';
const DEFAULT_TIME_BUDGET = '2h';
const MAX_RESULTS_LIMIT = 400;
const LONG_FORM_MIN_SECONDS = 240;
const DEEP_LONG_MIN_SECONDS = 480;
const TWENTY_LONG_MIN_SECONDS = 1200;
const API_SEARCH_ORDERS = ['viewCount', 'relevance', 'date'];
const BASELINE_UPLOAD_LIMIT = 24;
const WEB_FETCH_TIMEOUT_MS = 18000;
const WEB_FETCH_RETRIES = 2;
const WEB_VIDEO_ENRICH_LIMIT = 180;
const WEB_VIDEO_ENRICH_TIMEOUT_MS = 6000;
const BASELINE_UPLOAD_TIMEOUT_MS = 8000;
const BASELINE_VIDEOS_TIMEOUT_MS = 10000;
const RESEARCH_INTENSITIES = Object.freeze({
  quick: {
    label: 'Quick',
    candidateLimit: 220,
    resultLimit: 100,
    continuationPages: 2,
    uploadsPerChannel: 16,
    deadlineMs: 70000
  },
  normal: {
    label: 'Normal',
    candidateLimit: 520,
    resultLimit: 220,
    continuationPages: 6,
    uploadsPerChannel: 24,
    deadlineMs: 180000
  },
  deep: {
    label: 'Deep',
    candidateLimit: 1000,
    resultLimit: 400,
    continuationPages: 10,
    uploadsPerChannel: 32,
    deadlineMs: 330000
  }
});
const AUTONOMOUS_BUDGETS = Object.freeze({
  '15m': { label: 'Quick', deadlineMs: 15 * 60 * 1000, maxQueuedTasks: 1200 },
  '2h': { label: 'Deep', deadlineMs: 2 * 60 * 60 * 1000, maxQueuedTasks: 5000 },
  '6h': { label: 'Expedition', deadlineMs: 6 * 60 * 60 * 1000, maxQueuedTasks: 12000 }
});
const SATURATION_TASK_WINDOW = Math.max(8, Number(process.env.VPR_TEST_SATURATION_WINDOW) || 50);
const SATURATION_REQUIRED_WINDOWS = Math.max(2, Number(process.env.VPR_TEST_SATURATION_WINDOWS) || 3);
const SATURATION_NOVELTY_RATE = 0.03;
const MAX_RECOMMENDATION_DEPTH = 6;
const RESEARCH_PRESETS = new Set(['all', 'small', 'medium', 'above1m', 'outlier', 'few', 'added', 'long', 'recent', 'formula63k']);
const SETTINGS_VERSION = 2;
const DEFAULT_SETTINGS = Object.freeze({
  appearance: { theme: 'auto', language: 'system', motion: 'expressive', sidebarCollapsed: false },
  research: {
    mode: 'auto', timeBudget: '2h', duration: 'long', region: 'US', contentLanguage: 'en',
    sort: 'outlier', initialView: 'videos', useGemini: false,
    maxVideoAgeDays: 90, facelessThreshold: 70, scoutEnabled: true, scoutIntervalHours: 24
  },
  desktop: {
    launchAtStartup: false,
    continueInTray: true,
    notifications: { complete: true, attention: true, error: true }
  },
  sentinel: {
    enabled: false,
    intervalMinutes: 30,
    minMultiplier: 3.0,
    allowBabyChannels: true,
    allowArbitrage: true,
    allowVphSpike: true,
    minVphSpike: 300,
    autoGenerateBlueprints: true,
    telegramEnabled: false,
    telegramToken: '',
    telegramChatId: '',
    discordEnabled: false,
    discordWebhook: '',
    webhookEnabled: false,
    webhookUrl: '',
    desktopNotifications: true
  }
});
const NICHE_STOP_WORDS = new Set([
  'documentary', 'documents', 'explained', 'history', 'histories', 'video', 'videos', 'full', 'part',
  'story', 'stories', 'world', 'channel', 'youtube', 'faceless', 'official', 'episode', 'ep', 'the',
  'and', 'for', 'from', 'with', 'this', 'that', 'what', 'how', 'why', 'your', 'into', 'about', 'after',
  'before', 'every', 'real', 'new', 'one', 'two', 'three', 'four', 'live', 'most', 'best', 'must',
  'watch', 'was', 'were', 'are', 'has', 'have', 'not', 'can', 'all', 'you', 'uma', 'que', 'como',
  'para', 'por', 'dos', 'das', 'com', 'sem', 'hours', 'hour', 'minutes', 'minute', 'across',
  'native', 'unknown', 'revisited', 'complete', 'special', 'film', 'films', 'they', 'them', 'their',
  'never', 'year', 'years'
]);
const FACELESS_POSITIVE_PATTERNS = [
  /\bdocumentar(?:y|ies|io|ios)\b/i, /\bexplained\b|\bexplicad[oa]s?\b/i,
  /\bhistory\b|\bhistoria\b/i, /\bstory\b|\bstories\b|\brelatos?\b/i,
  /\bfacts?\b|\bcuriosit(?:y|ies)\b|\bcuriosidades?\b/i,
  /\banimat(?:ed|ion)\b|\banima[cç][aã]o\b/i, /\barchive\b|\barquivo\b/i,
  /\banalysis\b|\banalise\b/i, /\btimeline\b|\bchronicle\b|\bcronic[ao]\b/i,
  /\bscience\b|\btechnology\b|\bengineering\b|\bspace\b|\bmilitary\b|\bgeopolit/i,
  /\bwhy\b|\bhow\b|\bcomo\b|\bpor que\b/i, /\btop\s*\d+\b|\branked\b|\branking\b/i
];
const FACELESS_NEGATIVE_PATTERNS = [
  /\bpodcast\b/i, /\binterview\b|\bentrevista\b/i, /\bvlog\b/i,
  /\bday in my life\b|\bmeu dia\b/i, /\breaction\b|\breacts?\b|\breagindo\b/i,
  /\btalk show\b|\blive stream\b|\blivestream\b/i,
  /\bwelcome (back )?to my channel\b|\bbem-vind[oa]s? ao meu canal\b/i,
  /\bi am\b|\bi'm\b|\bmy journey\b|\bminha jornada\b/i,
  /\bhosted by\b|\bapresentado por\b/i, /\bq&a\b|\bask me anything\b/i
];

fs.mkdirSync(DATA_DIR, { recursive: true });

const seenFile = path.join(DATA_DIR, 'seen.json');
const lastFile = path.join(DATA_DIR, 'last-results.json');
const sessionsFile = path.join(DATA_DIR, 'research-sessions.json');

function readJsonFile(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[Storage] Aviso ao ler ${path.basename(file)}: ${err.message}. Mantendo fallback de integridade.`);
    return fallback;
  }
}

async function writeJsonFile(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmp = `${file}.${process.pid}.${uniqueId}.tmp`;
  const content = JSON.stringify(value, null, 2);
  await fsp.writeFile(tmp, content, 'utf8');

  let attempts = 0;
  while (attempts < 5) {
    try {
      await fsp.rename(tmp, file);
      return;
    } catch (err) {
      attempts++;
      if (attempts >= 5) {
        try {
          await fsp.copyFile(tmp, file);
          await fsp.unlink(tmp).catch(() => {});
          return;
        } catch {
          await fsp.unlink(tmp).catch(() => {});
          throw err;
        }
      }
      await new Promise(r => setTimeout(r, 25 * attempts));
    }
  }
}

const seenStore = readJsonFile(seenFile, { seen: {}, saved: {} });
let lastResults = readJsonFile(lastFile, []);
const researchStore = new ResearchStore(DATA_DIR);
researchStore.migrateJson({ sessionsFile, lastFile });
researchStore.pruneSnapshots(45);
researchStore.importVideoMarks(seenStore);
const persistedMarks = researchStore.videoMarks();
seenStore.seen = persistedMarks.seen;
seenStore.saved = persistedMarks.saved;
let sessionStore = researchStore.listSessions(2000);
const jobs = new Map();
const jobSubscribers = new Map();
let browserResearchAdapter = null;
let desktopSettingsAdapter = null;
let manualBrowserControl = null;
let activeBrowserJobId = '';
const serverState = {
  host: HOST,
  port: PORT,
  url: `http://${HOST}:${PORT}`
};
let activeDesktopNotifier = null;
const sentinelEngine = new SentinelEngine({
  store: researchStore,
  notifier: (alert) => {
    if (typeof activeDesktopNotifier === 'function') {
      activeDesktopNotifier(alert);
    }
  }
});

sentinelEngine.onCycle = async () => {
  if (researchStore.closed) return;
  const currentSettings = settingsProfile().settings;
  if (!currentSettings.sentinel?.enabled) return;

  const opportunities = (researchStore.listOpportunityChannels ? researchStore.listOpportunityChannels(50) : []) || [];
  for (const opp of opportunities) {
    const top = opp.topVideo;
    if (!top || !top.videoId) continue;
    const candidate = {
      ...top,
      channelTitle: opp.channelTitle,
      subscriberCount: opp.subscriberCount,
      channelAgeDays: opp.firstUploadAgeDays || opp.channelAgeDays,
      isBabyChannel: opp.isBabyChannel
    };
    const evalResult = evaluateSentinelCandidate(candidate, currentSettings.sentinel);
    if (evalResult.qualifies) {
      let blueprintGenerated = false;
      if (currentSettings.sentinel?.autoGenerateBlueprints && (evalResult.isArbitrage || Number(evalResult.multiplier) >= 8)) {
        try {
          const bp = generateViralBlueprint(candidate, { style: 'documentary' });
          researchStore.saveSnapshot('blueprint', bp.id, bp);
          blueprintGenerated = true;
        } catch (bpErr) {
          console.error('[Sentinel] Erro ao auto-gerar blueprint:', bpErr.message);
        }
      }

      await sentinelEngine.dispatchAlert(currentSettings.sentinel, {
        videoId: top.videoId,
        title: top.title,
        channelTitle: opp.channelTitle,
        thumbnail: top.thumbnail || `https://i.ytimg.com/vi/${top.videoId}/hqdefault.jpg`,
        viewCount: top.viewCount,
        viewText: top.viewText,
        outlierMultiplier: evalResult.multiplier,
        isBaby: evalResult.isBaby,
        isArbitrage: Boolean(evalResult.isArbitrage),
        arbitrageTitles: evalResult.arbitrageTitles || [],
        arbitrageLang: evalResult.arbitrageLang,
        isVphBreakout: Boolean(evalResult.isVphBreakout),
        vph: evalResult.vph,
        blueprintGenerated,
        channelAgeDays: opp.firstUploadAgeDays || opp.channelAgeDays,
        reason: evalResult.reason,
        url: top.videoId ? `https://www.youtube.com/watch?v=${top.videoId}` : ''
      });
    }
  }
};

const backfillState = { status: 'idle', processed: 0, remaining: 0, error: '' };
let backfillPromise = null;
const scoutState = { status: 'idle', checked: 0, updatedAt: '', error: '' };
let scoutTimer = null;
let scoutPromise = null;

for (const restored of researchStore.interruptedRuns()) {
  if (!restored?.id) continue;
  restored.status = 'cancelled';
  restored.pauseRequested = false;
  restored.cancelRequested = true;
  restored.message = 'Sessão anterior finalizada';
  restored.updatedAt = new Date().toISOString();
  restored._runnerStarted = false;
  jobs.set(restored.id, restored);
  researchStore.saveRun(restored);
}

function parseKeyList(value) {
  return String(value || '')
    .split(/[\s,;]+/g)
    .map(item => item.trim())
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index);
}

class ApiKeyPool {
  constructor(label, keys) {
    this.label = label;
    this.keys = keys;
    this.index = 0;
    this.cooldowns = new Map();
    this.failureCounts = new Map();
  }

  get size() {
    return this.keys.length;
  }

  get availableCount() {
    const now = Date.now();
    return this.keys.filter(key => (this.cooldowns.get(key) || 0) <= now).length;
  }

  markFailure(key, reason) {
    const failures = (this.failureCounts.get(key) || 0) + 1;
    this.failureCounts.set(key, failures);
    const longCooldown = /keyInvalid|badRequest|dailyLimitExceeded|quotaExceeded/i.test(reason || '');
    const minutes = longCooldown ? 60 : Math.min(30, 3 * failures);
    this.cooldowns.set(key, Date.now() + minutes * 60 * 1000);
  }

  markSuccess(key) {
    this.cooldowns.delete(key);
    this.failureCounts.delete(key);
  }

  nextKey() {
    if (!this.keys.length) return null;
    const now = Date.now();
    for (let i = 0; i < this.keys.length; i += 1) {
      const idx = (this.index + i) % this.keys.length;
      const key = this.keys[idx];
      if ((this.cooldowns.get(key) || 0) <= now) {
        this.index = (idx + 1) % this.keys.length;
        return key;
      }
    }
    return null;
  }

  async requestJson(buildRequest, options = {}) {
    if (!this.keys.length) throw new Error(`${this.label}: no API keys configured`);

    const attempts = Math.min(this.keys.length, Math.max(1, Number(options.maxAttempts) || this.keys.length));
    let lastError = null;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const key = this.nextKey();
      if (!key) break;

      try {
        const request = buildRequest(key);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), Math.max(3000, Number(options.timeoutMs) || 12000));
        const response = await fetch(request.url, { ...(request.init || {}), signal: controller.signal })
          .finally(() => clearTimeout(timeout));
        const text = await response.text();
        const payload = text ? JSON.parse(text) : {};

        if (response.ok) {
          this.markSuccess(key);
          return payload;
        }

        const reason = youtubeErrorReason(payload) || `http_${response.status}`;
        lastError = new Error(`${this.label}: ${reason}`);
        this.markFailure(key, reason);

        if (!isRetryableApiReason(reason, response.status) && !options.rotateOnAnyError) {
          throw lastError;
        }
        continue;
      } catch (err) {
        const message = safeErrorMessage(err);
        lastError = new Error(`${this.label}: ${message}`);
        this.markFailure(key, lastError.message);
        if (!options.rotateOnAnyError && !/fetch failed|network|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|aborted/i.test(message)) {
          throw lastError;
        }
      }
    }

    throw lastError || new Error(`${this.label}: all API keys are cooling down`);
  }

  health() {
    const now = Date.now();
    return {
      configured: this.size,
      available: this.availableCount,
      coolingDown: this.keys.filter(key => (this.cooldowns.get(key) || 0) > now).length
    };
  }
}

const youtubePool = new ApiKeyPool('YouTube', parseKeyList(process.env.YOUTUBE_API_KEYS));
const geminiPool = new ApiKeyPool('Gemini', parseKeyList(process.env.GEMINI_API_KEYS));

function youtubeErrorReason(payload) {
  return payload?.error?.errors?.[0]?.reason
    || payload?.error?.status
    || payload?.error?.message
    || '';
}

function isRetryableApiReason(reason, status) {
  return status === 429
    || status >= 500
    || /quota|rate|limit|backend|internal|unavailable|keyInvalid|forbidden/i.test(reason || '');
}

function safeErrorMessage(err) {
  return String(err && err.message ? err.message : err || 'unknown error')
    .replace(/key=AIza[0-9A-Za-z_-]+/g, 'key=[masked]')
    .replace(/AIza[0-9A-Za-z_-]+/g, '[masked]');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function settingsProfile() {
  const stored = researchStore.settingsProfile();
  return {
    settings: normalizeSettings(stored.sections),
    revision: stored.revision,
    savedAt: stored.savedAt,
    version: SETTINGS_VERSION,
    capabilities: {
      desktop: process.env.VPR_DESKTOP === '1',
      launchAtStartup: Boolean(desktopSettingsAdapter?.capabilities?.().launchAtStartup),
      openDataFolder: Boolean(desktopSettingsAdapter?.capabilities?.().openDataFolder),
      browser: Boolean(browserResearchAdapter)
    },
    needsLegacyThemeMigration: researchStore.getMeta('legacy_theme_migrated') !== '1'
  };
}

function normalizeSettings(sections = {}) {
  const profile = clone(DEFAULT_SETTINGS);
  for (const section of Object.keys(profile)) {
    if (!sections[section] || typeof sections[section] !== 'object') continue;
    profile[section] = mergeKnown(profile[section], sections[section]);
  }
  return validateSettings(profile);
}

function mergeKnown(base, patch) {
  const output = clone(base);
  for (const key of Object.keys(output)) {
    if (!Object.prototype.hasOwnProperty.call(patch || {}, key)) continue;
    if (output[key] && typeof output[key] === 'object' && !Array.isArray(output[key])) {
      output[key] = mergeKnown(output[key], patch[key]);
    } else {
      output[key] = patch[key];
    }
  }
  return output;
}

function validateSettings(profile) {
  const settings = clone(profile);
  settings.appearance.theme = enumSetting(settings.appearance.theme, ['auto', 'light', 'dark'], 'appearance.theme');
  settings.appearance.language = enumSetting(settings.appearance.language, ['system', 'pt', 'en'], 'appearance.language');
  settings.appearance.motion = enumSetting(settings.appearance.motion, ['off', 'subtle', 'expressive'], 'appearance.motion');
  settings.appearance.sidebarCollapsed = boolSetting(settings.appearance.sidebarCollapsed, 'appearance.sidebarCollapsed');
  settings.research.mode = enumSetting(settings.research.mode, ['auto', 'browser', 'http', 'api'], 'research.mode');
  settings.research.timeBudget = enumSetting(settings.research.timeBudget, ['15m', '2h', '6h'], 'research.timeBudget');
  settings.research.duration = enumSetting(settings.research.duration, ['long', 'deepLong', 'twentyLong'], 'research.duration');
  settings.research.sort = enumSetting(settings.research.sort, ['outlier', 'views', 'viewsPerDay', 'recent'], 'research.sort');
  settings.research.initialView = enumSetting(settings.research.initialView, ['channels', 'videos', 'niches'], 'research.initialView');
  settings.research.region = String(settings.research.region || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(settings.research.region)) throw new Error('research.region must be a two-letter code');
  settings.research.contentLanguage = String(settings.research.contentLanguage || '').trim().toLowerCase();
  if (!/^[a-z]{2,8}$/.test(settings.research.contentLanguage)) throw new Error('research.contentLanguage is invalid');
  settings.research.useGemini = boolSetting(settings.research.useGemini, 'research.useGemini');
  settings.research.maxVideoAgeDays = Math.round(clamp(settings.research.maxVideoAgeDays, 7, 90));
  settings.research.facelessThreshold = Math.round(clamp(settings.research.facelessThreshold, 45, 90));
  settings.research.scoutEnabled = boolSetting(settings.research.scoutEnabled, 'research.scoutEnabled');
  settings.research.scoutIntervalHours = Math.round(clamp(settings.research.scoutIntervalHours, 6, 168));
  settings.desktop.launchAtStartup = boolSetting(settings.desktop.launchAtStartup, 'desktop.launchAtStartup');
  settings.desktop.continueInTray = boolSetting(settings.desktop.continueInTray, 'desktop.continueInTray');
  for (const key of ['complete', 'attention', 'error']) {
    settings.desktop.notifications[key] = boolSetting(settings.desktop.notifications[key], `desktop.notifications.${key}`);
  }
  if (settings.sentinel) {
    settings.sentinel.enabled = boolSetting(settings.sentinel.enabled, 'sentinel.enabled');
    settings.sentinel.intervalMinutes = Math.round(clamp(settings.sentinel.intervalMinutes, 15, 720));
    settings.sentinel.minMultiplier = Math.round(clamp(settings.sentinel.minMultiplier, 1.5, 50) * 10) / 10;
    settings.sentinel.allowBabyChannels = boolSetting(settings.sentinel.allowBabyChannels, 'sentinel.allowBabyChannels');
    settings.sentinel.allowArbitrage = boolSetting(settings.sentinel.allowArbitrage, 'sentinel.allowArbitrage');
    settings.sentinel.allowVphSpike = boolSetting(settings.sentinel.allowVphSpike, 'sentinel.allowVphSpike');
    settings.sentinel.minVphSpike = Math.round(clamp(settings.sentinel.minVphSpike, 50, 10000));
    settings.sentinel.autoGenerateBlueprints = boolSetting(settings.sentinel.autoGenerateBlueprints, 'sentinel.autoGenerateBlueprints');
    settings.sentinel.telegramEnabled = boolSetting(settings.sentinel.telegramEnabled, 'sentinel.telegramEnabled');
    settings.sentinel.telegramToken = String(settings.sentinel.telegramToken || '').trim();
    settings.sentinel.telegramChatId = String(settings.sentinel.telegramChatId || '').trim();
    settings.sentinel.discordEnabled = boolSetting(settings.sentinel.discordEnabled, 'sentinel.discordEnabled');
    settings.sentinel.discordWebhook = String(settings.sentinel.discordWebhook || '').trim();
    settings.sentinel.webhookEnabled = boolSetting(settings.sentinel.webhookEnabled, 'sentinel.webhookEnabled');
    settings.sentinel.webhookUrl = String(settings.sentinel.webhookUrl || '').trim();
    settings.sentinel.desktopNotifications = boolSetting(settings.sentinel.desktopNotifications, 'sentinel.desktopNotifications');
  }
  return settings;
}

function validateSettingsPatch(changes, current) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('changes must be an object');
  const allowedSections = Object.keys(DEFAULT_SETTINGS);
  for (const section of Object.keys(changes)) {
    if (!allowedSections.includes(section)) throw new Error(`unknown settings section: ${section}`);
    assertKnownKeys(changes[section], DEFAULT_SETTINGS[section], section);
  }
  const merged = clone(current);
  for (const section of allowedSections) {
    if (changes[section]) merged[section] = mergeKnown(merged[section], changes[section]);
  }
  return validateSettings(merged);
}

function assertKnownKeys(value, shape, prefix) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${prefix} must be an object`);
  for (const key of Object.keys(value)) {
    if (!Object.prototype.hasOwnProperty.call(shape, key)) throw new Error(`unknown setting: ${prefix}.${key}`);
    if (shape[key] && typeof shape[key] === 'object' && !Array.isArray(shape[key])) {
      assertKnownKeys(value[key], shape[key], `${prefix}.${key}`);
    }
  }
}

function enumSetting(value, allowed, name) {
  if (!allowed.includes(value)) throw new Error(`${name} is invalid`);
  return value;
}

function boolSetting(value, name) {
  if (typeof value !== 'boolean') throw new Error(`${name} must be boolean`);
  return value;
}

function applyDesktopSettings(settings) {
  try {
    desktopSettingsAdapter?.apply?.(clone(settings.desktop), clone(settings.appearance));
  } catch (error) {
    console.error(`Desktop settings could not be applied: ${safeErrorMessage(error)}`);
  }
  try {
    if (settings.sentinel?.enabled) {
      sentinelEngine.updateConfig(settings.sentinel);
      sentinelEngine.start();
    } else {
      sentinelEngine.stop();
    }
  } catch (error) {
    console.error(`Sentinel engine could not be updated: ${safeErrorMessage(error)}`);
  }
}

function apiFallbackWarning(err) {
  const message = safeErrorMessage(err);
  const reason = /quota|cooling|rate|limit/i.test(message)
    ? 'quota or rate limit reached'
    : 'API request failed';
  return `YouTube API unavailable for this run: ${reason}. Using the public YouTube fallback.`;
}

function clamp(n, min, max) {
  const value = Number(n);
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function splitInput(value) {
  if (Array.isArray(value)) return value.map(String).map(v => v.trim()).filter(Boolean);
  return String(value || '')
    .split(/[\n,;]+/g)
    .map(item => item.trim())
    .filter(Boolean);
}

function sanitizeResearchBody(body = {}) {
  const filters = body.filters || {};
  const keywords = splitInput(body.keywords).slice(0, 12);
  const seedChannels = splitInput(body.seedChannels).slice(0, 16);
  const usingDefaultSeeds = !keywords.length && !seedChannels.length;
  const intensity = Object.prototype.hasOwnProperty.call(RESEARCH_INTENSITIES, filters.intensity)
    ? filters.intensity
    : DEFAULT_INTENSITY;
  const budget = RESEARCH_INTENSITIES[intensity];
  if (usingDefaultSeeds) keywords.push(...DEFAULT_FACELESS_KEYWORDS);

  return {
    mode: normalizeResearchMode(body.mode),
    profileId: ['anonymous', 'profile-1', 'profile-2', 'all_profiles', 'all'].includes(body.profileId) ? body.profileId : '',
    scrapeHomeFeed: body.scrapeHomeFeed !== false,
    timeBudget: Object.prototype.hasOwnProperty.call(AUTONOMOUS_BUDGETS, body.timeBudget)
      ? body.timeBudget
      : DEFAULT_TIME_BUDGET,
    keywords,
    seedChannels,
    usingDefaultSeeds,
    filters: {
      region: String(filters.region || DEFAULT_REGION).trim().toUpperCase().slice(0, 2) || DEFAULT_REGION,
      language: String(filters.language || DEFAULT_LANGUAGE).trim().toLowerCase().slice(0, 8) || DEFAULT_LANGUAGE,
      maxVideoAgeDays: Math.round(clamp(filters.maxVideoAgeDays || DEFAULT_RECENT_DAYS, 7, DEFAULT_RECENT_DAYS)),
      channelAgeDays: [30, 60, 90].includes(Number(filters.channelAgeDays)) ? Number(filters.channelAgeDays) : 0,
      publishedAfter: recentCutoff(filters.publishedAfter, filters.maxVideoAgeDays || DEFAULT_RECENT_DAYS),
      publishedBefore: recentUpperBound(filters.publishedBefore),
      intensity,
      resultLimit: Math.floor(clamp(filters.resultLimit || filters.maxResults || budget.resultLimit, 1, MAX_RESULTS_LIMIT)),
      duration: ['long', 'deepLong', 'twentyLong'].includes(filters.duration) ? filters.duration : 'long',
      sort: ['outlier', 'views', 'recent', 'viewsPerDay'].includes(filters.sort) ? filters.sort : 'outlier',
      useGemini: Boolean(filters.useGemini),
      facelessMode: ['strict', 'review', 'all'].includes(filters.facelessMode) ? filters.facelessMode : 'strict',
      facelessThreshold: Math.round(clamp(filters.facelessThreshold || DEFAULT_FACELESS_THRESHOLD, 45, 90)),
      minViews: nonNegativeFilter(filters.minViews),
      maxViews: nonNegativeFilter(filters.maxViews),
      minSubscribers: nonNegativeFilter(filters.minSubscribers),
      maxSubscribers: nonNegativeFilter(filters.maxSubscribers),
      maxChannelVideos: nonNegativeFilter(filters.maxChannelVideos),
      minOutlier: nonNegativeFilter(filters.minOutlier),
      minOutlierRatio: nonNegativeFilter(filters.minOutlierRatio || filters.minOutlierMultiplier),
      minVph: nonNegativeFilter(filters.minVph || filters.minViewsPerHour),
      publishedWithinDays: nonNegativeFilter(filters.publishedWithinDays || filters.publishedDays),
      onlyGems: Boolean(filters.onlyGems),
      minViewsPerDay: nonNegativeFilter(filters.minViewsPerDay),
      minViewsPerSubscriber: nonNegativeFilter(filters.minViewsPerSubscriber),
      hideUnknownChannelAge: Boolean(filters.hideUnknownChannelAge),
      favoritesOnly: Boolean(filters.favoritesOnly),
      presetId: RESEARCH_PRESETS.has(String(filters.presetId)) ? String(filters.presetId) : 'all'
    }
  };
}

function nonNegativeFilter(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeResearchMode(value) {
  const aliases = { hybrid: 'auto', web: 'http' };
  const mode = aliases[value] || value;
  return ['auto', 'browser', 'http', 'api'].includes(mode) ? mode : 'auto';
}

function normalizeDate(value, endOfDay = false) {
  if (!value) return '';
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return '';
  if (endOfDay) parsed.setUTCHours(23, 59, 59, 999);
  return parsed.toISOString();
}

function defaultAfterDate(days = DEFAULT_RECENT_DAYS) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - Math.round(clamp(days, 7, DEFAULT_RECENT_DAYS)));
  return date.toISOString();
}

function recentCutoff(value, maxDays = DEFAULT_RECENT_DAYS) {
  const strict = new Date(defaultAfterDate(maxDays)).getTime();
  const requested = normalizeDate(value);
  const requestedTime = requested ? new Date(requested).getTime() : 0;
  return new Date(Math.max(strict, Number.isFinite(requestedTime) ? requestedTime : 0)).toISOString();
}

function recentUpperBound(value) {
  const now = Date.now() + 24 * 60 * 60 * 1000;
  const requested = normalizeDate(value, true);
  const requestedTime = requested ? new Date(requested).getTime() : now;
  return new Date(Math.min(now, Number.isFinite(requestedTime) ? requestedTime : now)).toISOString();
}

function researchBudget(filters) {
  const intensity = Object.prototype.hasOwnProperty.call(RESEARCH_INTENSITIES, filters?.intensity)
    ? filters.intensity
    : DEFAULT_INTENSITY;
  const base = RESEARCH_INTENSITIES[intensity];
  return {
    ...base,
    intensity,
    resultLimit: Math.floor(clamp(filters?.resultLimit || base.resultLimit, 1, MAX_RESULTS_LIMIT)),
    deadlineAt: Date.now() + base.deadlineMs
  };
}

function autonomousBudget(params) {
  const key = Object.prototype.hasOwnProperty.call(AUTONOMOUS_BUDGETS, params?.timeBudget)
    ? params.timeBudget
    : DEFAULT_TIME_BUDGET;
  const base = AUTONOMOUS_BUDGETS[key];
  const testDeadline = Number(process.env.VPR_TEST_TIME_BUDGET_MS) || 0;
  return {
    ...base,
    key,
    deadlineAt: Date.now() + (testDeadline > 0 ? testDeadline : base.deadlineMs)
  };
}

function jobUpdate(job, progress, message) {
  job.progress = clamp(progress, 0, 100);
  job.message = message;
  job.updatedAt = new Date().toISOString();
  const operationMode = job.params?.mode;
  if (message && job._lastOperationMessage !== message && (!job.currentOperation || operationMode === 'api' || /starting|api precision|gemini|finalist/i.test(message))) {
    const phase = /api|finalist/i.test(message) ? 'enrich' : /gemini/i.test(message) ? 'cluster' : 'research';
    job.currentOperation = {
      phase,
      taskType: phase,
      subject: message,
      source: operationMode || job.discovery?.source || 'research',
      status: job.status === 'complete' ? 'complete' : 'running',
      depth: 0,
      startedAt: new Date().toISOString(),
      cursorAction: phase === 'enrich' ? 'compare' : 'scan'
    };
    pushActivity(job, message, 'info', job.currentOperation);
    job._lastOperationMessage = message;
  }
  const now = Date.now();
  const statusChanged = job._lastPersistedStatus !== job.status;
  const terminal = ['complete', 'error', 'cancelled', 'paused', 'needs_attention'].includes(job.status);
  if (statusChanged || terminal || now - (job._lastPersistedAt || 0) >= 750 || job.progress >= 100) {
    job._lastPersistedAt = now;
    job._lastPersistedStatus = job.status;
    researchStore.saveRun(job);
    if (statusChanged || terminal || now - (job._lastSessionPersistedAt || 0) >= 2000) {
      job._lastSessionPersistedAt = now;
      persistResearchSession(job);
    }
    emitJob(job);
  }
}

function publicJob(job) {
  const output = {};
  for (const [key, value] of Object.entries(job || {})) {
    if (key.startsWith('_') || typeof value === 'function') continue;
    output[key] = key === 'channels' ? decoratePinnedChannels(value) : value;
  }
  return output;
}

function emitJob(job) {
  const listeners = jobSubscribers.get(job.id);
  if (!listeners?.size) return;
  const output = publicJob(job);
  const terminal = ['complete', 'error', 'cancelled'].includes(job.status);
  const fingerprints = {
    results: collectionFingerprint(output.results, 'results'),
    channels: collectionFingerprint(output.channels, 'channels'),
    niches: collectionFingerprint(output.niches, 'niches'),
    activity: collectionFingerprint(output.activity, 'activity')
  };
  const previous = job._sseFingerprints || {};
  const previousEntries = job._sseEntryFingerprints || {};
  if (!terminal) {
    for (const key of Object.keys(fingerprints)) {
      if (previous[key] === fingerprints[key]) delete output[key];
    }
    for (const key of ['results', 'channels']) {
      if (!Array.isArray(output[key]) || !previousEntries[key]) continue;
      const currentEntries = collectionEntryFingerprints(output[key], key);
      const delta = output[key].filter(item => previousEntries[key].get(collectionItemId(item, key)) !== currentEntries.get(collectionItemId(item, key)));
      if (delta.length && delta.length < output[key].length * 0.65) {
        output[`${key}Delta`] = delta;
        delete output[key];
      }
    }
  }
  job._sseFingerprints = fingerprints;
  job._sseEntryFingerprints = {
    results: collectionEntryFingerprints(publicJob(job).results, 'results'),
    channels: collectionEntryFingerprints(publicJob(job).channels, 'channels')
  };
  const payload = `data: ${JSON.stringify(output)}\n\n`;
  for (const response of [...listeners]) {
    try {
      response.write(payload);
      if (terminal) {
        response.end();
        listeners.delete(response);
      }
    } catch {
      listeners.delete(response);
    }
  }
  if (terminal) {
    jobSubscribers.delete(job.id);
  }
}

function collectionItemId(item, kind) {
  return kind === 'results'
    ? String(item?.videoId || '')
    : String(item?.channelId || item?.id || item?.channelTitle || '');
}

function collectionEntryFingerprints(items, kind) {
  const map = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const id = collectionItemId(item, kind);
    if (!id) continue;
    map.set(id, collectionFingerprint([item], kind));
  }
  return map;
}

function collectionFingerprint(items, kind) {
  if (!Array.isArray(items) || !items.length) return '0';
  const parts = items.map(item => {
    if (kind === 'results') {
      return `${item.videoId}:${item.viewCount}:${item.subscriberCount}:${item.outlierScore}:${item.seen ? 1 : 0}:${item.saved ? 1 : 0}`;
    }
    if (kind === 'channels') {
      return `${item.channelId}:${item.opportunityScore}:${item.confidence}:${item.videosAnalyzed}:${item.autoPotential ? 1 : 0}:${item.manualPinned ? 1 : 0}`;
    }
    if (kind === 'niches') return `${item.label}:${item.channels}:${item.videos}:${item.totalViews}`;
    return `${item.at || item.startedAt || ''}:${item.status || ''}:${item.message || item.subject || ''}`;
  });
  return crypto.createHash('sha1').update(parts.join('|')).digest('base64url').slice(0, 16);
}

function decoratePinnedChannels(channels) {
  if (!Array.isArray(channels)) return channels;
  const pinned = researchStore.pinnedChannelIds();
  return channels.map(channel => ({
    ...channel,
    manualPinned: pinned.has(channel.channelId || channel.id || channel.channelTitle),
    favorite: pinned.has(channel.channelId || channel.id || channel.channelTitle)
  }));
}

class ResearchCancelledError extends Error {
  constructor() {
    super('Research stopped');
    this.name = 'ResearchCancelledError';
  }
}

function throwIfCancelled(job) {
  if (job.cancelRequested) throw new ResearchCancelledError();
}

async function waitForJobControl(job, budget = null) {
  throwIfCancelled(job);
  if (job.pauseRequested || job.status === 'paused' || job.status === 'needs_attention' || job.status === 'network_offline') {
    const pauseStart = Date.now();
    while (job.pauseRequested || job.status === 'paused' || job.status === 'needs_attention' || job.status === 'network_offline') {
      throwIfCancelled(job);
      await delay(500);
    }
    const pausedDuration = Date.now() - pauseStart;
    if (pausedDuration > 0 && budget?.deadlineAt) {
      budget.deadlineAt += pausedDuration;
      if (browserResearchAdapter?.setDeadline) {
        browserResearchAdapter.setDeadline(budget.deadlineAt);
      }
    }
  }
}

function updateDiscovery(job, update = {}) {
  job.discovery = {
    ...(job.discovery || {}),
    ...update
  };
}

function applyBrowserTelemetry(job, telemetry = {}) {
  const isNetworkOffline = Boolean(telemetry.networkOffline || telemetry.playerState === 'network_offline' || telemetry.phase === 'network_offline');
  const operation = {
    ...(job.currentOperation || {}),
    phase: telemetry.phase || job.currentOperation?.phase || 'research',
    taskType: telemetry.taskType || job.currentOperation?.taskType || 'research',
    subject: telemetry.subject || job.currentOperation?.subject || '',
    source: 'browser',
    status: isNetworkOffline
      ? 'paused'
      : telemetry.playerState === 'needs_attention'
        ? 'needs_attention'
        : 'running',
    depth: Number(telemetry.depth ?? job.currentOperation?.depth) || 0,
    cursorAction: telemetry.cursorAction || job.currentOperation?.cursorAction || 'scan',
    watchSeconds: Number(telemetry.watchSeconds) || 0,
    watchTarget: Number(telemetry.watchTarget) || 30,
    playerState: telemetry.playerState || 'ready',
    candidateScore: Number(telemetry.candidateScore) || 0,
    channelScore: Number(telemetry.channelScore) || 0,
    decisionReason: telemetry.decisionReason || '',
    networkOffline: isNetworkOffline,
    startedAt: job.currentOperation?.startedAt || new Date().toISOString()
  };
  job.currentOperation = operation;
  updateDiscovery(job, {
    browser: telemetry.browser || browserResearchAdapter?.status?.() || { available: false },
    profile: telemetry.browser?.profile || job.discovery?.profile || null
  });
  if (isNetworkOffline) {
    job.status = 'paused';
    job.pauseReason = 'network_offline';
    job.pauseRequested = true;
    jobUpdate(job, job.progress || 0, 'Sem conexão com a internet — Pesquisa pausada e contagem congelada');
    return;
  }
  if (job.pauseReason === 'network_offline' && (telemetry.phase === 'network_reconnecting' || telemetry.phase === 'resumed' || telemetry.playerState === 'ready')) {
    job.status = 'running';
    job.pauseRequested = false;
    job.pauseReason = '';
    jobUpdate(job, job.progress || 0, 'Conexão restabelecida — Atualizando o YouTube e retomando pesquisa');
    return;
  }
  if (telemetry.playerState === 'needs_attention') {
    job.status = 'needs_attention';
    job.pauseRequested = true;
  } else if (job.status === 'needs_attention' && (telemetry.playerState === 'ready' || telemetry.phase === 'resumed' || telemetry.phase === 'explore' || telemetry.phase === 'watch')) {
    job.status = 'running';
    job.pauseRequested = false;
    job.pauseReason = '';
  }
  const watchLabel = operation.phase === 'watch'
    ? `Watching ${Math.floor(operation.watchSeconds)}/${Math.floor(operation.watchTarget)}s: ${operation.subject}`
    : operationMessage(operation);
  jobUpdate(job, job.progress || 0, watchLabel);
}

async function runResearchJob(job, params) {
  job.status = 'running';
  job.pauseRequested = false;
  job._runnerStarted = true;
  job.params = params;
  job.discovery = {
    intensity: params.filters.intensity,
    timeBudget: params.timeBudget,
    candidateVideos: 0,
    channelsFound: 0,
    channelsScanned: 0,
    videosEvaluated: 0,
    queueDepth: 0,
    noveltyRate: 1,
    channelsPerMinute: 0,
    source: params.mode,
    ...(job.discovery || {})
  };
  jobUpdate(job, 4, params.usingDefaultSeeds ? 'Starting faceless outlier scan' : 'Starting research');

  let results = [];
  const errors = [];
  const warnings = [];

  if (params.mode === 'api') {
    if (!youtubePool.size) throw new Error('API precision requires a configured YouTube API key');
    results = await runApiResearch(params, job);
  } else {
    if (params.mode === 'browser' && !browserResearchAdapter) {
      throw new Error('Browser local requires the desktop application');
    }
    const source = params.mode === 'http'
      ? 'http'
      : browserResearchAdapter ? 'browser' : 'http';
    if (params.mode === 'auto' && source === 'http') {
      warnings.push('Local browser unavailable. Continuing with the public HTTP research engine.');
    }
    try {
      results = await runAutonomousResearch(params, job, { source });
    } catch (error) {
      if (params.mode !== 'auto' || source !== 'browser' || error instanceof ResearchCancelledError) throw error;
      warnings.push(`Local browser failed. Fast HTTP fallback activated: ${safeErrorMessage(error)}`);
      browserResearchAdapter?.endRun?.();
      if (activeBrowserJobId === job.id) activeBrowserJobId = '';
      researchStore.requeueFailedTasks(job.id);
      job.discovery = {
        ...(job.discovery || {}),
        fallbackFrom: 'browser',
        source: 'http',
        stopReason: ''
      };
      results = await runAutonomousResearch(params, job, { source: 'http' });
    }

    if (params.mode === 'auto' && results.length && youtubePool.size) {
      try {
        results = await enrichFinalistsWithApi(results, params, job);
      } catch (err) {
        if (err instanceof ResearchCancelledError) throw err;
        warnings.push(apiFallbackWarning(err));
      }
    }
  }

  if (params.filters.useGemini && results.length && geminiPool.size) {
    throwIfCancelled(job);
    try {
      job.insights = await buildGeminiInsights(results.slice(0, 18), params);
    } catch (err) {
      if (err instanceof ResearchCancelledError) throw err;
      warnings.push(`Gemini: ${safeErrorMessage(err)}`);
    }
  }

  const normalizedCandidates = applyChannelBaselines(results);
  const scoredResults = applySeenState(scoreAndSortResults(normalizedCandidates, params.filters));
  job.channels = buildChannelResults(scoredResults, researchStore.runChannels(job.id));
  persistChannelCandidates(job);
  results = diversifyByChannel(scoredResults, params.filters.resultLimit);
  job.niches = buildNicheSignals(results);
  job.discovery = summarizeDiscovery(job.discovery, results);
  job.discovery.funnel = researchFunnel(normalizedCandidates, job.channels, params.filters);

  lastResults = results;
  await writeJsonFile(lastFile, lastResults);

  job.status = 'complete';
  job.results = results;
  job.errors = [...job.errors, ...(!results.length ? warnings : []), ...errors];
  job.warnings = warnings;
  job.completedAt = new Date().toISOString();
  job.sessionId = persistResearchSession(job);
  job._runnerStarted = false;
  jobUpdate(job, 100, `Complete: ${results.length} videos`);
}

function scoreAndSortResults(results, filters) {
  return results
    .map(result => {
      const normalized = normalizeResult(result);
      normalized.presetStatus = presetMatchState(normalized, filters?.presetId).status;
      return normalized;
    })
    .filter(result => result.videoId && result.title)
    .filter(result => !result.isLive && !isShortsResult(result))
    .filter(result => withinPublishedRange(result, filters))
    .filter(result => languageLooksCompatible(result, filters.language))
    .filter(result => durationMatchesFilter(result, filters))
    .filter(result => resultMetricsMatch(result, filters))
    .filter(result => result.presetStatus !== 'rejected')
    .sort((a, b) => {
      if (filters.sort === 'views') return b.viewCount - a.viewCount;
      if (filters.sort === 'recent') return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0);
      if (filters.sort === 'viewsPerDay') return b.viewsPerDay - a.viewsPerDay;
      return b.outlierScore - a.outlierScore || b.viewCount - a.viewCount;
    });
}

function presetMatchState(result, presetId = 'all') {
  const preset = RESEARCH_PRESETS.has(String(presetId)) ? String(presetId) : 'all';
  if (preset === 'all') return { status: 'eligible', reason: 'all' };
  const views = finiteMetric(result.viewCount, { allowZero: true });
  const subscribers = finiteMetric(result.subscriberCount, { allowZero: true });
  const outlier = finiteMetric(result.outlierScore, { allowZero: true });
  const videos = finiteMetric(result.channelVideoCount, { allowZero: true });
  if (preset === 'small') {
    if (views !== null && views < 100000) return { status: 'rejected', reason: 'views' };
    if (subscribers !== null && subscribers > 10000) return { status: 'rejected', reason: 'subscribers' };
    return { status: views === null || subscribers === null ? 'pending' : 'eligible', reason: 'small' };
  }
  if (preset === 'medium') {
    if (views !== null && views < 1000000) return { status: 'rejected', reason: 'views' };
    if (subscribers !== null && subscribers > 25000) return { status: 'rejected', reason: 'subscribers' };
    return { status: views === null || subscribers === null ? 'pending' : 'eligible', reason: 'medium' };
  }
  if (preset === 'above1m') return views === null ? { status: 'pending', reason: 'views' } : { status: views >= 1000000 ? 'eligible' : 'rejected', reason: 'views' };
  if (preset === 'outlier') return outlier === null ? { status: 'pending', reason: 'baseline' } : { status: outlier >= 20 ? 'eligible' : 'rejected', reason: 'outlier' };
  if (preset === 'few') {
    if (views !== null && views < 1000000) return { status: 'rejected', reason: 'views' };
    if (videos !== null && videos > 10) return { status: 'rejected', reason: 'videos' };
    return { status: views === null || videos === null ? 'pending' : 'eligible', reason: 'few' };
  }
  if (preset === 'added') {
    const firstSeen = result.firstSeenAt ? daysSince(result.firstSeenAt) : null;
    return firstSeen === null ? { status: 'pending', reason: 'firstSeenAt' } : { status: firstSeen <= 7 ? 'eligible' : 'rejected', reason: 'firstSeenAt' };
  }
  if (preset === 'recent') return result.publishedAt ? { status: daysSince(result.publishedAt) <= 14 ? 'eligible' : 'rejected', reason: 'publishedAt' } : { status: 'pending', reason: 'publishedAt' };
  if (preset === 'long') return Number(result.durationSeconds) >= DEEP_LONG_MIN_SECONDS ? { status: 'eligible', reason: 'duration' } : { status: 'rejected', reason: 'duration' };
  if (preset === 'formula63k') {
    if (subscribers !== null && subscribers > 150000) return { status: 'rejected', reason: 'subscribers' };
    if (views !== null && views < 50000 && (outlier === null || outlier < 3)) return { status: 'rejected', reason: 'views' };
    if (result.durationSeconds > 0 && result.durationSeconds < 600) return { status: 'rejected', reason: 'duration' };
    if (isShortsResult(result)) return { status: 'rejected', reason: 'shorts' };
    return { status: views === null || subscribers === null ? 'pending' : 'eligible', reason: 'formula63k' };
  }
  return { status: 'eligible', reason: 'all' };
}

function resultMetricsMatch(result, filters = {}) {
  if (!metricWithin(result.viewCount, filters.minViews, filters.maxViews)) return false;
  if (!metricWithin(result.subscriberCount, filters.minSubscribers, filters.maxSubscribers)) return false;
  if (!metricWithin(result.channelVideoCount, 0, filters.maxChannelVideos)) return false;
  if (!metricWithin(result.outlierScore, filters.minOutlier, 0)) return false;
  if (!metricWithin(result.viewsPerDay, filters.minViewsPerDay, 0)) return false;
  if (!metricWithin(result.viewsPerSubscriber, filters.minViewsPerSubscriber, 0)) return false;
  return true;
}

function metricWithin(value, minimum = 0, maximum = 0) {
  if (!minimum && !maximum) return true;
  const metric = finiteMetric(value, { allowZero: true });
  if (metric === null) return false;
  if (minimum && metric < minimum) return false;
  if (maximum && metric > maximum) return false;
  return true;
}

function isShortsResult(result) {
  return /\/shorts\//i.test(result.url || '') || (result.durationSeconds > 0 && result.durationSeconds <= 60);
}

function durationMatchesFilter(result, filters) {
  if (filters.duration === 'long') return result.durationSeconds >= LONG_FORM_MIN_SECONDS && !isShortsResult(result);
  if (filters.duration === 'deepLong') return result.durationSeconds >= DEEP_LONG_MIN_SECONDS && !isShortsResult(result);
  if (filters.duration === 'twentyLong') return result.durationSeconds >= TWENTY_LONG_MIN_SECONDS && !isShortsResult(result);
  return result.durationSeconds >= LONG_FORM_MIN_SECONDS && !isShortsResult(result);
}

function usableWebCandidateCount(results, filters) {
  return mergeResults(results)
    .map(result => normalizeResult(result))
    .filter(result => result.videoId && result.title)
    .filter(result => withinPublishedRange(result, filters))
    .filter(result => languageLooksCompatible(result, filters.language))
    .filter(result => durationMatchesFilter(result, filters))
    .length;
}

function languageLooksCompatible(result, language) {
  const lang = String(language || '').toLowerCase();
  if (!/^(en|pt|es|fr|de|it|nl)/.test(lang)) return true;
  const text = String(result.title || '');
  const letters = [];
  for (const ch of text) {
    if (/\p{L}/u.test(ch)) letters.push(ch);
  }
  if (letters.length < 8) return true;
  const nonLatin = letters.filter(ch => ch.codePointAt(0) > 0x024f).length;
  return nonLatin <= 2 && nonLatin / letters.length <= 0.1;
}

function withinPublishedRange(result, filters) {
  if (!result.publishedAt) return !filters.publishedAfter;
  const published = new Date(result.publishedAt).getTime();
  if (!Number.isFinite(published)) return true;
  const after = filters.publishedAfter ? new Date(filters.publishedAfter).getTime() : 0;
  const before = filters.publishedBefore ? new Date(filters.publishedBefore).getTime() : 0;
  if (after && published < after) return false;
  if (before && published > before) return false;
  return true;
}

function normalizeResult(input) {
  const publishedAt = input.publishedAt || '';
  const ageDays = daysSince(publishedAt);
  const baseline = finiteMetric(input.baselineMedianViews) || finiteMetric(input.baselineAvgViews);
  const viewCount = finiteMetric(input.viewCount);
  const subscriberCount = finiteMetric(input.subscriberCount);
  const channelVideoCount = finiteMetric(input.channelVideoCount);
  const suppliedOutlier = finiteMetric(input.outlierScore);
  const outlierScore = baseline && viewCount ? viewCount / baseline : suppliedOutlier;
  const outlierEstimated = outlierScore
    ? null
    : finiteMetric(input.outlierEstimated) || estimateVelocitySignal(viewCount, publishedAt);

  const channelPublishedAt = normalizeIsoDate(input.channelPublishedAt);
  const firstObservedUploadAt = normalizeIsoDate(input.firstObservedUploadAt);
  const channelAgeSource = String(input.channelAgeSource || (channelPublishedAt ? 'youtube' : 'unknown'));
  const observedAgeIsVerified = ['oldest_upload', 'youtube_about', 'youtube', 'api'].includes(channelAgeSource);
  const channelAgeDate = channelPublishedAt || (observedAgeIsVerified ? firstObservedUploadAt : '');
  const channelAgeDays = channelAgeDate ? daysSince(channelAgeDate) : null;

  const normalized = {
    videoId: String(input.videoId || ''),
    title: String(input.title || '').trim(),
    url: input.url || `https://www.youtube.com/watch?v=${input.videoId}`,
    thumbnail: input.thumbnail || `https://i.ytimg.com/vi/${input.videoId}/hqdefault.jpg`,
    durationSeconds: Number(input.durationSeconds) || parseDuration(input.duration || ''),
    durationLabel: input.durationLabel || formatDuration(Number(input.durationSeconds) || parseDuration(input.duration || '')),
    publishedAt,
    publishedText: input.publishedText || formatAge(publishedAt),
    viewCount,
    viewText: viewCount === null ? 'n/a' : formatCompact(viewCount),
    viewsPerDay: viewCount !== null && ageDays ? viewCount / ageDays : null,
    channelId: String(input.channelId || ''),
    channelTitle: String(input.channelTitle || 'Unknown channel'),
    channelPath: String(input.channelPath || ''),
    handle: String(input.handle || handleFromChannelPath(input.channelPath) || ''),
    avatarUrl: String(input.avatarUrl || ''),
    bannerUrl: String(input.bannerUrl || ''),
    description: String(input.description || '').trim(),
    channelPublishedAt,
    firstObservedUploadAt,
    channelAgeDays,
    channelAgeSource,
    channelAgeConfidence: channelPublishedAt
      ? 0.98
      : observedAgeIsVerified && firstObservedUploadAt
        ? Number(input.channelAgeConfidence) || 0.78
        : 0,
    subscriberCount,
    subscriberText: subscriberCount === null ? 'n/a' : formatCompact(subscriberCount),
    channelVideoCount,
    channelTotalViews: finiteMetric(input.channelTotalViews),
    baselineMedianViews: baseline,
    baselineAvgViews: finiteMetric(input.baselineAvgViews) || baseline,
    baselineSampleSize: Number(input.baselineSampleSize) || 0,
    baselineConfidence: baseline ? clamp(Number(input.baselineConfidence) || 0.7, 0, 1) : 0,
    outlierScore,
    outlierEstimated,
    viewsPerSubscriber: subscriberCount && viewCount !== null ? viewCount / subscriberCount : null,
    sourceMode: input.sourceMode || 'api',
    confidence: clamp(input.confidence || (input.sourceMode === 'web' ? 0.48 : 0.9), 0, 1),
    reasons: Array.isArray(input.reasons) ? input.reasons : [],
    candidateScore: Number(input.candidateScore) || 0,
    topicSimilarity: Number(input.topicSimilarity) || 0,
    discoveryReason: String(input.discoveryReason || ''),
    decisionReason: String(input.decisionReason || ''),
    isLive: Boolean(input.isLive),
    visualSignals: input.visualSignals && typeof input.visualSignals === 'object' ? input.visualSignals : null
  };
  normalized.dataCoverage = computeDataCoverage(normalized);
  return normalized;
}

function normalizeIsoDate(value) {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function handleFromChannelPath(value) {
  const match = String(value || '').match(/\/(@[^/?#]+)/);
  return match ? match[1] : '';
}

function applySeenState(results) {
  return results.map(result => ({
    ...result,
    seen: Boolean(seenStore.seen[result.videoId]),
    saved: Boolean(seenStore.saved[result.videoId])
  }));
}

function mergeResults(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const item of list || []) {
      const id = item.videoId;
      if (!id) continue;
      const existing = map.get(id);
      if (!existing || (item.confidence || 0) > (existing.confidence || 0)) map.set(id, item);
    }
  }
  return [...map.values()];
}

function diversifyByChannel(results, limit) {
  const maxResults = Math.max(1, Number(limit) || RESEARCH_INTENSITIES[DEFAULT_INTENSITY].resultLimit);
  const selected = [];
  const selectedIds = new Set();
  const perChannel = new Map();

  for (const cap of [1, 2, 4, Number.POSITIVE_INFINITY]) {
    for (const item of results) {
      if (selected.length >= maxResults) return selected;
      if (selectedIds.has(item.videoId)) continue;

      const channelKey = item.channelId || item.channelTitle || item.videoId;
      const count = perChannel.get(channelKey) || 0;
      if (count >= cap) continue;

      selected.push(item);
      selectedIds.add(item.videoId);
      perChannel.set(channelKey, count + 1);
    }
  }

  return selected;
}

function buildNicheSignals(results) {
  const groups = new Map();

  for (const item of results) {
    const tokens = nicheTokens(`${item.title} ${item.channelTitle}`).slice(0, 4);
    for (const token of tokens) {
      const group = groups.get(token) || {
        id: token,
        label: titleCaseToken(token),
        videos: 0,
        channels: new Set(),
        totalViews: 0,
        topOutlier: 0,
        velocity: 0
      };
      group.videos += 1;
      group.channels.add(item.channelId || item.channelTitle || item.videoId);
      group.totalViews += Number(item.viewCount) || 0;
      group.topOutlier = Math.max(group.topOutlier, Number(item.outlierScore) || 0);
      group.velocity += Number(item.viewsPerDay) || 0;
      groups.set(token, group);
    }
  }

  return [...groups.values()]
    .map(group => ({
      id: group.id,
      label: group.label,
      videos: group.videos,
      channels: group.channels.size,
      totalViews: group.totalViews,
      topOutlier: group.topOutlier,
      velocity: group.velocity,
      opportunity: group.channels * 2 + Math.min(group.videos, 12) + Math.log10(Math.max(group.totalViews, 10))
    }))
    .filter(group => group.channels > 1)
    .sort((a, b) => b.opportunity - a.opportunity || b.totalViews - a.totalViews)
    .slice(0, 8);
}

function nicheTokens(value) {
  return [...new Set(String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, ' ')
    .split(/[\s_-]+/)
    .map(token => token.trim())
    .filter(token => token.length >= 4 && !NICHE_STOP_WORDS.has(token) && !/^\d+$/.test(token)))];
}

function titleCaseToken(value) {
  return String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .map(token => `${token.charAt(0).toUpperCase()}${token.slice(1)}`)
    .join(' ');
}

function summarizeDiscovery(discovery, results) {
  const channels = new Set(results.map(item => item.channelId || item.channelTitle).filter(Boolean)).size;
  return {
    ...(discovery || {}),
    intensity: discovery?.intensity || DEFAULT_INTENSITY,
    candidateVideos: Math.max(Number(discovery?.candidateVideos) || 0, results.length),
    channelsFound: Math.max(Number(discovery?.channelsFound) || 0, channels),
    channelsScanned: Number(discovery?.channelsScanned) || 0,
    resultVideos: results.length,
    resultChannels: channels
  };
}

function persistResearchSession(job) {
  const stats = researchStats(job.results || []);
  stats.channels = Math.max(stats.channels, job.channels?.length || 0, Number(job.discovery?.channelsFound) || 0);
  const session = {
    id: job.id,
    name: sessionName(job.params),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt || new Date().toISOString(),
    completedAt: job.completedAt || '',
    status: job.status || 'queued',
    progress: Number(job.progress) || 0,
    message: job.message || '',
    params: job.params,
    discovery: job.discovery || {},
    channels: job.channels || [],
    niches: job.niches || [],
    activity: job.activity || [],
    notes: '',
    stats,
    results: job.results || []
  };
  researchStore.saveSession(session);
  return session.id;
}

function sessionName(params) {
  const firstKeyword = params?.usingDefaultSeeds ? 'Faceless outlier scan' : params?.keywords?.[0];
  return String(firstKeyword || params?.seedChannels?.[0] || 'Research session').slice(0, 72);
}

function researchStats(results) {
  const channels = new Set(results.map(item => item.channelId || item.channelTitle).filter(Boolean));
  return {
    videos: results.length,
    channels: channels.size,
    totalViews: results.reduce((sum, item) => sum + (Number(item.viewCount) || 0), 0),
    saved: results.filter(item => item.saved).length
  };
}

function researchFunnel(results = [], channels = [], filters = {}) {
  const identifiedVideos = results.filter(item => stableChannelKey(item)).length;
  const enrichedChannels = channels.filter(item => Number(item.dataCoverage) >= 0.65).length;
  const threshold = Number(filters.facelessThreshold) || 60;
  const facelessChannels = channels.filter(item =>
    item.facelessStatus === 'strict' || (Number(item.facelessScore) >= threshold && item.facelessStatus !== 'rejected')
  ).length;
  const eligibleChannels = channels.filter(item => item.autoPotential || item.isBabyChannel || item.isAiBreakout).length;
  const presetStates = results.map(item => presetMatchState(item, filters.presetId));
  return {
    discoveredVideos: results.length,
    identifiedVideos,
    mappedChannels: channels.length,
    enrichedChannels,
    facelessChannels,
    eligibleChannels,
    pendingEnrichment: presetStates.filter(item => item.status === 'pending').length,
    presetEligible: presetStates.filter(item => item.status === 'eligible').length,
    presetRejected: presetStates.filter(item => item.status === 'rejected').length,
    facelessEligible: facelessChannels,
    exclusionReasons: presetStates.reduce((summary, item) => {
      if (item.status === 'rejected') summary[item.reason] = (summary[item.reason] || 0) + 1;
      return summary;
    }, {}),
    identityRate: results.length ? identifiedVideos / results.length : 0,
    enrichmentRate: channels.length ? enrichedChannels / channels.length : 0
  };
}

function sessionSummary(session) {
  return {
    id: session.id,
    name: session.name,
    createdAt: session.createdAt,
    completedAt: session.completedAt,
    updatedAt: session.updatedAt || session.completedAt || session.createdAt,
    status: session.status || 'complete',
    progress: Number(session.progress) || (session.completedAt ? 100 : 0),
    message: session.message || '',
    discovery: session.discovery || {},
    channels: Array.isArray(session.channels) ? session.channels.slice(0, 12) : [],
    niches: session.niches || [],
    stats: session.stats || researchStats(session.results || []),
    notes: session.notes || ''
  };
}

async function youtubeApi(pathname, params) {
  return youtubePool.requestJson(key => {
    const url = new URL(`https://www.googleapis.com/youtube/v3/${pathname}`);
    for (const [name, value] of Object.entries(params || {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, value);
    }
    url.searchParams.set('key', key);
    return { url: url.toString() };
  }, { rotateOnAnyError: true, maxAttempts: 4, timeoutMs: 12000 });
}

async function runAutonomousResearch(params, job, options = {}) {
  const source = options.source === 'browser' ? 'browser' : 'http';
  const budget = autonomousBudget(params);
  const candidates = new Map(researchStore.runVideos(job.id).map(item => [item.videoId, item]));
  const channels = new Map();
  for (const channel of researchStore.runChannels(job.id)) {
    const id = channel.channelId || channel.id || channel.channelTitle;
    if (id) channels.set(id, channel);
  }

  const queue = researchStore.loadTasks(job.id, ['queued', 'running']);
  const knownTaskKeys = new Set(queue.map(task => task.key));
  const noveltyHistory = [];
  let saturationWindows = Number(job.discovery?.saturationWindows) || 0;
  let completedTasks = Number(job.discovery?.completedTasks) || 0;
  let channelsScanned = Number(job.discovery?.channelsScanned) || 0;
  let failedTasks = 0;
  const taskYields = { ...(job.discovery?.taskYields || {}) };
  const startedAt = job._startedAt || Date.now();
  job._startedAt = startedAt;
  job.activity = Array.isArray(job.activity) ? job.activity : [];

  if (source === 'browser' && browserResearchAdapter?.beginRun) {
    const profile = await browserResearchAdapter.beginRun(params, {
      runId: job.id,
      deadlineAt: budget.deadlineAt,
      onProgress: telemetry => applyBrowserTelemetry(job, telemetry)
    });
    if (profile) {
      researchStore.saveBrowserProfile(profile);
      updateDiscovery(job, { profile });
    }
  }

  const enqueue = (type, payload, priority, depth = 0) => {
    const key = graphTaskKey(type, payload);
    if (!key || knownTaskKeys.has(key) || queue.length >= budget.maxQueuedTasks) return false;
    const task = {
      id: crypto.randomUUID(),
      key,
      type,
      payload,
      priority: Number(priority) || 0,
      depth: Number(depth) || 0,
      status: 'queued',
      attempts: 0,
      createdAt: new Date().toISOString()
    };
    knownTaskKeys.add(key);
    queue.push(task);
    researchStore.saveTask(job.id, task);
    if (type === 'keyword_search' || type === 'query_expansion') {
      researchStore.saveQuery(job.id, payload.query, type === 'keyword_search' ? 'seed' : 'derived', priority);
    }
    return true;
  };

  if (!queue.length) {
    const isMultiProfile = ['all_profiles', 'all'].includes(params.profileId);
    const isLoggedProfile = ['profile-1', 'profile-2'].includes(params.profileId);

    if (isMultiProfile) {
      enqueue('home_feed', {
        profileId: 'profile-1',
        maxAgeDays: params.filters.maxVideoAgeDays,
        fastScrapeMode: true
      }, 150, 0);
      enqueue('home_feed', {
        profileId: 'profile-2',
        maxAgeDays: params.filters.maxVideoAgeDays,
        fastScrapeMode: true
      }, 148, 0);
      enqueue('home_feed', {
        profileId: 'anonymous',
        maxAgeDays: params.filters.maxVideoAgeDays
      }, 145, 0);
    } else if (isLoggedProfile) {
      enqueue('home_feed', {
        profileId: params.profileId,
        maxAgeDays: params.filters.maxVideoAgeDays,
        fastScrapeMode: true
      }, 150, 0);
    } else if (params.scrapeHomeFeed) {
      enqueue('home_feed', {
        profileId: 'anonymous',
        maxAgeDays: params.filters.maxVideoAgeDays
      }, 140, 0);
    }

    if (!isLoggedProfile) {
      const windows = discoveryWindows(params.filters.maxVideoAgeDays);
      const searchProfileId = params.profileId || 'anonymous';
      params.keywords.forEach((query, index) => {
        windows.forEach((maxAgeDays, windowIndex) => {
          enqueue('keyword_search', {
            query,
            maxAgeDays,
            windowStage: `${maxAgeDays}d`,
            exactSeed: true,
            profileId: searchProfileId
          }, 124 - windowIndex * 18 - index, 0);
        });
        facelessQueryVariants(query).forEach((variant, variantIndex) => {
          enqueue('query_expansion', {
            query: variant,
            maxAgeDays: params.filters.maxVideoAgeDays,
            windowStage: `${params.filters.maxVideoAgeDays}d`,
            facelessExpansion: true,
            profileId: searchProfileId
          }, 66 - variantIndex - index, 1);
        });
      });
    }

    params.seedChannels.forEach((seed, index) => {
      const channelPath = channelPathFromInput(seed);
      if (channelPath) enqueue('channel_videos', {
        channelPath,
        seed,
        maxAgeDays: params.filters.maxVideoAgeDays,
        profileId: isLoggedProfile ? params.profileId : 'anonymous'
      }, 118 - index, 0);
    });
  }

  let homePasses = 0;
  while ((queue.length || Date.now() < budget.deadlineAt) && Date.now() < budget.deadlineAt) {
    await waitForJobControl(job, budget);

    if (!queue.length && Date.now() < budget.deadlineAt) {
      homePasses += 1;
      const isLoggedProfile = ['profile-1', 'profile-2'].includes(params.profileId);
      if (isLoggedProfile) {
        enqueue('home_feed', {
          profileId: params.profileId,
          maxAgeDays: params.filters.maxVideoAgeDays,
          fastScrapeMode: true,
          iteration: homePasses,
          nonce: crypto.randomUUID()
        }, 80, 1);
      } else {
        const topCandidates = [...candidates.values()].sort((a, b) => (b.outlierScore || 0) - (a.outlierScore || 0));
        const freshQueries = deriveGraphQueries(topCandidates, params.keywords, 6);
        for (const query of freshQueries) {
          enqueue('query_expansion', {
            query,
            maxAgeDays: params.filters.maxVideoAgeDays,
            windowStage: `${params.filters.maxVideoAgeDays}d`,
            facelessExpansion: true,
            profileId: 'anonymous'
          }, 64, 2);
        }
      }
      for (const chan of channels.values()) {
        if (chan.channelPath && !knownTaskKeys.has(`channel_videos:${chan.channelPath}`)) {
          enqueue('channel_videos', {
            channelPath: chan.channelPath,
            seed: chan.channelTitle,
            maxAgeDays: params.filters.maxVideoAgeDays,
            profileId: isLoggedProfile ? params.profileId : 'anonymous'
          }, 72, 1);
        }
      }
      for (const candidate of candidates.values()) {
        if (candidate.videoId && !knownTaskKeys.has(`related:${candidate.videoId}`)) {
          enqueue('related_video', {
            videoId: candidate.videoId,
            title: candidate.title,
            candidateScore: candidate.candidateScore || 0,
            maxAgeDays: params.filters.maxVideoAgeDays,
            profileId: isLoggedProfile ? params.profileId : 'anonymous'
          }, 76, 1);
        }
      }
      if (!queue.length) {
        await delay(1500);
        continue;
      }
    }

    queue.sort((a, b) =>
      adaptiveTaskPriority(b, taskYields) - adaptiveTaskPriority(a, taskYields)
      || String(a.createdAt).localeCompare(String(b.createdAt))
    );
    const concurrency = source === 'browser' && browserResearchAdapter
      ? clamp(browserResearchAdapter.recommendedConcurrency?.() || 1, 1, 2)
      : 1;
    const batch = queue.splice(0, concurrency);
    for (const task of batch) {
      task.status = 'running';
      task.attempts += 1;
      researchStore.updateTask(job.id, task, 'running');
      const operation = operationFromTask(task, source, 'running');
      job.currentOperation = operation;
      pushActivity(job, operationMessage(operation), 'info', operation);
    }
    jobUpdate(job, job.progress || 0, operationMessage(job.currentOperation));

    const outputs = await executeGraphBatch(batch, source);

    for (let index = 0; index < batch.length; index += 1) {
      const task = batch[index];
      const output = outputs[index] || {};
      if (output.attention) {
        task.attempts = (task.attempts || 0) + 1;
        if (task.attempts >= 3) {
          task.status = 'queued';
          researchStore.updateTask(job.id, task, 'queued');
          queue.push(task); // Move to back of queue instead of unshift to avoid infinite immediate lock
          pushActivity(job, `Avançando para a próxima tarefa após verificação do navegador: ${task.type}`, 'info');
          continue;
        }
        task.status = 'queued';
        researchStore.updateTask(job.id, task, 'queued');
        queue.unshift(task);
        job.status = 'needs_attention';
        job.pauseRequested = true;
        jobUpdate(job, job.progress || 0, output.message || 'Research browser needs attention');
        await waitForJobControl(job, budget);
        continue;
      }

      if (output.timedOut) {
        task.status = 'queued';
        researchStore.updateTask(job.id, task, 'queued');
        queue.unshift(task);
        continue;
      }

      if (output.error) {
        failedTasks += 1;
        const retry = task.attempts < 2;
        task.status = retry ? 'queued' : 'failed';
        task.priority -= 8;
        researchStore.updateTask(job.id, task, task.status);
        if (retry) queue.push(task);
        pushActivity(job, `Skipped ${task.type}: ${safeErrorMessage(output.error)}`, 'warning', {
          ...operationFromTask(task, source, 'skipped'), workerId: output.workerId ?? null
        });
        continue;
      }

      const registration = researchStore.transaction(() => registerGraphOutput({
        job,
        task,
        output,
        candidates,
        channels,
        enqueue,
        source
      }));
      noveltyHistory.push(registration.newChannels);
      if (noveltyHistory.length > SATURATION_TASK_WINDOW * SATURATION_REQUIRED_WINDOWS) noveltyHistory.shift();
      completedTasks += 1;
      const yieldEntry = taskYields[task.type] || { tasks: 0, channels: 0, videos: 0 };
      yieldEntry.tasks += 1;
      yieldEntry.channels += registration.newChannels;
      yieldEntry.videos += registration.newVideos;
      taskYields[task.type] = yieldEntry;
      task.priority += registration.newChannels > 0
        ? Math.min(16, registration.newChannels * 2)
        : registration.newVideos > 0 ? 1 : -10;
      if (task.type === 'channel_videos') channelsScanned += 1;
      task.status = 'complete';
      researchStore.updateTask(job.id, task, 'complete', registration.newChannels);
      const completedOperation = {
        ...operationFromTask(task, source, 'complete'),
        workerId: output.workerId ?? null,
        completedAt: new Date().toISOString(),
        newChannels: registration.newChannels,
        newVideos: registration.newVideos
      };
      job.currentOperation = completedOperation;
      pushActivity(job, activityMessage(task, registration), 'success', completedOperation);

      if (completedTasks % 8 === 0) {
        for (const query of deriveGraphQueries([...candidates.values()], params.keywords, 3)) {
          enqueue('query_expansion', {
            query,
            maxAgeDays: params.filters.maxVideoAgeDays,
            windowStage: `${params.filters.maxVideoAgeDays}d`,
            facelessExpansion: true
          }, 64, task.depth + 1);
        }
      }

      if (completedTasks % SATURATION_TASK_WINDOW === 0) {
        const window = noveltyHistory.slice(-SATURATION_TASK_WINDOW);
        const noveltyRate = window.length ? window.filter(Boolean).length / window.length : 1;
        saturationWindows = noveltyRate < SATURATION_NOVELTY_RATE ? saturationWindows + 1 : 0;
      }
    }

    const elapsedMinutes = Math.max((Date.now() - startedAt) / 60000, 1 / 60);
    const recentWindow = noveltyHistory.slice(-SATURATION_TASK_WINDOW);
    const noveltyRate = recentWindow.length ? recentWindow.filter(Boolean).length / recentWindow.length : 1;
    const liveResults = applySeenState(scoreAndSortResults(applyChannelBaselines([...candidates.values()]), params.filters));
    job.results = diversifyByChannel(liveResults, params.filters.resultLimit);
    job.channels = buildChannelResults(liveResults, [...channels.values()]);
    persistChannelCandidates(job);
    job.niches = buildNicheSignals(job.results);
    updateDiscovery(job, {
      timeBudget: budget.key,
      source,
      candidateVideos: candidates.size,
      videosEvaluated: candidates.size,
      channelsFound: channels.size,
      channelsScanned,
      queueDepth: queue.length,
      completedTasks,
      saturationWindows,
      noveltyRate,
      channelsPerMinute: channels.size / elapsedMinutes,
      browser: browserResearchAdapter?.status?.() || { available: false },
      taskYields,
      funnel: researchFunnel(applyChannelBaselines([...candidates.values()]), job.channels, params.filters)
    });
    const elapsedShare = (Date.now() - startedAt) / Math.max(budget.deadlineMs, 1);
    jobUpdate(
      job,
      Math.min(94, 8 + elapsedShare * 86),
      `${channels.size} channels discovered · ${queue.length} tasks queued`
    );

    if (saturationWindows >= SATURATION_REQUIRED_WINDOWS) {
      job.discovery.stopReason = 'saturation';
      pushActivity(job, 'Research reached saturation: channel novelty stayed below 3%.', 'info');
      break;
    }
  }

  if (Date.now() >= budget.deadlineAt) job.discovery.stopReason = 'time_budget';
  else if (!queue.length && !job.discovery.stopReason) job.discovery.stopReason = 'queue_complete';
  if (!candidates.size && failedTasks) {
    throw new Error(`Autonomous research could not reach YouTube after ${failedTasks} attempts`);
  }
  return [...candidates.values()];
}

async function executeHttpGraphTask(task) {
  try {
    const url = graphTaskUrl(task);
    if (!url) return { items: [] };
    const html = await fetchText(url, task.payload);
    const endpointKind = ['keyword_search', 'query_expansion'].includes(task.type) ? 'search' : 'browse';
    const parsed = parseYoutubePage(html, endpointKind);
    const items = [...parsed.items];
    let continuationToken = parsed.continuationToken;
    const continuationPages = task.type === 'keyword_search' ? 3 : task.type === 'channel_videos' ? 2 : 1;
    for (let page = 0; page < continuationPages && continuationToken && parsed.cfg?.apiKey; page += 1) {
      try {
        const more = await fetchYoutubeiContinuation(endpointKind === 'search' ? 'search' : 'browse', continuationToken, parsed.cfg);
        items.push(...more.items);
        continuationToken = more.continuationToken;
      } catch {
        break;
      }
    }
    const maxAgeDays = Math.round(clamp(task.payload?.maxAgeDays || DEFAULT_RECENT_DAYS, 7, DEFAULT_RECENT_DAYS));
    return {
      items: mergeResults(items)
        .map(item => ({ ...item, sourceMode: 'http', confidence: Math.max(item.confidence || 0, 0.52) }))
        .filter(item => taskAgeMatches(item, maxAgeDays)),
      channel: parsed.channel || null,
      url
    };
  } catch (error) {
    return { error };
  }
}

async function executeGraphBatch(tasks, source) {
  const outputs = new Array(tasks.length);
  const pending = [];
  const pendingIndexes = [];
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    const ttl = graphTaskTtl(task.type);
    const allowBrowserCache = task.type === 'channel_videos';
    const cached = (source !== 'browser' || allowBrowserCache) && ttl ? researchStore.freshSnapshot('task', task.key, ttl) : null;
    if (cached) {
      outputs[index] = { ...cached, cached: true };
    } else {
      pending.push(task);
      pendingIndexes.push(index);
    }
  }

  if (pending.length) {
    const fresh = source === 'browser'
      ? await browserResearchAdapter.executeTasks(pending)
      : await Promise.all(pending.map(task => executeHttpGraphTask(task)));
    for (let index = 0; index < fresh.length; index += 1) {
      const output = fresh[index] || {};
      const targetIndex = pendingIndexes[index];
      outputs[targetIndex] = output;
      if (!output.error && !output.attention) researchStore.saveSnapshot('task', pending[index].key, output);
    }
  }
  return outputs;
}

function graphTaskTtl(type) {
  if (type === 'related_video') return 12 * 60 * 60 * 1000;
  if (type === 'channel_videos') return 7 * 24 * 60 * 60 * 1000;
  if (type === 'featured_channels') return 3 * 24 * 60 * 60 * 1000;
  return 0;
}

function graphTaskUrl(task) {
  const lang = encodeURIComponent(task.payload?.language || 'en');
  const region = encodeURIComponent(task.payload?.region || 'US');
  const locParams = `&hl=${lang}&gl=${region}`;
  if (task.type === 'home_feed') return `https://www.youtube.com/?hl=${lang}&gl=${region}`;
  if (task.type === 'keyword_search' || task.type === 'query_expansion') {
    const query = encodeURIComponent(task.payload.query || '');
    const duration = String(task.payload?.duration || '');
    const spToken = duration === 'twentyLong' ? '&sp=CAMSAggF' : '&sp=CAMSAggD';
    return `https://www.youtube.com/results?search_query=${query}${spToken}${locParams}`;
  }
  if (task.type === 'related_video') {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(task.payload.videoId || '')}${locParams}`;
  }
  if (task.type === 'channel_videos') {
    return `https://www.youtube.com/${String(task.payload.channelPath || '').replace(/^\/+/, '')}/videos?hl=${lang}&gl=${region}`;
  }
  if (task.type === 'featured_channels') {
    return `https://www.youtube.com/${String(task.payload.channelPath || '').replace(/^\/+/, '')}/channels?hl=${lang}&gl=${region}`;
  }
  return '';
}

function graphTaskKey(type, payload = {}) {
  if (type === 'home_feed') return `home_feed:${payload.profileId || 'anonymous'}:${payload.iteration || ''}:${payload.nonce || ''}`;
  if (type === 'keyword_search' || type === 'query_expansion') {
    return `search:${String(payload.query || '').trim().toLowerCase()}:${Number(payload.maxAgeDays) || DEFAULT_RECENT_DAYS}`;
  }
  if (type === 'related_video') return `related:${payload.videoId || ''}`;
  if (type === 'channel_videos') return `channel:${payload.channelPath || payload.seed || ''}`;
  if (type === 'featured_channels') return `featured:${payload.channelPath || ''}`;
  return `${type}:${JSON.stringify(payload)}`;
}

function adaptiveTaskPriority(task, taskYields = {}) {
  const history = taskYields[task.type];
  if (!history?.tasks) return Number(task.priority) || 0;
  const channelYield = history.channels / history.tasks;
  const videoYield = history.videos / history.tasks;
  const reward = Math.min(24, channelYield * 8 + videoYield * 0.35);
  const depthPenalty = Math.max(0, Number(task.depth) || 0) * 1.5;
  return (Number(task.priority) || 0) + reward - depthPenalty;
}

function discoveryWindows(maxAgeDays) {
  const max = Math.round(clamp(maxAgeDays || DEFAULT_RECENT_DAYS, 7, DEFAULT_RECENT_DAYS));
  const windows = DISCOVERY_WINDOWS_DAYS.filter(days => days <= max);
  if (!windows.includes(max)) windows.push(max);
  return [...new Set(windows)].sort((a, b) => a - b);
}

function facelessQueryVariants(query) {
  const value = String(query || '').trim();
  if (!value) return [];
  const variants = [];
  if (!/\bdocumentar|explained|hist[oó]ria|story|facts?|animation|analysis|case study|investigation|iceberg/i.test(value)) {
    variants.push(`${value} documentary`, `${value} explained`, `${value} case study`, `${value} investigation`);
  } else {
    variants.push(`${value} untold`, `${value} deep dive`, `${value} iceberg archive`);
  }
  return variants;
}

function taskAgeMatches(item, maxAgeDays) {
  if (!item?.publishedAt) return false;
  return daysSince(item.publishedAt) <= Math.round(clamp(maxAgeDays, 7, DEFAULT_RECENT_DAYS));
}

function registerGraphOutput({ job, task, output, candidates, channels, enqueue, source }) {
  if (output.profile) researchStore.saveBrowserProfile(output.profile);
  for (const event of Array.isArray(output.watchEvents) ? output.watchEvents : []) {
    researchStore.saveWatchEvent(job.id, event);
  }
  if (output.decision) researchStore.saveDecision(job.id, task.id, output.decision);
  let items = mergeResults(output.items || [])
    .filter(item => item.videoId && !isShortsResult(item));
  if (task.type === 'channel_videos' && items.length) {
    const viewCounts = items
      .filter(item => !task.payload.triggerVideoId || item.videoId !== task.payload.triggerVideoId)
      .map(item => Number(item.viewCount) || 0)
      .filter(Boolean);
    const baseline = output.baseline?.observations
      ? output.baseline
      : { median: median(viewCounts), avg: avg(viewCounts), observations: viewCounts.length };
    const baselineId = task.payload.channelId || task.payload.channelPath || task.key;
    researchStore.saveSnapshot('baseline', baselineId, baseline);
    items = items.map(item => ({
      ...item,
      baselineMedianViews: item.baselineMedianViews || (baseline.observations >= 3 ? baseline.median : null),
      baselineAvgViews: item.baselineAvgViews || (baseline.observations >= 3 ? baseline.avg : null),
      baselineSampleSize: Number(item.baselineSampleSize) || baseline.observations || 0
    }));
  }
  let newChannels = 0;
  let newVideos = 0;
  const taskProfileId = task.payload?.profileId || output.profile?.id || (job.params?.profileId && job.params.profileId !== 'all_profiles' ? job.params.profileId : '') || 'anonymous';
  const profileLabel = taskProfileId === 'profile-1'
    ? '👤 Perfil 1'
    : taskProfileId === 'profile-2'
      ? '👤 Perfil 2'
      : '🕶️ Anônimo';

  for (const rawItem of items) {
    const item = normalizeResult({
      ...rawItem,
      discoveryProfile: rawItem.discoveryProfile || taskProfileId,
      discoveryProfileLabel: rawItem.discoveryProfileLabel || profileLabel,
      sourceMode: rawItem.sourceMode || source,
      confidence: rawItem.confidence || (source === 'browser' ? 0.68 : 0.52)
    });
    if (!item.videoId || isShortsResult(item)) continue;
    const existing = candidates.get(item.videoId);
    if (!existing || item.confidence > existing.confidence) candidates.set(item.videoId, item);
    if (researchStore.upsertVideo(item, job.id, task.id)) newVideos += 1;

    const channelId = stableChannelKey(item);
    if (channelId) {
      const outputChannel = output.channel && (
        output.channel.channelId === item.channelId
        || output.channel.channelTitle === item.channelTitle
        || task.type === 'channel_videos'
      ) ? output.channel : {};
      const channel = {
        ...outputChannel,
        channelId,
        channelTitle: outputChannel.channelTitle || item.channelTitle,
        channelPath: outputChannel.channelPath || item.channelPath,
        handle: outputChannel.handle || item.handle,
        avatarUrl: outputChannel.avatarUrl || item.avatarUrl,
        bannerUrl: outputChannel.bannerUrl || item.bannerUrl,
        description: outputChannel.description || item.description,
        channelPublishedAt: outputChannel.channelPublishedAt || item.channelPublishedAt,
        firstObservedUploadAt: outputChannel.firstObservedUploadAt || item.firstObservedUploadAt,
        channelAgeSource: outputChannel.channelAgeSource || item.channelAgeSource,
        visualSignals: outputChannel.visualSignals || item.visualSignals,
        subscriberCount: finiteMetric(outputChannel.subscriberCount) || finiteMetric(item.subscriberCount),
        channelVideoCount: maxKnown(outputChannel.channelVideoCount, item.channelVideoCount),
        channelTotalViews: maxKnown(outputChannel.channelTotalViews, item.channelTotalViews),
        confidence: Math.max(Number(outputChannel.confidence) || 0, Number(item.confidence) || 0),
        sourceMode: outputChannel.sourceMode || item.sourceMode,
        discoveryProfile: outputChannel.discoveryProfile || item.discoveryProfile || taskProfileId,
        discoveryProfileLabel: outputChannel.discoveryProfileLabel || item.discoveryProfileLabel || profileLabel,
        decisionReason: item.discoveryReason || item.decisionReason || output.decision?.reason || '',
        discoveryPath: [
          task.payload.query || task.payload.title || task.payload.videoId || task.type,
          item.title,
          item.channelTitle
        ].filter(Boolean)
      };
      channels.set(channelId, mergeChannelMetadata(channels.get(channelId), channel));
      if (researchStore.upsertChannel(channel, job.id, task.id)) {
        newChannels += 1;
        if ((item.channelId || item.channelPath) && quickFacelessContentScore(item) >= 35) {
          const channelPath = String(item.channelPath || `channel/${item.channelId}`).replace(/^\/+/, '');
          enqueue('channel_videos', {
            channelPath,
            channelId: item.channelId,
            triggerVideoId: item.videoId,
            maxAgeDays: task.payload.maxAgeDays || DEFAULT_RECENT_DAYS
          }, 72 + presetEnrichmentBoost(item, job.params?.filters?.presetId) - task.depth * 2, task.depth + 1);
          enqueue('featured_channels', { channelPath, channelId: item.channelId }, 34 - task.depth, task.depth + 1);
        }
      }
      researchStore.addEdge(job.id, task.payload.videoId || task.key, channelId, task.type);
    }
  }

  const relatedCandidates = (output.allowRelatedExpansion === false ? [] : items)
    .filter(item => item.videoId && (item.durationSeconds === 0 || item.durationSeconds >= LONG_FORM_MIN_SECONDS))
    .filter(item => quickFacelessContentScore(item) >= 45)
    .sort((a, b) => (b.candidateScore || 0) - (a.candidateScore || 0) || (b.viewCount || 0) - (a.viewCount || 0))
    .filter((item, index, list) => list.findIndex(candidate => stableChannelKey(candidate) === stableChannelKey(item)) === index)
    .slice(0, 8);
  for (const item of task.depth < MAX_RECOMMENDATION_DEPTH ? relatedCandidates : []) {
    enqueue('related_video', {
      videoId: item.videoId,
      title: item.title,
      candidateScore: item.candidateScore || 0,
      sourceVideoId: task.payload.videoId || '',
      maxAgeDays: task.payload.maxAgeDays || DEFAULT_RECENT_DAYS
    }, 84 + Math.min(Number(item.candidateScore) || 0, 100) / 10 - task.depth * 3, task.depth + 1);
    researchStore.addEdge(job.id, task.payload.videoId || task.key, item.videoId, 'related');
  }
  return { newChannels, newVideos, items: items.length };
}

function presetEnrichmentBoost(item, presetId) {
  const state = presetMatchState(item, presetId);
  if (state.status === 'pending') return 24;
  if (state.status === 'eligible') return 14;
  return -18;
}

function mergeChannelMetadata(previous, next) {
  const merged = { ...(previous || {}) };
  for (const [key, value] of Object.entries(next || {})) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'number') merged[key] = Math.max(Number(merged[key]) || 0, value);
    else if (Array.isArray(value)) merged[key] = value.length ? value : merged[key];
    else if (typeof value === 'object') merged[key] = { ...(merged[key] || {}), ...value };
    else merged[key] = merged[key] || value;
  }
  return merged;
}

function quickFacelessContentScore(item) {
  const text = `${item?.title || ''} ${item?.channelTitle || ''}`;
  const positive = patternHits(text, FACELESS_POSITIVE_PATTERNS);
  const negative = patternHits(text, FACELESS_NEGATIVE_PATTERNS);
  const firstPerson = /\b(i|my|me|mine|eu|meu|minha)\b/i.test(text);
  return clamp(50 + Math.min(positive, 3) * 13 - Math.min(negative, 3) * 22 - (firstPerson ? 12 : 0), 0, 100);
}

function deriveGraphQueries(results, seeds, limit = 3) {
  const seedText = new Set((seeds || []).map(value => String(value).toLowerCase()));
  const scores = new Map();
  for (const item of results.slice(-240)) {
    const tokens = nicheTokens(item.title).slice(0, 8);
    for (let index = 0; index < tokens.length - 1; index += 1) {
      const phrase = `${tokens[index]} ${tokens[index + 1]}`;
      const entry = scores.get(phrase) || { score: 0, channels: new Set() };
      entry.score += 1 + Math.log10(Math.max(Number(item.viewCount) || 10, 10)) / 4;
      entry.channels.add(item.channelId || item.channelTitle || item.videoId);
      scores.set(phrase, entry);
    }
  }
  return [...scores.entries()]
    .filter(([phrase, value]) => value.channels.size > 1 && !seedText.has(phrase))
    .sort((a, b) => (b[1].score + b[1].channels.size * 2) - (a[1].score + a[1].channels.size * 2))
    .slice(0, limit)
    .map(([phrase]) => phrase);
}

function pushActivity(job, message, level = 'info', details = {}) {
  job.activity = [...(job.activity || []), {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    level,
    message,
    ...details
  }].slice(-40);
}

function operationFromTask(task, source, status) {
  const subject = task?.type === 'home_feed'
    ? 'Home Feed'
    : (task?.payload?.query || task?.payload?.title || task?.payload?.channelPath || task?.payload?.videoId || task?.type || '');
  const phases = {
    home_feed: 'home', keyword_search: 'search', query_expansion: 'expand', related_video: 'related',
    channel_videos: 'channel', featured_channels: 'channels', enrichment: 'enrich'
  };
  const cursorActions = {
    home_feed: 'scan', keyword_search: 'search', query_expansion: 'search', related_video: 'select',
    channel_videos: 'scan', featured_channels: 'scan', enrichment: 'compare'
  };
  return {
    phase: phases[task?.type] || 'research',
    taskType: task?.type || 'research',
    subject,
    source,
    status,
    depth: Number(task?.depth) || 0,
    startedAt: new Date().toISOString(),
    cursorAction: cursorActions[task?.type] || 'scan'
  };
}

function operationMessage(operation) {
  const labels = {
    home: 'Scanning personalized home feed', search: 'Searching YouTube', expand: 'Expanding query', related: 'Opening related videos',
    channel: 'Studying channel', channels: 'Discovering featured channels', enrich: 'Enriching finalists',
    research: 'Researching'
  };
  return `${labels[operation?.phase] || labels.research}${operation?.subject ? `: ${operation.subject}` : ''}`;
}

function activityMessage(task, registration) {
  const subject = task.type === 'home_feed'
    ? 'Home Feed'
    : (task.payload.query || task.payload.title || task.payload.channelId || task.type);
  return `${subject}: ${registration.newChannels} new channels, ${registration.newVideos} new videos`;
}

async function enrichFinalistsWithApi(results, params, job) {
  await waitForJobControl(job);
  const ids = results.slice(0, 100).map(item => item.videoId).filter(Boolean);
  if (!ids.length) return results;
  jobUpdate(job, Math.max(job.progress || 0, 94), `API precision pass: ${ids.length} finalists`);
  const videos = await videosListApi(ids);
  const channelIds = [...new Set(videos.map(video => video.snippet?.channelId).filter(Boolean))];
  const channelMap = await channelsListApi(channelIds);
  const baselineMap = new Map();
  for (const item of results) {
    if (!item.channelId || baselineMap.has(item.channelId)) continue;
    baselineMap.set(item.channelId, { median: item.baselineMedianViews || 0, avg: item.baselineAvgViews || 0 });
  }
  const precise = videos.map(video => normalizeApiVideo(
    video,
    channelMap.get(video.snippet?.channelId),
    baselineMap.get(video.snippet?.channelId)
  ));
  return mergeResults(precise, results);
}

function buildChannelResults(results, storedChannels = []) {
  const groups = new Map();
  const pinnedChannels = researchStore.pinnedChannelIds();
  for (const channel of storedChannels) {
    const id = stableChannelKey(channel);
    if (id) groups.set(id, { ...channel, channelId: id, videos: [] });
  }
  for (const item of results) {
    const id = stableChannelKey(item);
    if (!id) continue;
    const group = groups.get(id) || { channelId: id, channelTitle: item.channelTitle, videos: [] };
    group.channelTitle = group.channelTitle || item.channelTitle;
    group.channelPath = group.channelPath || item.channelPath;
    group.handle = group.handle || item.handle;
    group.avatarUrl = group.avatarUrl || item.avatarUrl;
    group.bannerUrl = group.bannerUrl || item.bannerUrl;
    group.description = group.description || item.description;
    group.channelPublishedAt = group.channelPublishedAt || item.channelPublishedAt;
    group.firstObservedUploadAt = group.firstObservedUploadAt || item.firstObservedUploadAt;
    group.channelAgeSource = group.channelAgeSource || item.channelAgeSource;
    group.visualSignals = group.visualSignals || item.visualSignals;
    group.subscriberCount = maxKnown(group.subscriberCount, item.subscriberCount);
    group.channelVideoCount = maxKnown(group.channelVideoCount, item.channelVideoCount);
    group.channelTotalViews = maxKnown(group.channelTotalViews, item.channelTotalViews);
    group.confidence = Math.max(Number(group.confidence) || 0, Number(item.confidence) || 0);
    group.sourceMode = group.sourceMode || item.sourceMode;
    group.videos.push(item);
    groups.set(id, group);
  }

  return [...groups.values()].map(group => {
    const videos = group.videos || [];
    const outliers = videos.map(item => finiteMetric(item.outlierScore)).filter(value => value !== null);
    const velocities = videos.map(item => finiteMetric(item.viewsPerDay)).filter(value => value !== null);
    const efficiencies = videos.map(item => finiteMetric(item.viewsPerSubscriber)).filter(value => value !== null);
    const medianOutlier = outliers.length ? median(outliers) : null;
    const avgVelocity = velocities.length ? avg(velocities) : null;
    const avgEfficiency = efficiencies.length ? avg(efficiencies) : null;
    const consistency = outliers.length >= MIN_CONSISTENCY_VIDEOS
      ? outliers.filter(value => value >= Math.max(2, medianOutlier || 2)).length / outliers.length
      : null;
    const rankedVideos = [...videos].sort((a, b) =>
      opportunityVideoScore(b) - opportunityVideoScore(a)
        || (Number(b.viewsPerDay) || 0) - (Number(a.viewsPerDay) || 0)
        || (Number(b.viewCount) || 0) - (Number(a.viewCount) || 0)
    );
    const topVideo = rankedVideos[0] || null;
    const velocityScore = avgVelocity !== null ? clamp(Math.log10(Math.max(avgVelocity, 1)) * 18, 0, 100) : null;
    const outlierMetric = medianOutlier !== null ? clamp(Math.log10(Math.max(medianOutlier, 1)) * 50, 0, 100) : null;
    const efficiencyScore = avgEfficiency !== null ? clamp(Math.log10(Math.max(avgEfficiency, 1)) * 24, 0, 100) : null;
    const consistencyScore = consistency !== null ? consistency * 100 : null;
    const channelPublishedAt = normalizeIsoDate(group.channelPublishedAt);
    const trustedObservedAge = ['oldest_upload', 'youtube_about', 'youtube', 'api'].includes(group.channelAgeSource)
      ? normalizeIsoDate(group.firstObservedUploadAt)
      : '';
    const firstObservedUploadAt = trustedObservedAge;
    const channelAgeDate = channelPublishedAt || trustedObservedAge;
    const channelAgeDays = channelAgeDate ? daysSince(channelAgeDate) : null;
    const channelAgeSource = group.channelAgeSource
      || (channelPublishedAt ? 'youtube' : firstObservedUploadAt ? 'observed_upload' : 'unknown');
    const newnessScore = channelAgeDays === null
      ? 35
      : clamp(100 - (channelAgeDays / DEFAULT_RECENT_DAYS) * 100, 0, 100);
    const hasSubscriberData = efficiencies.length > 0 && finiteMetric(group.subscriberCount) !== null;
    const opportunityScore = weightedAvailableScore([
      { value: outlierMetric, weight: 0.30, available: outlierMetric !== null },
      { value: newnessScore, weight: 0.25, available: channelAgeDays !== null },
      { value: velocityScore, weight: 0.20, available: velocityScore !== null },
      { value: efficiencyScore, weight: 0.15, available: hasSubscriberData && efficiencyScore !== null },
      { value: consistencyScore, weight: 0.10, available: consistencyScore !== null }
    ]);
    const feedback = researchStore.channelFeedback(group.channelId);
    const faceless = classifyFacelessChannel({
      ...group,
      channelPublishedAt,
      firstObservedUploadAt,
      channelAgeDays,
      channelAgeSource
    }, videos, feedback?.label || '');
    const dataCoverage = computeDataCoverage({
      ...group,
      channelAgeDays,
      baselineMedianViews: topVideo?.baselineMedianViews,
      viewCount: topVideo?.viewCount,
      publishedAt: topVideo?.publishedAt,
      durationSeconds: topVideo?.durationSeconds
    });
    const confidence = clamp(
      (Number(group.confidence) || 0.5) * 0.55 + faceless.confidence * 0.45 - (hasSubscriberData ? 0 : 0.05),
      0,
      1
    );
    const recentLong = Boolean(
      topVideo
      && daysSince(topVideo.publishedAt) <= DEFAULT_RECENT_DAYS
      && Number(topVideo.durationSeconds) >= LONG_FORM_MIN_SECONDS
    );
    const presetViral = Boolean(topVideo && (
      (topVideo.viewCount >= 100000 && group.subscriberCount > 0 && group.subscriberCount <= 10000)
      || (topVideo.viewCount >= 1000000 && group.subscriberCount > 0 && group.subscriberCount <= 25000)
      || finiteMetric(topVideo.outlierScore) >= 20
    ));
    const autoPotential = recentLong
      && faceless.status === 'strict'
      && confidence >= DEFAULT_FACELESS_CONFIDENCE
      && dataCoverage >= 0.65
      && (opportunityScore >= 65 || presetViral);
    const fingerprint = buildFormatFingerprint(group, videos);
    const dossier = buildOpportunityDossier(group, videos, fingerprint);
    const babyInfo = evaluateBabyChannel(group, videos);
    const effectiveFirstUpload = firstObservedUploadAt || babyInfo.firstUploadAt;
    const potentialReason = channelPotentialReason({
      autoPotential,
      presetViral,
      recentLong,
      facelessStatus: faceless.status,
      channelAgeDays,
      opportunityScore
    });
    const recommendationReason = autoPotential
      ? `${Math.round(opportunityScore)} opportunity: ${Math.round(outlierMetric)} outlier signal, ${Math.round(newnessScore)} newness`
      : potentialReason;
    return {
      channelId: group.channelId,
      channelTitle: group.channelTitle || 'Unknown channel',
      handle: group.handle || handleFromChannelPath(group.channelPath),
      avatarUrl: group.avatarUrl || '',
      bannerUrl: group.bannerUrl || '',
      description: group.description || '',
      channelPublishedAt,
      firstObservedUploadAt: effectiveFirstUpload,
      firstUploadAt: babyInfo.firstUploadAt,
      firstUploadAgeDays: babyInfo.firstUploadAgeDays,
      isBabyChannel: babyInfo.isBabyChannel,
      revenueEstimate: dossier?.revenueEstimate || null,
      estimatedRpm: dossier?.estimatedRpm || null,
      channelAgeDays,
      channelAgeSource,
      subscriberCount: finiteMetric(group.subscriberCount),
      channelVideoCount: finiteMetric(group.channelVideoCount),
      channelTotalViews: finiteMetric(group.channelTotalViews),
      videosAnalyzed: videos.length,
      medianOutlier,
      avgVelocity,
      consistency,
      opportunityScore,
      confidence,
      dataCoverage,
      facelessScore: faceless.score,
      facelessConfidence: faceless.confidence,
      facelessStatus: faceless.status,
      facelessEvidence: faceless.evidence,
      facelessNegativeSignals: faceless.negativeSignals,
      classifierVersion: FACELESS_CLASSIFIER_VERSION,
      userFeedback: feedback?.label || '',
      visualSignals: group.visualSignals || null,
      fingerprint,
      dossier,
      sourceMode: group.sourceMode || 'http',
      autoPotential,
      manualPinned: pinnedChannels.has(group.channelId),
      favorite: pinnedChannels.has(group.channelId),
      potentialReason,
      recommendationReason,
      discoveryPath: Array.isArray(group.discoveryPath) ? group.discoveryPath : [],
      topVideo: topVideo ? {
        videoId: topVideo.videoId,
        title: topVideo.title,
        url: topVideo.url,
        thumbnail: topVideo.thumbnail,
        viewCount: topVideo.viewCount,
        viewsPerDay: topVideo.viewsPerDay,
        viewsPerSubscriber: topVideo.viewsPerSubscriber,
        publishedAt: topVideo.publishedAt,
        durationSeconds: topVideo.durationSeconds,
        candidateScore: topVideo.candidateScore || 0,
        outlierScore: topVideo.outlierScore || 0,
        baselineMedianViews: finiteMetric(topVideo.baselineMedianViews),
        baselineSampleSize: Number(topVideo.baselineSampleSize) || 0,
        dataCoverage: Number(topVideo.dataCoverage) || 0
      } : null,
      url: group.channelPath
        ? `https://www.youtube.com/${String(group.channelPath).replace(/^\/+/, '')}`
        : group.channelId && /^UC[\w-]+$/.test(group.channelId)
          ? `https://www.youtube.com/channel/${group.channelId}`
          : ''
    };
  }).sort((a, b) =>
    facelessStatusOrder(a.facelessStatus) - facelessStatusOrder(b.facelessStatus)
    || b.opportunityScore - a.opportunityScore
    || b.avgVelocity - a.avgVelocity
  );
}

function persistChannelCandidates(job) {
  job._channelPersistSignatures = job._channelPersistSignatures || new Map();
  const configuredScoutHours = Number(settingsProfile()?.settings?.research?.scoutIntervalHours) || 24;
  for (const channel of Array.isArray(job?.channels) ? job.channels : []) {
    const signature = [
      Math.round(Number(channel.opportunityScore) || 0),
      Math.round((Number(channel.dataCoverage) || 0) * 100),
      channel.videosAnalyzed,
      channel.facelessStatus,
      channel.topVideo?.videoId,
      channel.topVideo?.viewCount
    ].join(':');
    if (job._channelPersistSignatures.get(channel.channelId) === signature) continue;
    job._channelPersistSignatures.set(channel.channelId, signature);
    researchStore.saveChannelCandidate(job.id, channel);
    researchStore.saveChannelClassification(channel);
    researchStore.upsertChannel(channel, job.id);
    researchStore.saveOpportunityDossier(channel.channelId, channel.dossier, 1);
    researchStore.saveSnapshot('channel_metrics', channel.channelId, {
      opportunityScore: channel.opportunityScore,
      dataCoverage: channel.dataCoverage,
      subscriberCount: channel.subscriberCount,
      medianOutlier: channel.medianOutlier,
      avgVelocity: channel.avgVelocity,
      facelessScore: channel.facelessScore
    });
    if (channel.topVideo?.videoId) {
      researchStore.saveSnapshot('video_metrics', channel.topVideo.videoId, {
        channelId: channel.channelId,
        viewCount: channel.topVideo.viewCount,
        viewsPerDay: channel.topVideo.viewsPerDay,
        outlierScore: channel.topVideo.outlierScore
      });
    }
    if (channel.autoPotential || channel.facelessStatus === 'review') {
      researchStore.scheduleWatch(channel.channelId, {
        topVideoId: channel.topVideo?.videoId || '',
        opportunityScore: channel.opportunityScore,
        reason: channel.autoPotential ? 'recommended' : 'review'
      }, configuredScoutHours);
    }
  }
}

function opportunityVideoScore(item) {
  return (Number(item.candidateScore) || 0)
    + Math.log10(Math.max(Number(item.outlierScore) || 1, 1)) * 18
    + Math.log10(Math.max(Number(item.viewsPerDay) || 1, 1)) * 3;
}

function weightedAvailableScore(entries) {
  const available = entries.filter(entry => entry.available && Number.isFinite(Number(entry.value)));
  const totalWeight = available.reduce((sum, entry) => sum + entry.weight, 0);
  if (!totalWeight) return 0;
  return clamp(available.reduce((sum, entry) => sum + Number(entry.value) * entry.weight, 0) / totalWeight, 0, 100);
}

function maxKnown(left, right) {
  const values = [finiteMetric(left), finiteMetric(right)].filter(value => value !== null);
  return values.length ? Math.max(...values) : null;
}

function classifyFacelessChannel(channel, videos, feedback = '') {
  const userLabel = feedback || researchStore.channelFeedback(stableChannelKey(channel))?.label || '';
  return classifyFacelessChannelV3(channel, videos, userLabel);
}

function patternHits(text, patterns) {
  return patterns.reduce((count, pattern) => count + (pattern.test(String(text || '')) ? 1 : 0), 0);
}

function channelPotentialReason(input) {
  if (input.facelessStatus === 'rejected') return 'Rejected: evidence suggests a presenter-led, interview, podcast or vlog format';
  if (input.facelessStatus === 'review') return 'Needs review: more evidence is required to confirm a faceless format';
  if (!input.recentLong) return 'No verified long-form trigger published within the last 90 days';
  if (input.autoPotential && input.presetViral) return 'Verified faceless channel with a recent video matching a viral preset';
  if (input.autoPotential) return 'Verified faceless channel combining outlier strength, velocity and channel newness';
  if (input.channelAgeDays === null) return 'Verified faceless format; channel age is still being confirmed';
  return `Verified faceless format with ${Math.round(input.opportunityScore)} opportunity score`;
}

function facelessStatusOrder(status) {
  if (status === 'strict') return 0;
  if (status === 'review') return 1;
  return 2;
}

async function runApiResearch(params, job) {
  const videoIds = new Set();
  const discoveryErrors = [];
  const budget = researchBudget(params.filters);
  const discoveryLimit = budget.candidateLimit;
  const durationBuckets = youtubeDurationBuckets(params.filters.duration);
  const perKeywordLimit = keywordDiscoveryLimit(discoveryLimit, params.keywords.length);
  const publishedAfter = params.filters.publishedAfter || defaultAfterDate();
  const publishedBefore = params.filters.publishedBefore || '';
  const searchOrders = params.filters.presetId === 'recent'
    ? ['date', 'viewCount', 'relevance']
    : API_SEARCH_ORDERS;
  let previewPublished = false;

  for (const keyword of params.keywords) {
    throwIfCancelled(job);
    if (!withinBudget(budget)) break;
    jobUpdate(job, 12, `Searching API: ${keyword}`);
    for (const videoDuration of durationBuckets) {
      for (const order of searchOrders) {
        throwIfCancelled(job);
        if (!withinBudget(budget)) break;
        try {
          const ids = await searchVideoIdsApi(keyword, {
            maxResults: perKeywordLimit,
            region: params.filters.region,
            language: params.filters.language,
            publishedAfter,
            publishedBefore,
            videoDuration,
            order
          });
          ids.forEach(id => videoIds.add(id));
          if (!previewPublished && videoIds.size) {
            previewPublished = await publishApiPreview(job, videoIds, params, 24);
          }
        } catch (err) {
          discoveryErrors.push(`search ${keyword}/${order}: ${safeErrorMessage(err)}`);
        }
        if (videoIds.size >= discoveryLimit) break;
      }
      if (videoIds.size >= discoveryLimit) break;
    }
  }

  for (const seed of params.seedChannels) {
    throwIfCancelled(job);
    if (!withinBudget(budget) || videoIds.size >= discoveryLimit) break;
    jobUpdate(job, 28, `Reading channel: ${cleanChannelLabel(seed)}`);
    try {
      const channel = await resolveChannelApi(seed);
      if (!channel?.uploadsPlaylistId) continue;
      const ids = await getUploadVideoIdsApi(channel.uploadsPlaylistId, discoveryLimit);
      ids.forEach(id => videoIds.add(id));
      if (!previewPublished && videoIds.size) {
        previewPublished = await publishApiPreview(job, videoIds, params, 34);
      }
    } catch (err) {
      discoveryErrors.push(`seed ${cleanChannelLabel(seed)}: ${safeErrorMessage(err)}`);
    }
  }

  const ids = [...videoIds].slice(0, discoveryLimit);
  if (!ids.length && discoveryErrors.length) {
    throw new Error(`YouTube API returned no candidates. ${discoveryErrors.slice(0, 2).join(' | ')}`);
  }
  if (!ids.length) return [];

  jobUpdate(job, 48, `Enriching ${ids.length} videos`);
  let videos = await videosListApi(ids);
  let channelIds = [...new Set(videos.map(video => video.snippet?.channelId).filter(Boolean))];
  let channelMap = await channelsListApi(channelIds);
  updateDiscovery(job, {
    candidateVideos: videoIds.size,
    channelsFound: channelMap.size,
    channelsScanned: 0
  });

  const expansion = await expandApiChannels(channelMap, videoIds, budget, job);
  if (expansion.newVideoIds.length) {
    throwIfCancelled(job);
    jobUpdate(job, 58, `Enriching channel scan: ${videoIds.size} videos`);
    videos = mergeApiVideos(videos, await videosListApi(expansion.newVideoIds));
    channelIds = [...new Set(videos.map(video => video.snippet?.channelId).filter(Boolean))];
    channelMap = await channelsListApi(channelIds);
  }
  updateDiscovery(job, {
    candidateVideos: videoIds.size,
    channelsFound: channelMap.size,
    channelsScanned: expansion.channelsScanned
  });

  jobUpdate(job, 66, 'Computing channel baselines');
  const baselines = await buildApiBaselines(channelMap, budget, job);

  return videos.map(video => normalizeApiVideo(video, channelMap.get(video.snippet?.channelId), baselines.get(video.snippet?.channelId)));
}

async function publishApiPreview(job, videoIds, params, progress) {
  try {
    const ids = [...videoIds].slice(0, 50);
    const videos = await videosListApi(ids);
    const channelIds = [...new Set(videos.map(video => video.snippet?.channelId).filter(Boolean))];
    const channelMap = await channelsListApi(channelIds);
    const preview = videos.map(video => {
      const channel = channelMap.get(video.snippet?.channelId);
      const totalViews = Number(channel?.statistics?.viewCount) || 0;
      const videoCount = Math.max(Number(channel?.statistics?.videoCount) || 0, 1);
      const approximateBaseline = totalViews ? { median: totalViews / videoCount, avg: totalViews / videoCount } : undefined;
      return normalizeApiVideo(video, channel, approximateBaseline);
    });
    const scored = applySeenState(scoreAndSortResults(preview, params.filters));
    job.results = diversifyByChannel(scored, Math.min(params.filters.resultLimit, 50));
    job.channels = buildChannelResults(scored, researchStore.runChannels(job.id));
    updateDiscovery(job, {
      candidateVideos: videoIds.size,
      videosEvaluated: videos.length,
      channelsFound: channelMap.size
    });
    jobUpdate(job, progress, `API precision preview: ${job.results.length} videos`);
    return job.results.length > 0;
  } catch (error) {
    pushActivity(job, `API preview delayed: ${safeErrorMessage(error)}`, 'warning');
    return false;
  }
}

async function expandApiChannels(channelMap, videoIds, budget, job) {
  const known = new Set(videoIds);
  const newVideoIds = [];
  let channelsScanned = 0;

  for (const channelBatch of chunks([...channelMap.values()], 4)) {
    throwIfCancelled(job);
    if (!withinBudget(budget) || videoIds.size >= budget.candidateLimit) break;

    const uploads = await Promise.all(channelBatch.map(async channel => {
      if (!channel.uploadsPlaylistId) return [];
      return withTimeout(
        getUploadVideoIdsApi(channel.uploadsPlaylistId, budget.uploadsPerChannel),
        BASELINE_UPLOAD_TIMEOUT_MS,
        []
      );
    }));

    channelsScanned += channelBatch.length;
    for (const ids of uploads) {
      for (const id of ids) {
        if (known.has(id) || videoIds.size >= budget.candidateLimit) continue;
        known.add(id);
        videoIds.add(id);
        newVideoIds.push(id);
      }
    }
    updateDiscovery(job, {
      candidateVideos: videoIds.size,
      channelsFound: channelMap.size,
      channelsScanned
    });
    jobUpdate(job, 54, `Scanning ${channelsScanned} discovered channels`);
  }

  return { newVideoIds, channelsScanned };
}

function mergeApiVideos(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const video of list || []) {
      if (video?.id) map.set(video.id, video);
    }
  }
  return [...map.values()];
}

async function searchVideoIdsApi(query, opts) {
  const ids = [];
  let pageToken = '';
  const pageLimit = Math.ceil(opts.maxResults / 50);

  for (let page = 0; page < pageLimit && ids.length < opts.maxResults; page += 1) {
    const payload = await youtubeApi('search', {
      part: 'snippet',
      type: 'video',
      q: query,
      order: opts.order || 'viewCount',
      maxResults: Math.min(50, opts.maxResults - ids.length),
      regionCode: opts.region,
      relevanceLanguage: opts.language,
      publishedAfter: opts.publishedAfter,
      publishedBefore: opts.publishedBefore,
      videoDuration: opts.videoDuration,
      pageToken
    });
    for (const item of payload.items || []) {
      if (item.id?.videoId) ids.push(item.id.videoId);
    }
    pageToken = payload.nextPageToken || '';
    if (!pageToken) break;
  }

  return ids;
}

async function resolveChannelApi(input) {
  const parsed = parseChannelInput(input);
  if (parsed.channelId) {
    const map = await channelsListApi([parsed.channelId]);
    return map.get(parsed.channelId) || null;
  }

  if (parsed.handle) {
    const payload = await youtubeApi('channels', {
      part: 'snippet,statistics,contentDetails',
      forHandle: parsed.handle.replace(/^@/, '')
    });
    return decorateApiChannel(payload.items?.[0] || null);
  }

  if (parsed.username) {
    const payload = await youtubeApi('channels', {
      part: 'snippet,statistics,contentDetails',
      forUsername: parsed.username
    });
    return decorateApiChannel(payload.items?.[0] || null);
  }

  const payload = await youtubeApi('search', {
    part: 'snippet',
    type: 'channel',
    q: input,
    maxResults: 1
  });
  const channelId = payload.items?.[0]?.snippet?.channelId || payload.items?.[0]?.id?.channelId || '';
  if (!channelId) return null;
  const map = await channelsListApi([channelId]);
  return map.get(channelId) || null;
}

function decorateApiChannel(channel) {
  if (!channel) return null;
  return {
    ...channel,
    uploadsPlaylistId: channel.contentDetails?.relatedPlaylists?.uploads || ''
  };
}

async function channelsListApi(channelIds) {
  const map = new Map();
  for (const chunk of chunks([...new Set(channelIds)].filter(Boolean), 50)) {
    const payload = await youtubeApi('channels', {
      part: 'snippet,statistics,contentDetails,brandingSettings',
      id: chunk.join(',')
    });
    for (const channel of payload.items || []) {
      map.set(channel.id, decorateApiChannel(channel));
    }
  }
  return map;
}

async function getUploadVideoIdsApi(playlistId, limit) {
  const ids = [];
  let pageToken = '';
  while (ids.length < limit) {
    const payload = await youtubeApi('playlistItems', {
      part: 'contentDetails,snippet',
      playlistId,
      maxResults: Math.min(50, limit - ids.length),
      pageToken
    });
    for (const item of payload.items || []) {
      const id = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
      if (id) ids.push(id);
    }
    pageToken = payload.nextPageToken || '';
    if (!pageToken) break;
  }
  return ids;
}

async function videosListApi(videoIds) {
  const output = [];
  for (const chunk of chunks([...new Set(videoIds)].filter(Boolean), 50)) {
    const payload = await youtubeApi('videos', {
      part: 'snippet,contentDetails,statistics',
      id: chunk.join(',')
    });
    output.push(...(payload.items || []));
  }
  return output;
}

async function buildApiBaselines(channelMap, budget, job) {
  const baselines = new Map();
  const channels = [...channelMap.values()];

  for (const channel of channels) {
    baselines.set(channel.id, { median: null, avg: null, observations: 0, samples: [] });
  }

  for (const channelBatch of chunks(channels, 4)) {
    throwIfCancelled(job);
    if (!withinBudget(budget)) break;

    await Promise.all(channelBatch.map(async channel => {
      const playlistId = channel.uploadsPlaylistId;
      if (!playlistId) return;

      const ids = await withTimeout(getUploadVideoIdsApi(playlistId, BASELINE_UPLOAD_LIMIT), BASELINE_UPLOAD_TIMEOUT_MS, []);
      if (!ids.length) return;

      const videos = await withTimeout(videosListApi(ids), BASELINE_VIDEOS_TIMEOUT_MS, []);
      const samples = videos
        .filter(video => parseIsoDuration(video.contentDetails?.duration || '') >= LONG_FORM_MIN_SECONDS)
        .filter(video => video.snippet?.liveBroadcastContent !== 'live')
        .map(video => ({ id: video.id, views: Number(video.statistics?.viewCount) || 0 }))
        .filter(sample => sample.views > 0);
      const viewCounts = samples.map(sample => sample.views);

      if (viewCounts.length < 3) return;
      baselines.set(channel.id, {
        median: median(viewCounts),
        avg: avg(viewCounts),
        observations: viewCounts.length,
        samples
      });
    }));
  }

  return baselines;
}

function withTimeout(promise, ms, fallback) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(fallback), ms);
    Promise.resolve(promise)
      .then(value => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withinBudget(budget) {
  return !budget?.deadlineAt || Date.now() < budget.deadlineAt;
}

function normalizeApiVideo(video, channel, baseline) {
  const viewCount = Number(video.statistics?.viewCount) || 0;
  const subscriberCount = Number(channel?.statistics?.subscriberCount) || 0;
  const channelVideoCount = Number(channel?.statistics?.videoCount) || 0;
  const durationSeconds = parseIsoDuration(video.contentDetails?.duration || '');
  const reasons = [];
  const peerViews = (baseline?.samples || [])
    .filter(sample => sample.id !== video.id)
    .map(sample => sample.views)
    .filter(value => value > 0);
  const baselineMedian = peerViews.length >= 3 ? median(peerViews) : null;
  const baselineAverage = peerViews.length >= 3 ? avg(peerViews) : null;

  if (viewCount >= 100000 && subscriberCount && subscriberCount <= 10000) reasons.push('small-channel viral');
  if (viewCount >= 1000000) reasons.push('above 1M views');
  if (baselineMedian && viewCount / baselineMedian >= 20) reasons.push('high outlier');
  if (durationSeconds >= 480) reasons.push('long video');

  return {
    videoId: video.id,
    title: video.snippet?.title || '',
    url: `https://www.youtube.com/watch?v=${video.id}`,
    thumbnail: bestThumbnail(video.snippet?.thumbnails) || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
    durationSeconds,
    publishedAt: video.snippet?.publishedAt || '',
    viewCount,
    channelId: video.snippet?.channelId || '',
    channelTitle: video.snippet?.channelTitle || channel?.snippet?.title || '',
    channelPath: channel?.snippet?.customUrl ? `/${channel.snippet.customUrl}` : '',
    handle: channel?.snippet?.customUrl || '',
    avatarUrl: bestThumbnail(channel?.snippet?.thumbnails),
    bannerUrl: channel?.brandingSettings?.image?.bannerExternalUrl || '',
    description: channel?.snippet?.description || '',
    channelPublishedAt: channel?.snippet?.publishedAt || '',
    channelAgeSource: channel?.snippet?.publishedAt ? 'youtube' : 'unknown',
    subscriberCount,
    channelVideoCount,
    channelTotalViews: Number(channel?.statistics?.viewCount) || 0,
    baselineMedianViews: baselineMedian,
    baselineAvgViews: baselineAverage,
    baselineSampleSize: peerViews.length,
    sourceMode: 'api',
    confidence: 0.94,
    reasons
  };
}

async function runWebResearch(params, job) {
  const results = [];
  const budget = researchBudget(params.filters);
  const discoveryLimit = budget.candidateLimit;
  let channelsScanned = 0;

  for (const keyword of params.keywords) {
    throwIfCancelled(job);
    if (!withinBudget(budget)) break;
    jobUpdate(job, 20, `Searching web: ${keyword}`);
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(keyword)}`;
    const html = await fetchText(url);
    const parsed = parseYoutubePage(html, 'search');
    results.push(...parsed.items);

    let continuationToken = parsed.continuationToken;
    for (let page = 0; page < budget.continuationPages && continuationToken && parsed.cfg?.apiKey; page += 1) {
      throwIfCancelled(job);
      if (!withinBudget(budget)) break;
      if (usableWebCandidateCount(results, params.filters) >= discoveryLimit) break;
      try {
        jobUpdate(job, 22 + page * 3, `Searching web: ${keyword} (${page + 2})`);
        const more = await fetchYoutubeiContinuation('search', continuationToken, parsed.cfg);
        results.push(...more.items);
        continuationToken = more.continuationToken;
      } catch {
        break;
      }
    }
  }

  for (const seed of params.seedChannels) {
    throwIfCancelled(job);
    if (!withinBudget(budget)) break;
    const pathPart = channelPathFromInput(seed);
    if (!pathPart) continue;
    jobUpdate(job, 44, `Scanning web channel: ${cleanChannelLabel(seed)}`);
    const html = await fetchText(`https://www.youtube.com/${pathPart}/videos`);
    const parsed = parseYoutubePage(html, 'browse');
    results.push(...parsed.items);

    let continuationToken = parsed.continuationToken;
    for (let page = 0; page < budget.continuationPages && continuationToken && parsed.cfg?.apiKey; page += 1) {
      throwIfCancelled(job);
      if (!withinBudget(budget)) break;
      if (usableWebCandidateCount(results, params.filters) >= discoveryLimit) break;
      try {
        jobUpdate(job, 46 + page * 3, `Scanning web channel: ${cleanChannelLabel(seed)} (${page + 2})`);
        const more = await fetchYoutubeiContinuation('browse', continuationToken, parsed.cfg);
        results.push(...more.items);
        continuationToken = more.continuationToken;
      } catch {
        break;
      }
    }
  }

  const expansion = await expandWebChannels(mergeResults(results), params, budget, job);
  channelsScanned += expansion.channelsScanned;
  const candidates = mergeResults(results, expansion.items);
  const channelsFound = new Set(candidates.map(item => item.channelId || item.channelTitle).filter(Boolean)).size;
  updateDiscovery(job, {
    candidateVideos: candidates.length,
    channelsFound,
    channelsScanned
  });
  return enrichWebCandidates(candidates, params.filters, discoveryLimit, job);
}

async function expandWebChannels(items, params, budget, job) {
  const channels = new Map();
  for (const item of items) {
    const key = stableChannelKey(item);
    if (!key) continue;
    const pathPart = item.channelPath
      ? String(item.channelPath).replace(/^\/+/, '')
      : /^UC[\w-]+$/.test(item.channelId || '')
        ? `channel/${item.channelId}`
        : '';
    if (!pathPart) continue;
    channels.set(key, {
      key,
      pathPart,
      channelId: item.channelId || '',
      channelTitle: item.channelTitle || '',
      channelPath: `/${pathPart}`,
      handle: item.handle || handleFromChannelPath(`/${pathPart}`)
    });
  }
  const output = [];
  let channelsScanned = 0;

  for (const channel of channels.values()) {
    throwIfCancelled(job);
    if (!withinBudget(budget) || mergeResults(items, output).length >= budget.candidateLimit) break;
    try {
      jobUpdate(job, 50, `Scanning discovered channels: ${channelsScanned + 1}`);
      const html = await fetchText(`https://www.youtube.com/${channel.pathPart}/videos`);
      const parsed = parseYoutubePage(html, 'browse');
      const summary = parsed.channel || {};
      const channelItems = parsed.items.map(item => ({
        ...item,
        channelId: channel.channelId || summary.channelId || item.channelId,
        channelTitle: channel.channelTitle || summary.channelTitle || item.channelTitle,
        channelPath: channel.channelPath,
        handle: channel.handle,
        avatarUrl: summary.avatarUrl || item.avatarUrl,
        bannerUrl: summary.bannerUrl || item.bannerUrl,
        description: summary.description || item.description,
        subscriberCount: finiteMetric(summary.subscriberCount) || finiteMetric(item.subscriberCount),
        channelVideoCount: finiteMetric(summary.channelVideoCount) || finiteMetric(item.channelVideoCount),
        firstObservedUploadAt: summary.channelPublishedAt || '',
        channelAgeSource: summary.channelPublishedAt ? 'youtube_about' : 'unknown',
        channelAgeConfidence: summary.channelPublishedAt ? 0.82 : 0
      }));
      output.push(...channelItems);
      channelsScanned += 1;
      updateDiscovery(job, {
        candidateVideos: mergeResults(items, output).length,
        channelsFound: channels.size,
        channelsScanned
      });
    } catch {
      // Channel pages can be unavailable or throttled while the keyword search still succeeds.
    }
  }

  return { items: output, channelsScanned };
}

async function enrichWebCandidates(items, filters, discoveryLimit, job) {
  const candidates = items
    .filter(item => item.videoId && !/\/shorts\//i.test(item.url || ''))
    .slice(0, Math.min(WEB_VIDEO_ENRICH_LIMIT, Math.max(discoveryLimit, items.length)));
  const enriched = [];

  for (const batch of chunks(candidates, 6)) {
    throwIfCancelled(job);
    const batchResults = await Promise.all(batch.map(enrichWebVideo));
    enriched.push(...batchResults);
    if (usableWebCandidateCount(enriched, filters) >= discoveryLimit) break;
  }

  return mergeResults(enriched, items);
}

async function enrichWebVideo(item) {
  const hasIdentity = Boolean(stableChannelKey(item));
  if (item.durationSeconds > 0 && item.viewCount > 0 && item.publishedAt && hasIdentity) return item;

  const html = await withTimeout(fetchText(`https://www.youtube.com/watch?v=${encodeURIComponent(item.videoId)}`), WEB_VIDEO_ENRICH_TIMEOUT_MS, '');
  if (!html) return item;

  const durationSeconds = Number(matchFirst(html, [
    /"lengthSeconds"\s*:\s*"(\d+)"/,
    /"lengthSeconds"\s*:\s*(\d+)/
  ])) || item.durationSeconds || 0;
  const viewCount = Number(matchFirst(html, [
    /"viewCount"\s*:\s*"(\d+)"/,
    /"viewCount"\s*:\s*(\d+)/
  ])) || item.viewCount || 0;
  const published = matchFirst(html, [
    /"publishDate"\s*:\s*"([^"]+)"/,
    /"datePublished"\s*:\s*"([^"]+)"/
  ]);
  const channelTitle = matchFirst(html, [
    /"ownerChannelName"\s*:\s*"([^"]+)"/,
    /"author"\s*:\s*"([^"]+)"/
  ]);
  const channelId = matchFirst(html, [
    /"videoDetails"\s*:\s*\{[\s\S]{0,2500}?"channelId"\s*:\s*"([^"]+)"/,
    /"externalChannelId"\s*:\s*"([^"]+)"/,
    /"channelId"\s*:\s*"(UC[\w-]+)"/
  ]);
  const ownerProfileUrl = decodeJsonText(matchFirst(html, [
    /"ownerProfileUrl"\s*:\s*"([^"]+)"/,
    /"vanityChannelUrl"\s*:\s*"([^"]+)"/
  ]));
  const channelPath = youtubePath(ownerProfileUrl)
    || (channelId ? `/channel/${channelId}` : item.channelPath || '');
  const avatarUrl = decodeJsonText(matchFirst(html, [
    /"channelThumbnail"\s*:\s*\{[\s\S]{0,500}?"url"\s*:\s*"([^"]+)"/,
    /"avatar"\s*:\s*\{[\s\S]{0,500}?"url"\s*:\s*"([^"]+)"/
  ]));

  return {
    ...item,
    durationSeconds,
    durationLabel: item.durationLabel || formatDuration(durationSeconds),
    viewCount,
    publishedAt: item.publishedAt || dateOnlyToIso(published),
    publishedText: item.publishedText || (published ? formatAge(dateOnlyToIso(published)) : ''),
    channelId: item.channelId || channelId,
    channelTitle: !item.channelTitle || /^unknown channel$/i.test(item.channelTitle)
      ? decodeJsonText(channelTitle) || item.channelTitle
      : item.channelTitle,
    channelPath,
    handle: item.handle || handleFromChannelPath(channelPath),
    avatarUrl: item.avatarUrl || avatarUrl
  };
}

function matchFirst(text, patterns) {
  for (const pattern of patterns) {
    const match = String(text || '').match(pattern);
    if (match?.[1]) return match[1];
  }
  return '';
}

function dateOnlyToIso(value) {
  if (!value) return '';
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : '';
}

function decodeJsonText(value) {
  if (!value) return '';
  try {
    return JSON.parse(`"${String(value).replace(/"/g, '\\"')}"`);
  } catch {
    return String(value);
  }
}

function youtubePath(value) {
  if (!value) return '';
  try {
    const parsed = new URL(value, 'https://www.youtube.com');
    return /(^|\.)youtube\.com$/i.test(parsed.hostname) ? parsed.pathname : '';
  } catch {
    return String(value).startsWith('/') ? String(value).split(/[?#]/)[0] : '';
  }
}

function keywordDiscoveryLimit(discoveryLimit, keywordCount) {
  return Math.min(discoveryLimit, Math.max(60, Math.ceil(discoveryLimit / Math.max(1, keywordCount || 1))));
}

function youtubeDurationBuckets(duration) {
  if (duration === 'short') return ['short'];
  if (duration === 'deepLong') return ['long'];
  if (duration === 'long') return ['medium', 'long'];
  return [''];
}

async function fetchText(url, params = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= WEB_FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: webHeaders(params)
      });
      if (response.ok) return await response.text();
      lastError = new Error(`HTTP ${response.status}`);
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt >= WEB_FETCH_RETRIES) throw lastError;
    } catch (err) {
      lastError = err;
      if (attempt >= WEB_FETCH_RETRIES) throw err;
    } finally {
      clearTimeout(timer);
    }
    await delay(850 * (attempt + 1));
  }

  throw lastError || new Error('HTTP request failed');
}

function parseYoutubePage(html, endpointKind) {
  const data = extractJsonAssignment(html, 'ytInitialData') || {};
  const cfg = extractYtcfg(html);
  const entries = [];
  walkYoutubeData(data, entries);
  const items = entries.map(itemFromYoutubeRenderer).filter(Boolean);
  const continuationToken = findContinuationToken(data);
  return { items, continuationToken, endpointKind, cfg, channel: parseYoutubeChannelSummary(data) };
}

function parseYoutubeChannelSummary(data) {
  const metadata = data?.metadata?.channelMetadataRenderer || findObjectRenderer(data, 'channelMetadataRenderer');
  if (!metadata) return null;
  const header = findObjectRenderer(data, 'c4TabbedHeaderRenderer')
    || findObjectRenderer(data, 'pageHeaderRenderer')
    || {};
  const vanity = metadata.vanityChannelUrl || metadata.channelUrl || '';
  let channelPath = '';
  try { channelPath = new URL(vanity).pathname; } catch {}
  const avatar = bestThumbnail(metadata.avatar || header.avatar || header.image);
  const banner = bestThumbnail(header.banner || header.mobileBanner || header.background);
  return {
    channelId: metadata.externalId || '',
    channelTitle: metadata.title || '',
    channelPath,
    handle: handleFromChannelPath(channelPath),
    avatarUrl: avatar,
    bannerUrl: banner,
    description: metadata.description || '',
    subscriberCount: parseCompactNumber(txt(header.subscriberCountText)),
    sourceMode: 'http',
    confidence: metadata.externalId ? 0.72 : 0.58
  };
}

function findObjectRenderer(value, key, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 18) return null;
  if (!Array.isArray(value) && value[key] && typeof value[key] === 'object') return value[key];
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const match = findObjectRenderer(child, key, depth + 1);
    if (match) return match;
  }
  return null;
}

function walkYoutubeData(obj, output, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 28) return;
  if (Array.isArray(obj)) {
    for (const item of obj) walkYoutubeData(item, output, depth + 1);
    return;
  }

  if (
    obj.videoRenderer
    || obj.gridVideoRenderer
    || obj.reelItemRenderer
    || obj.shortsLockupViewModel
    || obj.lockupViewModel
    || obj.richItemRenderer?.content?.videoRenderer
    || obj.richItemRenderer?.content?.gridVideoRenderer
    || obj.richItemRenderer?.content?.reelItemRenderer
    || obj.richItemRenderer?.content?.shortsLockupViewModel
    || obj.richItemRenderer?.content?.lockupViewModel
  ) {
    output.push(obj);
  }

  for (const value of Object.values(obj)) walkYoutubeData(value, output, depth + 1);
}

function itemFromYoutubeRenderer(renderer) {
  const vr = renderer?.richItemRenderer?.content?.videoRenderer || renderer?.videoRenderer || renderer?.gridVideoRenderer;
  if (vr?.videoId) return itemFromVideoRenderer(vr);

  const reel = renderer?.richItemRenderer?.content?.reelItemRenderer || renderer?.reelItemRenderer;
  if (reel?.videoId) {
    return {
      videoId: reel.videoId,
      title: txt(reel.headline || reel.title),
      url: `https://www.youtube.com/shorts/${reel.videoId}`,
      thumbnail: bestThumbnail(reel.thumbnail) || `https://i.ytimg.com/vi/${reel.videoId}/hqdefault.jpg`,
      durationSeconds: 0,
      publishedAt: '',
      publishedText: '',
      viewCount: parseCompactNumber(txt(reel.viewCountText)),
      channelTitle: '',
      baselineMedianViews: 0,
      sourceMode: 'web',
      confidence: 0.42
    };
  }

  const shorts = renderer?.richItemRenderer?.content?.shortsLockupViewModel || renderer?.shortsLockupViewModel;
  const shortsId = shorts?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId || '';
  if (shortsId) {
    return {
      videoId: shortsId,
      title: txt(shorts?.overlayMetadata?.primaryText),
      url: `https://www.youtube.com/shorts/${shortsId}`,
      thumbnail: bestThumbnail(shorts?.thumbnail?.image) || `https://i.ytimg.com/vi/${shortsId}/hqdefault.jpg`,
      durationSeconds: 0,
      publishedAt: '',
      publishedText: '',
      viewCount: parseCompactNumber(txt(shorts?.overlayMetadata?.secondaryText)),
      channelTitle: '',
      baselineMedianViews: 0,
      sourceMode: 'web',
      confidence: 0.42
    };
  }

  const lockup = renderer?.richItemRenderer?.content?.lockupViewModel || renderer?.lockupViewModel;
  const command = lockup?.rendererContext?.commandContext?.onTap?.innertubeCommand;
  const videoId = lockup?.contentId || command?.watchEndpoint?.videoId || command?.reelWatchEndpoint?.videoId || '';
  const isVideo = videoId && !/^(PL|UU|OL|FL|LL)/.test(videoId);
  if (!isVideo) return null;

  const meta = lockupMetadataParts(lockup);
  const channelMeta = lockupChannelMetadata(lockup);
  const urlPath = command?.commandMetadata?.webCommandMetadata?.url || '';
  const publishedText = meta.find(value => /ago|day|week|month|year|hora|dia|semana|mes|ano/i.test(value)) || '';
  const viewsText = meta.find(value => /view|visualiza|vista|\bK\b|\bM\b|\bB\b/i.test(value)) || meta[0] || '';

  return {
    videoId,
    title: txt(lockup?.metadata?.lockupMetadataViewModel?.title) || txt(lockup?.title),
    url: urlPath ? `https://www.youtube.com${urlPath}` : `https://www.youtube.com/watch?v=${videoId}`,
    thumbnail: bestThumbnail(lockup?.contentImage?.thumbnailViewModel?.image) || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    durationSeconds: parseDuration(lockupDuration(lockup)),
    durationLabel: lockupDuration(lockup),
    publishedAt: relativeDateToIso(publishedText),
    publishedText,
    viewCount: parseCompactNumber(viewsText),
    channelId: channelMeta.channelId,
    channelTitle: channelMeta.channelTitle,
    channelPath: channelMeta.channelPath,
    handle: handleFromChannelPath(channelMeta.channelPath),
    baselineMedianViews: 0,
    sourceMode: 'web',
    confidence: 0.46
  };
}

function lockupChannelMetadata(value, depth = 0, output = { channelId: '', channelTitle: '', channelPath: '' }) {
  if (!value || typeof value !== 'object' || depth > 10) return output;
  const browse = value.browseEndpoint;
  const url = value.commandMetadata?.webCommandMetadata?.url || '';
  if (!output.channelId && /^UC[\w-]+$/.test(browse?.browseId || '')) output.channelId = browse.browseId;
  if (!output.channelPath && /\/(?:@|channel\/)/.test(url)) output.channelPath = String(url).split(/[?#]/)[0];
  if (!output.channelTitle && Array.isArray(value.runs)) {
    const run = value.runs.find(item => item?.text && (
      item.navigationEndpoint?.browseEndpoint?.browseId
      || /\/(?:@|channel\/)/.test(item.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url || '')
    ));
    if (run) output.channelTitle = run.text;
  }
  if (output.channelId && output.channelTitle && output.channelPath) return output;
  for (const nested of Object.values(value)) {
    lockupChannelMetadata(nested, depth + 1, output);
    if (output.channelId && output.channelTitle && output.channelPath) break;
  }
  return output;
}

function itemFromVideoRenderer(vr) {
  const publishedText = txt(vr.publishedTimeText);
  const ownerRun = vr.ownerText?.runs?.[0] || vr.longBylineText?.runs?.[0] || {};
  const channelId = ownerRun.navigationEndpoint?.browseEndpoint?.browseId || '';
  return {
    videoId: vr.videoId,
    title: txt(vr.title),
    url: `https://www.youtube.com/watch?v=${vr.videoId}`,
    thumbnail: bestThumbnail(vr.thumbnail) || `https://i.ytimg.com/vi/${vr.videoId}/hqdefault.jpg`,
    durationSeconds: parseDuration(txt(vr.lengthText)),
    durationLabel: txt(vr.lengthText),
    publishedAt: relativeDateToIso(publishedText),
    publishedText,
    viewCount: parseCompactNumber(txt(vr.viewCountText || vr.shortViewCountText)),
    channelId,
    channelTitle: txt(vr.ownerText || vr.longBylineText || vr.shortBylineText),
    baselineMedianViews: 0,
    sourceMode: 'web',
    confidence: 0.54,
    reasons: []
  };
}

async function fetchYoutubeiContinuation(kind, token, cfg) {
  const endpoint = kind === 'search' ? 'search' : 'browse';
  const url = `https://www.youtube.com/youtubei/v1/${endpoint}?key=${encodeURIComponent(cfg.apiKey)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...webHeaders(),
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'X-Youtube-Client-Name': '1',
      'X-Youtube-Client-Version': cfg.clientVersion || '2.20240101.00.00'
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: cfg.clientVersion || '2.20240101.00.00',
          hl: 'en'
        }
      },
      continuation: token
    })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const entries = [];
  walkYoutubeData(data, entries);
  return { items: entries.map(itemFromYoutubeRenderer).filter(Boolean), continuationToken: findContinuationToken(data) };
}

function webHeaders(params = {}) {
  const lang = params.language || 'en';
  const region = params.region || 'US';
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': `${lang}-${region},${lang};q=0.9,en-US;q=0.8,en;q=0.7`,
    'Cookie': `CONSENT=PENDING+999; SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmc2J1ZmZlcnBsYXlzdG9yZV9hdXRoc2VydmVyXzIwMjMwNjI3LjA2X3AwGgVlbi1VUygB; PREF=hl=${lang}&gl=${region}`,
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  };
}

async function buildGeminiInsights(results, params) {
  const models = [process.env.GEMINI_MODEL, 'gemini-2.0-flash', 'gemini-1.5-flash'].filter(Boolean);
  const prompt = [
    'Cluster these YouTube outlier videos into concise niche themes.',
    'Return short JSON only with keys: themes, warnings.',
    JSON.stringify({
      keywords: params.keywords,
      videos: results.map(item => ({
        title: item.title,
        views: item.viewCount,
        outlier: item.outlierScore,
        channel: item.channelTitle
      }))
    })
  ].join('\n');

  let lastError = null;
  for (const model of [...new Set(models)]) {
    try {
      const payload = await geminiPool.requestJson(key => ({
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        }
      }), { rotateOnAnyError: true });

      const text = payload?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('\n').trim() || '';
      return { raw: text };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Gemini models unavailable');
}

function extractJsonAssignment(html, name) {
  const candidates = [
    `var ${name} =`,
    `window["${name}"] =`,
    `window['${name}'] =`,
    `${name} =`
  ];
  for (const marker of candidates) {
    const idx = html.indexOf(marker);
    if (idx < 0) continue;
    const start = html.indexOf('{', idx + marker.length);
    const json = extractBalancedJson(html, start);
    if (!json) continue;
    try {
      return JSON.parse(json);
    } catch {
      continue;
    }
  }
  return null;
}

function extractYtcfg(html) {
  const idx = html.indexOf('ytcfg.set(');
  if (idx < 0) return {};
  const start = html.indexOf('{', idx);
  const json = extractBalancedJson(html, start);
  if (!json) return {};
  try {
    const raw = JSON.parse(json);
    return {
      apiKey: raw.INNERTUBE_API_KEY || '',
      clientVersion: raw.INNERTUBE_CLIENT_VERSION || ''
    };
  } catch {
    return {};
  }
}

function extractBalancedJson(text, start) {
  if (start < 0 || text[start] !== '{') return '';
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return '';
}

function findContinuationToken(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 18) return '';
  const token = obj.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token
    || obj.continuationItemRenderer?.button?.buttonRenderer?.command?.continuationCommand?.token
    || obj.continuationCommand?.token;
  if (token) return token;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findContinuationToken(item, depth + 1);
      if (found) return found;
    }
    return '';
  }
  for (const value of Object.values(obj)) {
    const found = findContinuationToken(value, depth + 1);
    if (found) return found;
  }
  return '';
}

function parseChannelInput(input) {
  const raw = String(input || '').trim();
  let parsedUrl = null;
  try {
    parsedUrl = new URL(raw.startsWith('http') ? raw : `https://www.youtube.com/${raw.replace(/^\/+/, '')}`);
  } catch {
    parsedUrl = null;
  }

  if (/^UC[\w-]{10,}$/.test(raw)) return { channelId: raw };
  if (/^@[\w.-]+$/.test(raw)) return { handle: raw };

  if (parsedUrl && /(^|\.)youtube\.com$/i.test(parsedUrl.hostname)) {
    const parts = parsedUrl.pathname.split('/').filter(Boolean);
    if (parts[0] === 'channel' && /^UC[\w-]+$/.test(parts[1] || '')) return { channelId: parts[1] };
    if (parts[0]?.startsWith('@')) return { handle: parts[0] };
    if (parts[0] === 'user' && parts[1]) return { username: parts[1] };
    if ((parts[0] === 'c' || parts[0] === 'u') && parts[1]) return { query: parts.slice(1).join(' ') };
  }

  return { query: raw };
}

function channelPathFromInput(input) {
  const raw = String(input || '').trim();
  const parsed = parseChannelInput(raw);
  if (parsed.channelId) return `channel/${parsed.channelId}`;
  if (parsed.handle) return parsed.handle;
  if (parsed.username) return `user/${parsed.username}`;
  if (/^[\w.-]+$/.test(raw)) return raw.startsWith('@') ? raw : `@${raw}`;
  try {
    const url = new URL(raw);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length) return parts.slice(0, 2).join('/');
  } catch {}
  return '';
}

function cleanChannelLabel(input) {
  return String(input || '').replace(/^https?:\/\/(www\.)?youtube\.com\//i, '').slice(0, 48);
}

function txt(obj) {
  if (!obj) return '';
  if (typeof obj === 'string') return obj;
  if (typeof obj.simpleText === 'string') return obj.simpleText;
  if (typeof obj.content === 'string') return obj.content;
  if (Array.isArray(obj.runs)) return obj.runs.map(run => run.text || '').join('');
  return '';
}

function bestThumbnail(thumbnails) {
  const list = thumbnails?.thumbnails || thumbnails?.sources || thumbnails || [];
  if (!Array.isArray(list) || !list.length) return '';
  return list.slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || '';
}

function lockupMetadataParts(lockup) {
  const rows = lockup?.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows || [];
  return rows.flatMap(row => row?.metadataParts || []).map(part => txt(part?.text)).filter(Boolean);
}

function lockupDuration(lockup) {
  const overlays = lockup?.contentImage?.thumbnailViewModel?.overlays
    || lockup?.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel?.overlays
    || [];
  for (const overlay of overlays) {
    const badges = overlay?.thumbnailBottomOverlayViewModel?.badges
      || overlay?.thumbnailOverlayBadgeViewModel?.thumbnailBadges
      || [];
    for (const badge of badges) {
      const value = txt(badge?.thumbnailBadgeViewModel?.text);
      if (value) return value;
    }
  }
  return '';
}

function parseDuration(value) {
  const parts = String(value || '').trim().split(':').map(Number);
  if (!parts.length || parts.some(n => !Number.isFinite(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function parseIsoDuration(value) {
  const m = String(value || '').match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (Number(m[1]) || 0) * 86400
    + (Number(m[2]) || 0) * 3600
    + (Number(m[3]) || 0) * 60
    + (Number(m[4]) || 0);
}

function formatDuration(seconds) {
  const total = Number(seconds) || 0;
  if (!total) return '';
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function parseCompactNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : 0;
  const raw = String(value || '')
    .replace(/\u00a0/g, ' ')
    .trim();
  if (!raw) return 0;
  const match = raw.match(/([\d\s.,]+)\s*(billion|million|thousand|bilhao|bilhoes|milhao|milhoes|lakh|crore|b|m|k|mil|mi)?/i);
  if (!match) return 0;
  let numStr = match[1].replace(/\s+/g, '');
  const suffix = (match[2] || '').toLowerCase();

  if (suffix) {
    numStr = numStr.replace(/,/g, '.');
    let base = parseFloat(numStr);
    if (!Number.isFinite(base)) return 0;
    if (/^b|bilh/.test(suffix)) return Math.round(base * 1_000_000_000);
    if (/^m|million|milh|mi$/.test(suffix)) return Math.round(base * 1_000_000);
    if (/^k|thousand|mil$/.test(suffix)) return Math.round(base * 1_000);
    if (suffix === 'lakh') return Math.round(base * 100_000);
    if (suffix === 'crore') return Math.round(base * 10_000_000);
    return Math.round(base);
  }

  if (numStr.includes(',') && numStr.includes('.')) {
    if (numStr.lastIndexOf(',') > numStr.lastIndexOf('.')) {
      numStr = numStr.replace(/\./g, '').replace(',', '.');
    } else {
      numStr = numStr.replace(/,/g, '');
    }
  } else if (numStr.includes(',')) {
    const parts = numStr.split(',');
    if (parts.length > 1 && parts.every((p, idx) => idx === 0 || p.length === 3)) {
      numStr = numStr.replace(/,/g, '');
    } else {
      numStr = numStr.replace(',', '.');
    }
  } else if (numStr.includes('.')) {
    const parts = numStr.split('.');
    if (parts.length > 1 && parts.every((p, idx) => idx === 0 || p.length === 3)) {
      numStr = numStr.replace(/\./g, '');
    }
  }

  const base = parseFloat(numStr);
  return Number.isFinite(base) ? Math.round(base) : 0;
}

function relativeDateToIso(text) {
  const raw = String(text || '').toLowerCase();
  if (!raw) return '';
  const n = Number((raw.match(/(\d+)/) || [])[1] || 1);
  const date = new Date();
  if (/second|segundo/.test(raw)) date.setUTCSeconds(date.getUTCSeconds() - n);
  else if (/minute|minuto/.test(raw)) date.setUTCMinutes(date.getUTCMinutes() - n);
  else if (/hour|hora/.test(raw)) date.setUTCHours(date.getUTCHours() - n);
  else if (/week|semana/.test(raw)) date.setUTCDate(date.getUTCDate() - n * 7);
  else if (/month|mes|meses/.test(raw)) date.setUTCMonth(date.getUTCMonth() - n);
  else if (/year|ano/.test(raw)) date.setUTCFullYear(date.getUTCFullYear() - n);
  else date.setUTCDate(date.getUTCDate() - n);
  return date.toISOString();
}

function daysSince(iso) {
  if (!iso) return 0;
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return 0;
  return Math.max(1, Math.ceil((Date.now() - time) / 86400000));
}

function formatAge(iso) {
  const days = daysSince(iso);
  if (!days) return '';
  if (days < 2) return 'today';
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  return `${Math.round(days / 365)} years ago`;
}

function formatCompact(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000_000) return `${trimNumber(n / 1_000_000_000)}B`;
  if (n >= 1_000_000) return `${trimNumber(n / 1_000_000)}M`;
  if (n >= 1_000) return `${trimNumber(n / 1_000)}K`;
  return String(Math.round(n));
}

function trimNumber(value) {
  return Number(value).toFixed(value >= 10 ? 1 : 2).replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1');
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function avg(values) {
  const good = values.filter(Number.isFinite);
  return good.length ? good.reduce((sum, value) => sum + value, 0) / good.length : 0;
}

function chunks(items, size) {
  const output = [];
  for (let i = 0; i < items.length; i += size) output.push(items.slice(i, i + size));
  return output;
}

function toCsv(results) {
  const headers = [
    'Title', 'URL', 'Channel', 'Views', 'Published', 'Duration', 'Outlier Score',
    'Views Per Day', 'Subscribers', 'Views Per Subscriber', 'Source', 'Saved', 'Seen'
  ];
  const rows = results.map(item => [
    item.title,
    item.url,
    item.channelTitle,
    item.viewCount,
    item.publishedAt,
    item.durationLabel,
    finiteMetric(item.outlierScore) === null ? '' : Number(item.outlierScore).toFixed(2),
    finiteMetric(item.viewsPerDay) === null ? '' : Math.round(item.viewsPerDay),
    finiteMetric(item.subscriberCount) === null ? '' : item.subscriberCount,
    finiteMetric(item.viewsPerSubscriber) === null ? '' : Number(item.viewsPerSubscriber).toFixed(2),
    item.sourceMode,
    item.saved ? 'yes' : 'no',
    item.seen ? 'yes' : 'no'
  ]);
  return [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toPlannerText(results) {
  return results.map((item, index) => {
    const title = item.title.replace(/\s+/g, ' ').trim();
    const outlier = finiteMetric(item.outlierScore);
    const description = [
      `Channel: ${item.channelTitle}`,
      `Views: ${formatCompact(item.viewCount)}`,
      `Outlier: ${outlier === null ? 'pending baseline' : `${outlier.toFixed(2)}x`}`,
      `URL: ${item.url}`
    ].join('\n');
    return `**${index + 1}. ${title}**\n\nDESCRIPCION:\n${description}\n\nTHUMBNAIL:\n${item.thumbnail}`;
  }).join('\n\n---\n\n');
}

function selectedResults(req) {
  const id = String(req.query.id || '');
  if (id && jobs.has(id)) return jobs.get(id).results || [];
  return lastResults || [];
}

async function fileSize(file) {
  try {
    return Number((await fsp.stat(file)).size) || 0;
  } catch {
    return 0;
  }
}

async function directorySize(directory) {
  let total = 0;
  let entries = [];
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directorySize(child);
    else if (entry.isFile()) total += await fileSize(child);
  }
  return total;
}

function startJobRunner(job, params) {
  if (job._runnerStarted) return;
  if (['auto', 'browser'].includes(params.mode)) {
    if (activeBrowserJobId && activeBrowserJobId !== job.id) {
      job.status = 'paused';
      job.pauseRequested = true;
      jobUpdate(job, job.progress || 0, 'Waiting for the active browser expedition');
      return false;
    }
    activeBrowserJobId = job.id;
  }
  job._runnerStarted = true;
  job._runnerPromise = new Promise(resolve => setImmediate(resolve))
    .then(() => runResearchJob(job, params))
    .catch(err => {
      job._runnerStarted = false;
      if (err instanceof ResearchCancelledError) {
        job.status = job.shutdownRequested ? 'paused' : 'cancelled';
        job.results = job.results || [];
        job.completedAt = job.shutdownRequested ? '' : new Date().toISOString();
        jobUpdate(
          job,
          job.shutdownRequested ? (job.progress || 0) : 100,
          job.shutdownRequested ? 'Paused safely when the application closed' : 'Research stopped'
        );
        return;
      }
      job.status = 'error';
      job.errors = [...(job.errors || []), safeErrorMessage(err)].slice(-20);
      job.completedAt = new Date().toISOString();
      jobUpdate(job, 100, 'Research failed');
    })
    .finally(() => {
      if (['auto', 'browser'].includes(params.mode) && activeBrowserJobId === job.id) {
        browserResearchAdapter?.endRun?.();
        activeBrowserJobId = '';
      }
      job._runnerPromise = null;
      pruneCompletedJobs();
    });
  return true;
}

function pruneCompletedJobs() {
  const completed = [...jobs.values()]
    .filter(job => ['complete', 'error', 'cancelled'].includes(job.status))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  for (const job of completed.slice(20)) {
    if (jobSubscribers.get(job.id)?.size) continue;
    jobs.delete(job.id);
  }
}

function setBrowserResearchAdapter(adapter) {
  browserResearchAdapter = adapter || null;
}

async function setActiveResearchUserControl(enabled) {
  const job = activeResearchJobs()[0] || null;
  if (enabled) {
    if (job && !manualBrowserControl) {
      manualBrowserControl = { jobId: job.id, previousStatus: job.status, wasPaused: job.status === 'paused' };
      job.pauseRequested = true;
      job.pauseReason = 'manual_control';
      job.status = 'paused';
      job.currentOperation = {
        phase: 'manual_control', taskType: 'manual_control', subject: 'User inspecting the local browser',
        source: 'browser', status: 'paused', startedAt: new Date().toISOString(), cursorAction: 'user'
      };
      jobUpdate(job, job.progress || 0, 'Manual browser control');
    }
    await browserResearchAdapter?.setUserControl?.(true);
  } else {
    manualBrowserControl = null;
    await browserResearchAdapter?.setUserControl?.(false);
    if (browserResearchAdapter) {
      browserResearchAdapter.attention = false;
      if (browserResearchAdapter.telemetry) {
        browserResearchAdapter.telemetry.playerState = 'ready';
        browserResearchAdapter.telemetry.phase = 'research';
      }
    }
    if (job) {
      job.pauseReason = '';
      job.pauseRequested = false;
      job.status = 'running';
      if (job.currentOperation) {
        job.currentOperation.status = 'running';
        if (job.currentOperation.phase === 'manual_control') {
          job.currentOperation.phase = 'research';
          job.currentOperation.subject = 'Retomando pesquisa autônoma...';
        }
      }
      jobUpdate(job, job.progress || 0, 'Researcher resumed');
    }
  }
  return { ok: true, controlOwner: enabled ? 'user' : 'researcher', job: job ? publicJob(job) : null };
}

function setDesktopSettingsAdapter(adapter) {
  desktopSettingsAdapter = adapter || null;
  if (desktopSettingsAdapter?.notify) {
    activeDesktopNotifier = (alert) => {
      const title = alert.isBaby ? '🍼 Canal Bebê Detectado!' : '🚨 Super Outlier Detectado!';
      const body = `${alert.channelTitle}: ${alert.outlierMultiplier}x sobre a base (${alert.viewText || alert.viewCount} views)`;
      desktopSettingsAdapter.notify(title, body);
    };
  }
  if (desktopSettingsAdapter) applyDesktopSettings(settingsProfile().settings);
}

function activeResearchJobs() {
  return [...jobs.values()].filter(job => ['queued', 'running', 'paused', 'needs_attention'].includes(job.status));
}

function allResearchJobs() {
  return [...jobs.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function hasActiveResearchJobs() {
  return activeResearchJobs().some(job => ['queued', 'running', 'needs_attention'].includes(job.status));
}

function pauseActiveResearch() {
  for (const job of activeResearchJobs()) {
    job.pauseRequested = true;
    job.status = 'paused';
    jobUpdate(job, job.progress || 0, 'Research paused from tray');
  }
}

function resumeActiveResearch() {
  for (const job of activeResearchJobs()) {
    job.pauseRequested = false;
    job.status = 'running';
    jobUpdate(job, job.progress || 0, 'Resuming research');
    if (!job._runnerStarted) startJobRunner(job, job.params || {});
  }
}

function cancelJob(job, reason = 'Pesquisa cancelada') {
  if (!job) return;
  job.cancelRequested = true;
  job.pauseRequested = false;
  job.status = 'cancelled';
  job.message = reason;
  job.updatedAt = new Date().toISOString();
  if (job.currentOperation) {
    job.currentOperation.status = 'cancelled';
  }
  researchStore.saveRun(job);
  if (browserResearchAdapter?.cancel) {
    try { browserResearchAdapter.cancel(); } catch {}
  }
  jobUpdate(job, job.progress || 0, reason);
}

function cancelActiveResearch() {
  for (const job of activeResearchJobs()) {
    cancelJob(job, 'Pesquisa cancelada');
  }
}

async function backfillOpportunityData() {
  if (backfillPromise) return backfillPromise;
  backfillPromise = (async () => {
    backfillState.status = 'running';
    backfillState.error = '';
    backfillState.processed = 0;
    try {
      for (;;) {
        const pending = researchStore.channelsNeedingClassification(FACELESS_CLASSIFIER_VERSION, 40);
        backfillState.remaining = pending.length;
        if (!pending.length) break;
        for (const channel of pending) {
          const channelId = stableChannelKey(channel);
          if (!channelId) {
            researchStore.saveChannelClassification({
              ...channel,
              channelId: channel.channelId || channel.id || 'legacy-unknown',
              classifierVersion: FACELESS_CLASSIFIER_VERSION,
              facelessScore: 0,
              facelessConfidence: 1,
              facelessStatus: 'ignored',
              facelessEvidence: [],
              facelessNegativeSignals: ['Missing channel identity']
            });
            continue;
          }
          const videos = applyChannelBaselines(researchStore.channelVideos(channelId, 24).map(normalizeResult));
          const rebuilt = buildChannelResults(videos, [{ ...channel, channelId }])[0];
          if (!rebuilt) {
            researchStore.saveChannelClassification({
              ...channel,
              channelId,
              classifierVersion: FACELESS_CLASSIFIER_VERSION,
              facelessScore: 0,
              facelessConfidence: 0,
              facelessStatus: 'ignored',
              facelessEvidence: [],
              facelessNegativeSignals: ['Unbuildable channel']
            });
            continue;
          }
          researchStore.saveChannelClassification(rebuilt);
          researchStore.saveOpportunityDossier(channelId, rebuilt.dossier, 1);
          researchStore.upsertChannel(rebuilt);
          backfillState.processed += 1;
        }
        await delay(12);
      }
      backfillState.status = 'complete';
      backfillState.remaining = 0;
    } catch (error) {
      backfillState.status = 'error';
      backfillState.error = safeErrorMessage(error);
    } finally {
      backfillPromise = null;
    }
  })();
  return backfillPromise;
}

async function runOpportunityScout() {
  if (scoutPromise || activeResearchJobs().length) return scoutPromise;
  const settings = settingsProfile().settings.research;
  if (!settings.scoutEnabled) return null;
  scoutPromise = (async () => {
    scoutState.status = 'running';
    scoutState.error = '';
    scoutState.checked = 0;
    try {
      const due = researchStore.dueWatchlist(8);
      for (const entry of due) {
        try {
          const channel = researchStore.getChannel(entry.channelId);
          if (!channel) {
            researchStore.completeWatchCheck(entry.channelId, { missing: true });
            continue;
          }
          const storedVideos = researchStore.channelVideos(entry.channelId, 24);
          const topVideo = storedVideos.find(item => item.videoId === entry.topVideoId) || channel.topVideo;
          const refreshed = topVideo?.videoId ? await enrichWebVideo(topVideo) : null;
          const videos = applyChannelBaselines(mergeResults(refreshed ? [refreshed] : [], storedVideos));
          const rebuilt = buildChannelResults(videos.map(normalizeResult), [{ ...channel, channelId: entry.channelId }])[0];
          if (rebuilt) {
            researchStore.saveChannelClassification(rebuilt);
            researchStore.saveOpportunityDossier(entry.channelId, rebuilt.dossier, 1);
            researchStore.upsertChannel(rebuilt);
            researchStore.saveSnapshot('channel_metrics', entry.channelId, {
              opportunityScore: rebuilt.opportunityScore,
              dataCoverage: rebuilt.dataCoverage,
              subscriberCount: rebuilt.subscriberCount,
              medianOutlier: rebuilt.medianOutlier,
              avgVelocity: rebuilt.avgVelocity,
              facelessScore: rebuilt.facelessScore
            });
            if (refreshed) researchStore.upsertVideo(normalizeResult(refreshed));
          }
          researchStore.completeWatchCheck(entry.channelId, {
            topVideoId: rebuilt?.topVideo?.videoId || entry.topVideoId || '',
            opportunityScore: rebuilt?.opportunityScore || entry.opportunityScore || 0
          });
          scoutState.checked += 1;
          await delay(350);
        } catch (itemErr) {
          console.warn(`[Scout] Erro ao processar canal ${entry.channelId}:`, itemErr.message);
          researchStore.completeWatchCheck(entry.channelId, { error: true });
        }
      }
      scoutState.status = 'idle';
      scoutState.updatedAt = new Date().toISOString();
    } catch (error) {
      scoutState.status = 'error';
      scoutState.error = safeErrorMessage(error);
    } finally {
      scoutPromise = null;
    }
  })();
  return scoutPromise;
}

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  const origin = String(req.headers.origin || '');
  if (origin === 'null' || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  if (req.path !== '/viewer-smoke.html') {
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "img-src 'self' data: blob: https://i.ytimg.com https://yt3.ggpht.com https://*.googleusercontent.com",
      "connect-src 'self'",
      "media-src 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "frame-src 'none'",
      "worker-src 'self' blob:"
    ].join('; '));
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});
app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    host: serverState.host,
    port: serverState.port,
    desktop: process.env.VPR_DESKTOP === '1',
    browser: browserResearchAdapter?.status?.() || { available: false, reason: 'Desktop researcher not connected' },
    modes: ['auto', 'browser', 'http', 'api'],
    youtube: youtubePool.health(),
    gemini: { ...geminiPool.health(), model: process.env.GEMINI_MODEL || 'gemini-2.0-flash' },
    lastResults: Array.isArray(lastResults) ? lastResults.length : 0,
    backfill: { ...backfillState },
    scout: { ...scoutState }
  });
});

app.get('/api/settings', (req, res) => {
  try {
    res.json(settingsProfile());
  } catch (error) {
    res.status(500).json({ error: safeErrorMessage(error) });
  }
});

app.patch('/api/settings', (req, res) => {
  try {
    const current = settingsProfile();
    const changes = req.body?.changes || {};
    const next = validateSettingsPatch(changes, current.settings);
    const result = researchStore.applySettings(req.body?.revision, next);
    if (result.conflict) return res.status(409).json(settingsProfile());
    if (req.body?.legacyMigration === true) researchStore.setMeta('legacy_theme_migrated', '1');
    applyDesktopSettings(next);
    return res.json(settingsProfile());
  } catch (error) {
    return res.status(400).json({ error: safeErrorMessage(error) });
  }
});

app.post('/api/settings/reset', (req, res) => {
  try {
    const section = String(req.body?.section || 'all');
    if (section !== 'all' && !Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, section)) {
      return res.status(400).json({ error: 'unknown settings section' });
    }
    const result = researchStore.resetSettings(req.body?.revision, section === 'all' ? [] : [section]);
    if (result.conflict) return res.status(409).json(settingsProfile());
    const profile = settingsProfile();
    applyDesktopSettings(profile.settings);
    return res.json(profile);
  } catch (error) {
    return res.status(400).json({ error: safeErrorMessage(error) });
  }
});

app.get('/api/settings/export', (req, res) => {
  const profile = settingsProfile();
  const payload = { version: SETTINGS_VERSION, exportedAt: new Date().toISOString(), settings: profile.settings };
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="viral-research-settings.json"');
  res.send(JSON.stringify(payload, null, 2));
});

app.post('/api/settings/import', (req, res) => {
  try {
    if (Number(req.body?.version) !== SETTINGS_VERSION) return res.status(400).json({ error: 'settings version not supported' });
    const current = settingsProfile();
    const next = validateSettingsPatch(req.body?.settings, current.settings);
    const result = researchStore.applySettings(req.body?.revision, next);
    if (result.conflict) return res.status(409).json(settingsProfile());
    applyDesktopSettings(next);
    return res.json(settingsProfile());
  } catch (error) {
    return res.status(400).json({ error: safeErrorMessage(error) });
  }
});

app.post('/api/settings/integrations/:provider/test', async (req, res) => {
  const provider = String(req.params.provider || '').toLowerCase();
  const started = Date.now();
  try {
    if (provider === 'youtube') {
      if (!youtubePool.size) return res.status(409).json({ ok: false, provider, error: 'YouTube API is not configured' });
      await youtubeApi('videos', { part: 'id', id: 'dQw4w9WgXcQ' });
    } else if (provider === 'gemini') {
      if (!geminiPool.size) return res.status(409).json({ ok: false, provider, error: 'Gemini API is not configured' });
      await geminiPool.requestJson(key => ({
        url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`
      }), { rotateOnAnyError: true });
    } else if (provider === 'browser') {
      if (!browserResearchAdapter) return res.status(409).json({ ok: false, provider, error: 'Local browser requires the desktop application' });
    } else {
      return res.status(404).json({ error: 'integration not supported' });
    }
    return res.json({ ok: true, provider, latencyMs: Date.now() - started });
  } catch (error) {
    return res.status(502).json({ ok: false, provider, error: safeErrorMessage(error), latencyMs: Date.now() - started });
  }
});

app.get('/api/settings/storage', async (req, res) => {
  try {
    const databaseBytes = await fileSize(path.join(DATA_DIR, 'research.db'));
    const profileBytes = await directorySize(path.join(DATA_DIR, 'electron-profile'));
    const totalBytes = await directorySize(DATA_DIR);
    return res.json({ databaseBytes, profileBytes, totalBytes, ...researchStore.storageStats() });
  } catch (error) {
    return res.status(500).json({ error: safeErrorMessage(error) });
  }
});

app.post('/api/settings/storage/clear', async (req, res) => {
  const target = String(req.body?.target || '');
  try {
    if (target === 'cache') {
      researchStore.clearCache();
      await browserResearchAdapter?.clearCache?.();
    } else if (target === 'history') {
      if (activeResearchJobs().length) return res.status(409).json({ error: 'Stop active research before clearing history' });
      researchStore.clearHistory();
      sessionStore = [];
      lastResults = [];
      seenStore.seen = {};
      seenStore.saved = {};
      await Promise.all([writeJsonFile(seenFile, seenStore), writeJsonFile(lastFile, []), writeJsonFile(sessionsFile, [])]);
    } else {
      return res.status(400).json({ error: 'target must be cache or history' });
    }
    return res.json({ ok: true, target, ...researchStore.storageStats() });
  } catch (error) {
    return res.status(500).json({ error: safeErrorMessage(error) });
  }
});

app.post('/api/settings/desktop/open-data', async (req, res) => {
  if (!desktopSettingsAdapter?.openDataFolder) return res.status(409).json({ error: 'This action requires the desktop application' });
  try {
    await desktopSettingsAdapter.openDataFolder();
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: safeErrorMessage(error) });
  }
});

app.post('/api/research/run', (req, res) => {
  const params = sanitizeResearchBody(req.body || {});
  if (['auto', 'browser'].includes(params.mode)) {
    const existing = activeResearchJobs().find(job => ['auto', 'browser'].includes(job.params?.mode));
    if (existing) {
      return res.status(409).json({
        error: 'An autonomous browser expedition is already active',
        activeJobId: existing.id
      });
    }
  }
  const id = crypto.randomUUID();
  const job = {
    id,
    status: 'queued',
    progress: 0,
    message: 'Queued',
    results: [],
    errors: [],
    warnings: [],
    channels: [],
    niches: [],
    activity: [],
    discovery: {},
    cancelRequested: false,
    pauseRequested: false,
    insights: null,
    params,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  jobs.set(id, job);
  jobUpdate(job, 0, 'Queued');
  res.json({ id });
  startJobRunner(job, params);
});

app.get('/api/research/run/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  return res.json(publicJob(job));
});

app.get('/api/research/run/:id/events', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const listeners = jobSubscribers.get(job.id) || new Set();
  listeners.add(res);
  jobSubscribers.set(job.id, listeners);
  res.write(`data: ${JSON.stringify(publicJob(job))}\n\n`);
  const keepAlive = setInterval(() => res.write(': keepalive\n\n'), 20000);
  req.on('close', () => {
    clearInterval(keepAlive);
    listeners.delete(res);
    if (!listeners.size) jobSubscribers.delete(job.id);
  });
});

app.get('/api/research/active', (req, res) => {
  const active = [...jobs.values()]
    .filter(job => ['queued', 'running', 'paused', 'needs_attention'].includes(job.status))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  res.json({ jobs: active.map(publicJob) });
});

app.post('/api/research/run/:id/pause', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  if (['complete', 'error', 'cancelled'].includes(job.status)) return res.json({ ok: true, status: job.status });
  job.pauseRequested = true;
  job.status = 'paused';
  jobUpdate(job, job.progress || 0, 'Research paused');
  return res.json({ ok: true, status: job.status });
});

app.post('/api/research/run/:id/resume', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  if (['complete', 'error', 'cancelled'].includes(job.status)) return res.status(409).json({ error: `job is ${job.status}` });
  await setActiveResearchUserControl(false);
  job.pauseRequested = false;
  job.pauseReason = '';
  job.status = 'running';
  if (job.currentOperation) {
    job.currentOperation.status = 'running';
    if (job.currentOperation.phase === 'manual_control') {
      job.currentOperation.phase = 'research';
      job.currentOperation.subject = 'Retomando pesquisa autônoma...';
    }
  }
  jobUpdate(job, job.progress || 0, 'Resuming research');
  if (!job._runnerStarted) startJobRunner(job, job.params || {});
  return res.json({ ok: true, status: job.status });
});

app.post('/api/research/network-status', async (req, res) => {
  const online = Boolean(req.body?.online);
  const active = [...jobs.values()].filter(job => ['running', 'paused', 'needs_attention'].includes(job.status));
  if (online) {
    if (browserResearchAdapter?.setNetworkOffline) {
      browserResearchAdapter.setNetworkOffline(false);
    }
    for (const job of active) {
      if (job.pauseReason === 'network_offline') {
        job.pauseReason = '';
        job.pauseRequested = false;
        job.status = 'running';
        if (job.currentOperation) {
          job.currentOperation.status = 'running';
          job.currentOperation.networkOffline = false;
        }
        jobUpdate(job, job.progress || 0, 'Conexão restabelecida — Atualizando o YouTube e retomando pesquisa');
      }
    }
    return res.json({ ok: true, online: true });
  } else {
    if (browserResearchAdapter?.setNetworkOffline) {
      browserResearchAdapter.setNetworkOffline(true, 'Detectado pelo frontend');
    }
    for (const job of active) {
      if (job.status === 'running') {
        job.pauseRequested = true;
        job.pauseReason = 'network_offline';
        job.status = 'paused';
        if (job.currentOperation) {
          job.currentOperation.status = 'paused';
          job.currentOperation.networkOffline = true;
        }
        jobUpdate(job, job.progress || 0, 'Sem conexão com a internet — Pesquisa pausada e contagem congelada');
      }
    }
    return res.json({ ok: true, online: false });
  }
});

app.post('/api/research/run/:id/cancel', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  cancelJob(job, 'Pesquisa cancelada pelo usuário');
  return res.json({ ok: true, status: job.status });
});

app.get('/api/research/browser/status', (req, res) => {
  res.json(browserResearchAdapter?.status?.() || { available: false, visible: false, activePages: 0 });
});

app.post(['/api/research/deconstruct', '/api/research/deconstruct/:videoId'], async (req, res) => {
  const videoId = String(req.params.videoId || req.body?.videoId || '').trim();
  if (!videoId) return res.status(400).json({ error: 'videoId required' });

  const cached = researchStore.getSnapshot?.('deconstruction', videoId);
  if (cached && !req.body?.force) {
    return res.json({ ok: true, videoId, deconstruction: cached, fromCache: true });
  }

  try {
    const videoData = {
      videoId,
      title: req.body?.title || '',
      channelTitle: req.body?.channelTitle || '',
      durationSeconds: Number(req.body?.durationSeconds) || 0,
      viewCount: Number(req.body?.viewCount) || 0,
      subscriberCount: Number(req.body?.subscriberCount) || 0
    };

    const deconstruction = await deconstructVideo(videoData);
    researchStore.saveSnapshot('deconstruction', videoId, deconstruction);
    return res.json({ ok: true, videoId, deconstruction });
  } catch (err) {
    return res.status(500).json({ error: safeErrorMessage(err) });
  }
});

app.get('/api/research/deconstruct/:videoId', async (req, res) => {
  const videoId = String(req.params.videoId || '').trim();
  if (!videoId) return res.status(400).json({ error: 'videoId required' });

  const cached = researchStore.getSnapshot?.('deconstruction', videoId);
  if (cached) {
    return res.json({ ok: true, videoId, deconstruction: cached, fromCache: true });
  }

  try {
    const deconstruction = await deconstructVideo({ videoId });
    researchStore.saveSnapshot('deconstruction', videoId, deconstruction);
    return res.json({ ok: true, videoId, deconstruction });
  } catch (err) {
    return res.status(500).json({ error: safeErrorMessage(err) });
  }
});

app.get('/api/research/blueprint/styles', (req, res) => {
  return res.json({ ok: true, styles: Object.values(SCRIPT_STYLES) });
});

app.post('/api/research/blueprint/generate', (req, res) => {
  const video = req.body?.video || {};
  const style = req.body?.style || 'documentary';
  try {
    const blueprint = generateViralBlueprint(video, { style });
    researchStore.saveSnapshot('blueprint', blueprint.id, blueprint);
    return res.json({ ok: true, blueprint });
  } catch (err) {
    return res.status(500).json({ error: safeErrorMessage(err) });
  }
});

app.get('/api/research/blueprints', (req, res) => {
  try {
    const blueprints = researchStore.listSnapshots('blueprint', 60);
    return res.json({ ok: true, blueprints });
  } catch (err) {
    return res.status(500).json({ error: safeErrorMessage(err) });
  }
});

app.post('/api/research/blueprint/export', (req, res) => {
  const blueprint = req.body?.blueprint;
  if (!blueprint) return res.status(400).json({ error: 'blueprint required' });
  try {
    const markdown = formatBlueprintAsMarkdown(blueprint);
    return res.json({ ok: true, markdown });
  } catch (err) {
    return res.status(500).json({ error: safeErrorMessage(err) });
  }
});

app.delete('/api/research/blueprint/:id', (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    researchStore.deleteSnapshot('blueprint', id);
    return res.json({ ok: true, id });
  } catch (err) {
    return res.status(500).json({ error: safeErrorMessage(err) });
  }
});

app.get('/api/niche/seeds', (_req, res) => {
  const seeds = [
    { id: 'history', label: 'História & Mistérios', icon: '🏛️', query: 'mistérios não resolvidos, arqueologia proibida, história oculta', rpm: 'US$ 4.0 - 7.5' },
    { id: 'psychology', label: 'Psicologia & Crime', icon: '🧠', query: 'psicologia sombria, mentes criminosas, manipulação comportamental', rpm: 'US$ 4.5 - 8.0' },
    { id: 'military', label: 'Engenharia & Militar', icon: '🚀', query: 'mega engenharia militar, tecnologia secreta, veículos de guerra', rpm: 'US$ 5.0 - 9.0' },
    { id: 'business', label: 'Negócios & Poder', icon: '💼', query: 'ascensão e queda de impérios, segredos de bilionários, fraudes financeiras', rpm: 'US$ 6.0 - 12.0' },
    { id: 'ocean', label: 'Oceano & Anomalias', icon: '🌊', query: 'criaturas abissais, anomalias da natureza, biologia bizarra', rpm: 'US$ 3.5 - 6.5' }
  ];
  return res.json({ ok: true, seeds });
});

app.post('/api/export/masterdeck', (req, res) => {
  try {
    let items = req.body?.items;
    if (!Array.isArray(items) || !items.length) {
      items = researchStore.listSavedVideos(30);
    }
    const markdown = generateProductionMasterdeckMarkdown(items);
    if (req.query.format === 'raw' || req.headers.accept?.includes('text/markdown')) {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="dossie-producao-masterdeck.md"');
      return res.send(markdown);
    }
    return res.json({ ok: true, count: items.length, markdown });
  } catch (err) {
    return res.status(500).json({ error: safeErrorMessage(err) });
  }
});

app.get('/api/sentinel/status', (req, res) => {
  const sentinelSettings = settingsProfile().settings.sentinel || {};
  return res.json({
    ok: true,
    enabled: Boolean(sentinelSettings.enabled),
    running: sentinelEngine.running,
    intervalMinutes: sentinelSettings.intervalMinutes || 30,
    alertCount: sentinelEngine.alertHistory.length,
    history: sentinelEngine.alertHistory
  });
});

app.post('/api/sentinel/test', async (req, res) => {
  const provider = String(req.body?.provider || '').toLowerCase();
  const config = req.body?.config || {};
  const currentSettings = settingsProfile().settings.sentinel || {};

  const sampleAlert = {
    videoId: 'sample_outlier',
    title: 'Descoberta Chocante: O Arquivo Perdido Que Ninguém Viu',
    channelTitle: 'Canal Revelação Misteriosa',
    thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    viewCount: 285000,
    viewText: '285.000',
    outlierMultiplier: '18.4',
    isBaby: true,
    channelAgeDays: 32,
    reason: 'Canal com 32 dias e 18.4x acima da média',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  };

  try {
    if (provider === 'telegram') {
      const token = config.telegramToken || currentSettings.telegramToken;
      const chatId = config.telegramChatId || currentSettings.telegramChatId;
      if (!token || !chatId) {
        return res.status(400).json({ ok: false, error: 'Telegram Bot Token e Chat ID são obrigatórios.' });
      }
      await sendTelegramAlert({ botToken: token, chatId }, sampleAlert);
      return res.json({ ok: true, provider, message: 'Alerta de teste enviado com sucesso no Telegram!' });
    } else if (provider === 'discord') {
      const webhook = config.discordWebhook || currentSettings.discordWebhook;
      if (!webhook) {
        return res.status(400).json({ ok: false, error: 'URL do Webhook do Discord é obrigatória.' });
      }
      await sendDiscordAlert(webhook, sampleAlert);
      return res.json({ ok: true, provider, message: 'Alerta de teste enviado com sucesso no Discord!' });
    } else if (provider === 'webhook') {
      const webhookUrl = config.webhookUrl || currentSettings.webhookUrl;
      if (!webhookUrl) {
        return res.status(400).json({ ok: false, error: 'URL do Webhook é obrigatória.' });
      }
      await sendGenericWebhookAlert(webhookUrl, sampleAlert);
      return res.json({ ok: true, provider, message: 'Alerta de teste enviado com sucesso via Webhook!' });
    } else {
      return res.status(400).json({ ok: false, error: 'Provedor inválido (use telegram, discord ou webhook).' });
    }
  } catch (err) {
    return res.status(502).json({ ok: false, provider, error: safeErrorMessage(err) });
  }
});

app.post('/api/sentinel/trigger', async (req, res) => {
  try {
    await sentinelEngine.runSentinelCycle();
    return res.json({ ok: true, message: 'Ciclo Sentinel executado com sucesso' });
  } catch (err) {
    return res.status(500).json({ error: safeErrorMessage(err) });
  }
});

app.post('/api/research/arbitrage/evaluate', (req, res) => {
  const item = req.body?.item || req.body || {};
  try {
    const arbitrage = evaluateArbitrage(item);
    return res.json({ ok: true, arbitrage });
  } catch (err) {
    return res.status(500).json({ error: safeErrorMessage(err) });
  }
});

app.post('/api/research/thumb/scan', (req, res) => {
  const thumbnailUrl = req.body?.thumbnailUrl || '';
  const meta = req.body || {};
  try {
    const analysis = analyzeThumbnail(thumbnailUrl, meta);
    return res.json({ ok: true, analysis });
  } catch (err) {
    return res.status(500).json({ error: safeErrorMessage(err) });
  }
});

function ensureDefaultProfiles() {
  const existing1 = researchStore.getBrowserProfile?.('profile-1');
  if (!existing1) {
    researchStore.saveBrowserProfile({
      id: 'profile-1',
      label: 'Perfil 1 (Nicho A)',
      niche: 'História & Mistérios',
      partition: 'persist:vpr-profile-1',
      isLoggedIn: false,
      isWarmed: false,
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString()
    });
  }
  const existing2 = researchStore.getBrowserProfile?.('profile-2');
  if (!existing2) {
    researchStore.saveBrowserProfile({
      id: 'profile-2',
      label: 'Perfil 2 (Nicho B / Geral)',
      niche: 'Finanças & Negócios',
      partition: 'persist:vpr-profile-2',
      isLoggedIn: false,
      isWarmed: false,
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString()
    });
  }
}

app.get('/api/research/browser/profiles', async (req, res) => {
  ensureDefaultProfiles();
  const rawProfiles = researchStore.listBrowserProfiles();
  const profiles = await Promise.all(rawProfiles.map(async profile => {
    let isLoggedIn = Boolean(profile.isLoggedIn);
    let cookieCount = 0;
    if (browserResearchAdapter?.checkProfileAuth && (profile.id === 'profile-1' || profile.id === 'profile-2')) {
      const auth = await browserResearchAdapter.checkProfileAuth(profile.id);
      isLoggedIn = auth.isLoggedIn;
      cookieCount = auth.cookieCount || 0;
      if (isLoggedIn !== profile.isLoggedIn) {
        profile.isLoggedIn = isLoggedIn;
        researchStore.saveBrowserProfile(profile);
      }
    }
    return {
      id: profile.id,
      label: profile.label,
      niche: profile.niche || '',
      partition: profile.partition || '',
      isLoggedIn,
      cookieCount,
      isWarmed: isLoggedIn,
      lastUsedAt: profile.lastUsedAt
    };
  }));

  const anonymousOption = {
    id: 'anonymous',
    label: 'Modo Anônimo (Zero Viés)',
    niche: 'Geral / Neutro',
    partition: '',
    isLoggedIn: false,
    cookieCount: 0,
    isWarmed: false,
    lastUsedAt: ''
  };

  const fixed = profiles.filter(p => ['profile-1', 'profile-2'].includes(p.id));
  const others = profiles.filter(p => !['anonymous', 'profile-1', 'profile-2'].includes(p.id));

  res.json({
    profiles: [anonymousOption, ...fixed, ...others],
    activeProfileId: browserResearchAdapter?.status?.().profile?.id || 'anonymous'
  });
});

app.post('/api/research/browser/profiles/:id/open-login', async (req, res) => {
  if (!browserResearchAdapter) {
    return res.status(409).json({ error: 'O login de perfis requer a aplicação desktop.' });
  }
  const id = String(req.params.id || '').trim();
  if (!['profile-1', 'profile-2'].includes(id)) {
    return res.status(400).json({ error: 'Apenas os perfis 1 e 2 podem ser autenticados.' });
  }
  try {
    const result = await browserResearchAdapter.openProfileLoginWindow(id);
    const existing = researchStore.getBrowserProfile?.(id) || {};
    existing.isLoggedIn = Boolean(result.isLoggedIn);
    existing.lastUsedAt = new Date().toISOString();
    researchStore.saveBrowserProfile(existing);
    return res.json({ ok: true, profile: existing, ...result });
  } catch (error) {
    return res.status(500).json({ error: safeErrorMessage(error) });
  }
});

app.post('/api/research/browser/profiles/:id/close-login', async (req, res) => {
  if (!browserResearchAdapter) return res.status(409).json({ error: 'Desktop application required' });
  try {
    await browserResearchAdapter.closeProfileLoginWindow?.();
    const id = String(req.params.id || '').trim();
    const auth = await browserResearchAdapter.checkProfileAuth?.(id) || { isLoggedIn: false };
    const existing = researchStore.getBrowserProfile?.(id) || {};
    existing.isLoggedIn = Boolean(auth.isLoggedIn);
    researchStore.saveBrowserProfile(existing);
    return res.json({ ok: true, profile: existing, ...auth });
  } catch (error) {
    return res.status(500).json({ error: safeErrorMessage(error) });
  }
});

app.post('/api/research/browser/profiles/:id/save', (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!['profile-1', 'profile-2'].includes(id)) {
    return res.status(400).json({ error: 'Perfil inválido' });
  }
  const label = String(req.body?.label || '').trim();
  const niche = String(req.body?.niche || '').trim();
  const existing = researchStore.getBrowserProfile?.(id) || { id, partition: `persist:vpr-${id}` };
  if (label) existing.label = label;
  if (niche) existing.niche = niche;
  existing.lastUsedAt = new Date().toISOString();
  researchStore.saveBrowserProfile(existing);
  return res.json({ ok: true, profile: existing });
});

app.post('/api/research/browser/profiles/clear', async (req, res) => {
  if (!browserResearchAdapter) return res.status(409).json({ error: 'Browser profiles require the desktop application' });
  const id = String(req.body?.id || '').trim();
  const all = Boolean(req.body?.all);
  try {
    if (all) {
      const profiles = researchStore.listBrowserProfiles();
      await browserResearchAdapter.clearAllProfiles?.(profiles.map(profile => profile.id));
      researchStore.clearBrowserProfiles();
    } else {
      if (!id) return res.status(400).json({ error: 'profile id required' });
      await browserResearchAdapter.clearProfile?.(id);
      const existing = researchStore.getBrowserProfile?.(id);
      if (existing) {
        existing.isLoggedIn = false;
        existing.isWarmed = false;
        researchStore.saveBrowserProfile(existing);
      }
    }
    return res.json({ ok: true, profiles: researchStore.listBrowserProfiles().length });
  } catch (error) {
    return res.status(500).json({ error: safeErrorMessage(error) });
  }
});

app.get('/api/research/browser/frame', async (req, res) => {
  if (!browserResearchAdapter?.captureFrame) return res.status(204).end();
  try {
    const frame = await withTimeout(browserResearchAdapter.captureFrame({
      worker: Math.max(0, Math.min(1, Number(req.query.worker) || 0)),
      width: Math.max(420, Math.min(1280, Number(req.query.width) || 960)),
      quality: Math.max(35, Math.min(82, Number(req.query.quality) || 60))
    }), 3500, null);
    if (!frame?.length) return res.status(204).end();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', String(frame.length));
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.end(frame);
  } catch (error) {
    return res.status(503).json({ error: safeErrorMessage(error) });
  }
});

app.get('/api/research/browser/snapshot', async (req, res) => {
  if (!browserResearchAdapter?.snapshot) return res.status(204).end();
  try {
    const snapshot = await withTimeout(browserResearchAdapter.snapshot(), 7000, null);
    if (!snapshot) return res.status(204).end();
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.json(snapshot);
  } catch (error) {
    return res.status(503).json({ error: safeErrorMessage(error) });
  }
});

app.post('/api/research/browser/viewer/:command', async (req, res) => {
  if (!browserResearchAdapter) return res.status(409).json({ error: 'Local research browser requires the desktop application' });
  const command = String(req.params.command || '');
  const worker = Math.max(0, Math.min(1, Number(req.body?.worker) || 0));
  try {
    if (command === 'show') await browserResearchAdapter.show(worker);
    else if (command === 'hide') await browserResearchAdapter.hide();
    else if (command === 'minimize') await browserResearchAdapter.minimize(worker);
    else if (command === 'expand') await browserResearchAdapter.expand(worker);
    else if (command === 'take-control') await setActiveResearchUserControl(true);
    else if (command === 'release-control') await setActiveResearchUserControl(false);
    else if (command === 'reload') {
      if (typeof browserResearchAdapter.handleViewerCommand === 'function') {
        await browserResearchAdapter.handleViewerCommand('reload');
      }
    } else if (command === 'navigate-home' || command === 'home') {
      if (typeof browserResearchAdapter.handleViewerCommand === 'function') {
        await browserResearchAdapter.handleViewerCommand('youtube-home');
      }
    } else if (command === 'select-worker') {
      const targetWorkerId = String(req.body?.workerId || req.body?.profileId || '');
      browserResearchAdapter.selectedWorker = worker;
      if (['all', 'all_profiles', 'profile-1', 'profile-2', 'anonymous'].includes(targetWorkerId) && typeof browserResearchAdapter.useProfileById === 'function') {
        await browserResearchAdapter.useProfileById(targetWorkerId);
      }
    } else return res.status(404).json({ error: 'viewer command not supported' });
    return res.json({ ok: true, ...browserResearchAdapter.status() });
  } catch (error) {
    return res.status(500).json({ error: safeErrorMessage(error) });
  }
});

app.post('/api/research/browser/reload', async (req, res) => {
  if (!browserResearchAdapter) return res.status(409).json({ error: 'Local research browser requires the desktop application' });
  try {
    if (typeof browserResearchAdapter.handleViewerCommand === 'function') {
      await browserResearchAdapter.handleViewerCommand('reload');
    }
    return res.json({ ok: true, ...browserResearchAdapter.status() });
  } catch (error) {
    return res.status(500).json({ error: safeErrorMessage(error) });
  }
});

app.post('/api/research/browser/navigate-home', async (req, res) => {
  if (!browserResearchAdapter) return res.status(409).json({ error: 'Local research browser requires the desktop application' });
  try {
    if (typeof browserResearchAdapter.handleViewerCommand === 'function') {
      await browserResearchAdapter.handleViewerCommand('youtube-home');
    }
    return res.json({ ok: true, ...browserResearchAdapter.status() });
  } catch (error) {
    return res.status(500).json({ error: safeErrorMessage(error) });
  }
});

app.post('/api/research/browser/select-worker', async (req, res) => {
  if (!browserResearchAdapter) return res.status(409).json({ error: 'Local research browser requires the desktop application' });
  const targetWorkerId = String(req.body?.workerId || req.body?.profileId || '');
  const worker = Math.max(0, Math.min(1, Number(req.body?.worker) || 0));
  try {
    browserResearchAdapter.selectedWorker = worker;
    if (['all', 'all_profiles', 'profile-1', 'profile-2', 'anonymous'].includes(targetWorkerId) && typeof browserResearchAdapter.useProfileById === 'function') {
      await browserResearchAdapter.useProfileById(targetWorkerId);
    }
    return res.json({ ok: true, selectedWorker: targetWorkerId, ...browserResearchAdapter.status() });
  } catch (error) {
    return res.status(500).json({ error: safeErrorMessage(error) });
  }
});

app.post('/api/research/browser/show', async (req, res) => {
  if (!browserResearchAdapter) return res.status(409).json({ error: 'Local research browser requires the desktop application' });
  await browserResearchAdapter.show(Number(req.body?.worker) || 0);
  return res.json({ ok: true, ...browserResearchAdapter.status() });
});

app.post('/api/research/browser/hide', async (req, res) => {
  if (!browserResearchAdapter) return res.status(409).json({ error: 'Local research browser requires the desktop application' });
  await browserResearchAdapter.hide();
  return res.json({ ok: true, ...browserResearchAdapter.status() });
});

app.post('/api/research/angles', (req, res) => {
  try {
    const video = req.body?.video || req.body || {};
    const dossier = generateViralAngles(video);
    return res.json({ ok: true, ...dossier });
  } catch (error) {
    return res.status(500).json({ error: safeErrorMessage(error) });
  }
});

app.get('/api/research/sessions', (req, res) => {
  const page = researchStore.listSessionsPage(req.query.limit, req.query.cursor);
  res.json({ sessions: page.sessions.map(sessionSummary), nextCursor: page.nextCursor });
});

app.get('/api/research/sessions/:id', (req, res) => {
  const session = researchStore.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'session not found' });
  return res.json({
    ...sessionSummary(session),
    params: session.params || {},
    channels: decoratePinnedChannels(session.channels || []),
    activity: session.activity || [],
    results: applySeenState(session.results || [])
  });
});

app.post('/api/research/sessions/:id/notes', async (req, res) => {
  const session = researchStore.updateSessionNotes(req.params.id, req.body?.notes);
  if (!session) return res.status(404).json({ error: 'session not found' });
  sessionStore = researchStore.listSessions(2000);
  return res.json({ ok: true, session: sessionSummary(session) });
});

app.get('/api/opportunities', (req, res) => {
  const view = ['recommended', 'favorites', 'review'].includes(String(req.query.view))
    ? String(req.query.view)
    : 'recommended';
  const preset = String(req.query.preset || 'all');
  const search = String(req.query.search || '').trim().toLowerCase();
  const hideSeen = String(req.query.hideSeen || '') === '1';
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 600, 2000));

  const allChannels = researchStore.listOpportunityChannels(2000)
    .map(channel => ({
      ...channel,
      trend: channelTrend(channel),
      manualPinned: Boolean(channel.favorite),
      arbitrage: evaluateArbitrage(channel),
      autoPotential: Boolean(channel.autoPotential || (
        (channel.facelessStatus === 'strict' || Number(channel.opportunityScore) >= 60)
        && Number(channel.dataCoverage) >= 0.50
        && channel.topVideo
        && daysSince(channel.topVideo.publishedAt) <= 120
      ))
    }));

  const savedVideos = (view === 'favorites' ? researchStore.listSavedVideos(300) : [])
    .filter(video => !search || [
      video.title,
      video.channelTitle,
      video.description
    ].join(' ').toLowerCase().includes(search));

  let channels = allChannels
    .filter(channel => {
      if (view === 'favorites') return channel.favorite;
      if (view === 'review') return !channel.favorite && (channel.facelessStatus === 'review' || (Number(channel.opportunityScore) >= 45 && !channel.autoPotential));
      return !channel.favorite && (channel.facelessStatus === 'strict' || channel.autoPotential);
    })
    .filter(channel => !search || [
      channel.channelTitle,
      channel.handle,
      channel.description,
      channel.fingerprint?.label,
      channel.dossier?.fingerprint?.label,
      channel.recommendationReason,
      channel.potentialReason
    ].join(' ').toLowerCase().includes(search))
    .filter(channel => !hideSeen || !seenStore.seen[channel.topVideo?.videoId])
    .filter(channel => opportunityPresetMatches(channel, preset))
    .sort((a, b) => Number(b.opportunityScore) - Number(a.opportunityScore))
    .slice(0, limit);

  const totalOpportunities = allChannels.filter(c => !c.favorite && (c.facelessStatus === 'strict' || c.autoPotential)).length;
  const totalReview = allChannels.filter(c => !c.favorite && (c.facelessStatus === 'review' || (Number(c.opportunityScore) >= 45 && !c.autoPotential))).length;
  const totalFavorites = allChannels.filter(c => c.favorite).length;

  return res.json({
    view,
    preset,
    channels,
    savedVideos,
    count: channels.length,
    savedVideosCount: savedVideos.length,
    stats: {
      totalOpportunities,
      totalReview,
      totalFavorites,
      totalSavedVideos: researchStore.countSavedVideos()
    },
    updatedAt: new Date().toISOString()
  });
});

app.get('/api/channels/:id', (req, res) => {
  const channel = researchStore.getChannel(req.params.id);
  if (!channel) return res.status(404).json({ error: 'channel not found' });
  const videos = applyChannelBaselines(researchStore.channelVideos(req.params.id, 24))
    .map(normalizeResult)
    .filter(item => !item.isLive && !isShortsResult(item))
    .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  return res.json({
    channel: {
      ...channel,
      manualPinned: Boolean(channel.favorite),
      feedback: researchStore.channelFeedback(req.params.id),
      dossier: researchStore.opportunityDossier(req.params.id) || channel.dossier || null,
      trend: channelTrend(channel)
    },
    videos
  });
});

app.post('/api/research/channel/feedback', (req, res) => {
  const channelId = String(req.body?.channelId || '').trim();
  const label = String(req.body?.label || '').trim();
  if (!channelId) return res.status(400).json({ error: 'channelId required' });
  if (!['faceless', 'not_faceless', 'ignore', 'clear'].includes(label)) {
    return res.status(400).json({ error: 'invalid feedback label' });
  }
  const feedback = researchStore.saveChannelFeedback(channelId, label, req.body?.note);
  const channel = researchStore.getChannel(channelId);
  if (channel) {
    const videos = applyChannelBaselines(researchStore.channelVideos(channelId, 24).map(normalizeResult));
    const rebuilt = buildChannelResults(videos, [{ ...channel, channelId }])[0];
    if (rebuilt) {
      researchStore.saveChannelClassification(rebuilt);
      researchStore.saveOpportunityDossier(channelId, rebuilt.dossier, 1);
      researchStore.upsertChannel(rebuilt);
    }
  }
  return res.json({ ok: true, channelId, feedback });
});

app.get('/api/opportunities/map', (req, res) => {
  const channels = researchStore.listOpportunityChannels(2000)
    .filter(channel => channel.facelessStatus !== 'ignored');
  const groups = new Map();
  for (const channel of channels) {
    const fingerprint = channel.fingerprint || channel.dossier?.fingerprint || { id: 'unclassified', label: 'unclassified' };
    const id = fingerprint.id || 'unclassified';
    const group = groups.get(id) || {
      id,
      label: fingerprint.label || id.replace(/-/g, ' '),
      channels: 0,
      eligible: 0,
      avgOpportunity: 0,
      avgVelocity: 0,
      avgCoverage: 0
    };
    group.channels += 1;
    group.eligible += channel.autoPotential ? 1 : 0;
    group.avgOpportunity += Number(channel.opportunityScore) || 0;
    group.avgVelocity += Number(channel.avgVelocity) || 0;
    group.avgCoverage += Number(channel.dataCoverage) || 0;
    groups.set(id, group);
  }
  const map = [...groups.values()].map(group => ({
    ...group,
    avgOpportunity: group.channels ? group.avgOpportunity / group.channels : 0,
    avgVelocity: group.channels ? group.avgVelocity / group.channels : 0,
    avgCoverage: group.channels ? group.avgCoverage / group.channels : 0,
    saturation: group.channels >= 30 ? 'high' : group.channels >= 12 ? 'medium' : 'low'
  })).sort((a, b) => b.avgOpportunity - a.avgOpportunity);
  res.json({ map, count: map.length, updatedAt: new Date().toISOString() });
});

app.get('/api/research/watchlist', (req, res) => {
  res.json({ due: researchStore.dueWatchlist(200) });
});

app.post('/api/research/channel/favorite', setChannelFavorite);
app.post('/api/research/channel/pin', setChannelFavorite);

function setChannelFavorite(req, res) {
  const channelId = String(req.body?.channelId || '').trim();
  if (!channelId) return res.status(400).json({ error: 'channelId required' });
  const requested = typeof req.body?.favorite === 'boolean' ? req.body.favorite : Boolean(req.body?.pinned);
  const pinned = researchStore.setChannelPinned(channelId, requested);
  for (const job of jobs.values()) {
    if (!Array.isArray(job.channels)) continue;
    const channel = job.channels.find(item => (item.channelId || item.id || item.channelTitle) === channelId);
    if (channel) {
      channel.manualPinned = pinned;
      channel.favorite = pinned;
    }
  }
  return res.json({ ok: true, channelId, pinned, favorite: pinned });
}

function channelTrend(channel) {
  const history = researchStore.metricHistory('channel_metrics', channel.channelId, 8);
  if (history.length < 2) return { status: 'collecting', delta: null, observations: history.length };
  const latest = history[0];
  const oldest = history[history.length - 1];
  const opportunityDelta = Number(latest.opportunityScore) - Number(oldest.opportunityScore);
  const velocityDelta = Number(latest.avgVelocity) - Number(oldest.avgVelocity);
  return {
    status: opportunityDelta >= 5 || velocityDelta > 0 ? 'accelerating' : opportunityDelta <= -5 ? 'cooling' : 'stable',
    delta: Number.isFinite(opportunityDelta) ? opportunityDelta : null,
    velocityDelta: Number.isFinite(velocityDelta) ? velocityDelta : null,
    observations: history.length,
    since: oldest.observedAt || ''
  };
}

function opportunityPresetMatches(channel, preset) {
  const score = Number(channel.opportunityScore) || 0;
  const avgViews = maxKnown(channel.baselineAvgViews, channel.topVideo?.baselineAvgViews);
  const age = finiteMetric(channel.channelAgeDays);
  const subscribers = finiteMetric(channel.subscriberCount);
  const topViews = finiteMetric(channel.topVideo?.viewCount);
  const medianOutlier = maxKnown(channel.medianOutlier, channel.topVideo?.outlierScore);
  const coverage = Number(channel.dataCoverage) || 0;
  const ageTrusted = age !== null && Number(channel.channelAgeConfidence) >= 0.55;
  if (preset === 'outliers') return medianOutlier !== null && medianOutlier >= 20;
  if (preset === 'avg-new') return avgViews !== null && avgViews >= 50000 && ageTrusted && age <= 90;
  if (preset === 'low-subs-high-views') return subscribers !== null && subscribers <= 10000 && topViews !== null && topViews >= 100000;
  if (preset === 'above50k') return avgViews >= 50000;
  if (preset === 'new') return ageTrusted && age <= 90;
  if (preset === 'quality-high') return score >= 80 && coverage >= 0.75;
  if (preset === 'quality-medium') return score >= 65 && score < 80 && coverage >= 0.6;
  if (preset === 'quality-low') return score >= 50 && score < 65 && coverage >= 0.45;
  if (preset === 'arbitrage') return Boolean(channel.arbitrage?.inexploredBrazil);
  return true;
}

app.post('/api/research/seen', async (req, res) => {
  const videoId = String(req.body?.videoId || '').trim();
  if (!videoId) return res.status(400).json({ error: 'videoId required' });

  if (typeof req.body.seen === 'boolean') {
    if (req.body.seen) seenStore.seen[videoId] = new Date().toISOString();
    else delete seenStore.seen[videoId];
  }
  if (typeof req.body.saved === 'boolean') {
    if (req.body.saved) seenStore.saved[videoId] = new Date().toISOString();
    else delete seenStore.saved[videoId];
  }

  for (const job of jobs.values()) {
    if (!Array.isArray(job.results)) continue;
    const item = job.results.find(result => result.videoId === videoId);
    if (item) {
      item.seen = Boolean(seenStore.seen[videoId]);
      item.saved = Boolean(seenStore.saved[videoId]);
    }
  }
  lastResults = applySeenState(lastResults);
  if (typeof req.body.seen === 'boolean') researchStore.setVideoMark(videoId, 'seen', Boolean(req.body.seen));
  if (typeof req.body.saved === 'boolean') researchStore.setVideoMark(videoId, 'saved', Boolean(req.body.saved));
  await writeJsonFile(seenFile, seenStore);
  await writeJsonFile(lastFile, lastResults);
  return res.json({ ok: true, videoId, seen: Boolean(seenStore.seen[videoId]), saved: Boolean(seenStore.saved[videoId]) });
});

app.get('/api/export/:format', (req, res) => {
  const results = selectedResults(req);
  const format = String(req.params.format || '').toLowerCase();
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="viral-research-${stamp}.json"`);
    return res.send(JSON.stringify(results, null, 2));
  }
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="viral-research-${stamp}.csv"`);
    return res.send(toCsv(results));
  }
  if (format === 'planner') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="viral-research-import-${stamp}.txt"`);
    return res.send(toPlannerText(results));
  }
  return res.status(404).json({ error: 'format not supported' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

function startServer(options = {}) {
  researchStore.open?.();
  const host = options.host || HOST;
  const port = Number.isFinite(Number(options.port)) ? Number(options.port) : PORT;

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const address = server.address();
      const actualPort = address && typeof address === 'object' ? address.port : port;
      const url = `http://${host}:${actualPort}`;
      serverState.host = host;
      serverState.port = actualPort;
      serverState.url = url;
      console.log(`Viral Research running at ${url}`);
      setImmediate(async () => {
        await backfillOpportunityData();
        await runOpportunityScout();
      });
      scoutTimer = setInterval(runOpportunityScout, 15 * 60 * 1000);
      scoutTimer.unref?.();
      resolve({
        app,
        server,
        host,
        port: actualPort,
        url,
        close: async () => {
          const runners = [];
          for (const job of jobs.values()) {
            if (!job._runnerPromise) continue;
            job.shutdownRequested = true;
            job.cancelRequested = true;
            job.pauseRequested = false;
            job.status = 'paused';
            jobUpdate(job, job.progress || 0, 'Saving research before shutdown');
            runners.push(job._runnerPromise);
          }
          if (runners.length) await Promise.allSettled(runners);
          if (backfillPromise) await backfillPromise;
          if (scoutTimer) clearInterval(scoutTimer);
          if (scoutPromise) await scoutPromise;
          sentinelEngine.stop?.();
          await new Promise(closeResolve => server.close(closeResolve));
          researchStore.close();
        }
      });
    });

    server.on('error', reject);
  });
}

if (require.main === module) {
  startServer().catch(err => {
    console.error(safeErrorMessage(err));
    process.exit(1);
  });
}

module.exports = {
  app,
  startServer,
  setBrowserResearchAdapter,
  executeHttpGraphTasks: tasks => Promise.all((tasks || []).map(task => executeHttpGraphTask(task))),
  setActiveResearchUserControl,
  setDesktopSettingsAdapter,
  classifyFacelessChannel,
  settingsProfile,
  allResearchJobs,
  activeResearchJobs,
  hasActiveResearchJobs,
  pauseActiveResearch,
  resumeActiveResearch,
  cancelActiveResearch,
  __test: {
    sanitizeResearchBody,
    presetMatchState,
    researchFunnel
  },
  paths: {
    root: ROOT,
    storage: STORAGE_DIR,
    data: DATA_DIR,
    public: PUBLIC_DIR
  }
};
