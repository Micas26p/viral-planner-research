'use strict';

const CLASSIFIER_VERSION = 3;
const MIN_BASELINE_VIDEOS = 3;
const MIN_CONSISTENCY_VIDEOS = 5;

const POSITIVE_PATTERNS = [
  /\bdocumentar(?:y|ies|io|ios)\b/i,
  /\bexplained\b|\bexplicad[oa]s?\b/i,
  /\bhistory\b|\bhistoria\b/i,
  /\bstory\b|\bstories\b|\brelatos?\b/i,
  /\bfacts?\b|\bcuriosit(?:y|ies)\b|\bcuriosidades?\b/i,
  /\banimat(?:ed|ion)\b/i,
  /\barchive\b|\barquivo\b/i,
  /\banalysis\b|\banalise\b/i,
  /\btimeline\b|\bchronicle\b/i,
  /\bscience\b|\btechnology\b|\bengineering\b|\bspace\b|\bmilitary\b|\bgeopolit/i,
  /\bwhy\b|\bhow\b|\bcomo\b|\bpor que\b/i,
  /\btop\s*\d+\b|\branked\b|\branking\b/i
];

const NEGATIVE_PATTERNS = [
  /\bpodcast\b/i,
  /\binterview\b|\bentrevista\b/i,
  /\bvlog\b/i,
  /\bday in my life\b|\bmeu dia\b/i,
  /\breaction\b|\breacts?\b|\breagindo\b/i,
  /\btalk show\b|\blive stream\b|\blivestream\b/i,
  /\bwelcome (back )?to my channel\b/i,
  /\bi am\b|\bi'm\b|\bmy journey\b|\bminha jornada\b/i,
  /\bhosted by\b|\bapresentado por\b/i,
  /\bq&a\b|\bask me anything\b/i
];

const PRODUCTION_CREDIT_PATTERNS = [
  /\b(epidemic\s*sound|artlist|audiio|elevenlabs|murf\.ai|descript|envato|storyblocks)\b/i,
  /\b(licensed\s*(?:music|footage|audio)|stock\s*(?:footage|video|media))\b/i
];

function finiteMetric(value, options = {}) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (!options.allowZero && number <= 0) return null;
  return number;
}

function stableChannelKey(item = {}) {
  const id = String(item.channelId || '').trim();
  if (id && !/^unknown channel$/i.test(id)) return id;
  const path = String(item.channelPath || '').split(/[?#]/)[0].replace(/^\/+/, '').trim();
  if (path) return `path:${path.toLowerCase()}`;
  const handle = String(item.handle || '').replace(/^@/, '').trim();
  if (handle) return `handle:${handle.toLowerCase()}`;
  const title = String(item.channelTitle || '').trim();
  if (title && !/^unknown channel$/i.test(title)) return `name:${title.toLowerCase()}`;
  return '';
}

function applyChannelBaselines(items = [], options = {}) {
  const groups = new Map();
  const maxVideos = Math.max(5, Number(options.maxVideos) || 20);
  for (const source of items) {
    const key = stableChannelKey(source);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    const duration = finiteMetric(source.durationSeconds);
    const views = finiteMetric(source.viewCount);
    if (views && duration && duration >= 240 && !source.isLive && !/\/shorts\//i.test(source.url || '')) {
      groups.get(key).push(source);
    }
  }

  return items.map(source => {
    const key = stableChannelKey(source);
    const peers = (groups.get(key) || [])
      .filter(item => item.videoId !== source.videoId)
      .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
      .slice(0, maxVideos);
    const peerViews = peers.map(item => finiteMetric(item.viewCount)).filter(value => value !== null);
    const suppliedMedian = finiteMetric(source.baselineMedianViews);
    const suppliedAverage = finiteMetric(source.baselineAvgViews);
    const calculatedMedian = peerViews.length >= MIN_BASELINE_VIDEOS ? median(peerViews) : null;
    const calculatedAverage = peerViews.length >= MIN_BASELINE_VIDEOS ? average(peerViews) : null;
    const baselineMedianViews = suppliedMedian || calculatedMedian;
    const baselineAvgViews = suppliedAverage || calculatedAverage;
    const viewCount = finiteMetric(source.viewCount);
    const outlierScore = baselineMedianViews && viewCount ? viewCount / baselineMedianViews : null;
    const baselineSampleSize = suppliedMedian
      ? Math.max(Number(source.baselineSampleSize) || MIN_BASELINE_VIDEOS, MIN_BASELINE_VIDEOS)
      : peerViews.length;
    return {
      ...source,
      baselineMedianViews,
      baselineAvgViews,
      baselineSampleSize,
      baselineConfidence: baselineMedianViews
        ? clamp(0.55 + Math.min(baselineSampleSize, 12) / 12 * 0.4, 0, 0.95)
        : 0,
      outlierScore,
      outlierEstimated: !outlierScore ? estimateVelocitySignal(viewCount, source.publishedAt) : null
    };
  });
}

function computeDataCoverage(input = {}) {
  const signals = [
    [stableChannelKey(input), 0.18],
    [finiteMetric(input.viewCount), 0.12],
    [input.publishedAt, 0.10],
    [finiteMetric(input.durationSeconds), 0.06],
    [finiteMetric(input.subscriberCount), 0.12],
    [finiteMetric(input.channelVideoCount), 0.06],
    [finiteMetric(input.baselineMedianViews), 0.16],
    [finiteMetric(input.channelAgeDays, { allowZero: true }), 0.12],
    [input.avatarUrl || input.bannerUrl, 0.04],
    [input.description, 0.04]
  ];
  return clamp(signals.reduce((sum, [value, weight]) => sum + (value !== null && value !== undefined && value !== '' ? weight : 0), 0), 0, 1);
}

function classifyFacelessChannel(channel = {}, videos = [], feedback = '') {
  const items = Array.isArray(videos) ? videos.slice(0, 20) : [];
  const titles = items.map(item => item.title).filter(Boolean);
  const corpus = [channel.channelTitle, channel.description, ...titles].filter(Boolean).join(' \n ');
  const positiveHits = patternHits(corpus, POSITIVE_PATTERNS);
  const negativeHits = patternHits(corpus, NEGATIVE_PATTERNS);
  const positiveTitleRatio = ratioMatching(titles, POSITIVE_PATTERNS);
  const negativeTitleRatio = ratioMatching(titles, NEGATIVE_PATTERNS);
  const firstPersonRatio = titles.length
    ? titles.filter(title => /\b(i|my|me|mine|eu|meu|minha|comigo)\b/i.test(title)).length / titles.length
    : 0;
  const personalName = looksLikePersonalChannelName(channel.channelTitle);
  const visual = channel.visualSignals || {};
  const productionHits = patternHits(corpus, PRODUCTION_CREDIT_PATTERNS);
  const visualAvailable = Boolean(visual.available);
  const faceHeavyRatio = finiteMetric(visual.faceHeavyRatio, { allowZero: true }) || 0;
  const recurringPresenterRatio = finiteMetric(visual.recurringPresenterRatio, { allowZero: true });
  const evidence = [];
  const negativeSignals = [];

  if (positiveHits || positiveTitleRatio >= 0.25) evidence.push('Consistent documentary, explanatory or narrative format');
  if (positiveTitleRatio >= 0.5) evidence.push('Most recent titles follow a repeatable faceless format');
  if (productionHits) evidence.push('Production credits indicate licensed assets or automated production');
  if (negativeTitleRatio === 0 && firstPersonRatio < 0.2) evidence.push('No recurring host language detected');
  if (visualAvailable && faceHeavyRatio < 0.35) evidence.push('Recent thumbnails are not dominated by presenter-style faces');
  if (recurringPresenterRatio !== null && recurringPresenterRatio < 0.25) evidence.push('No recurring presenter signature detected');
  if (negativeHits || negativeTitleRatio > 0) negativeSignals.push('Podcast, interview, vlog or presenter-led language detected');
  if (personalName) negativeSignals.push('Channel identity resembles a personal creator brand');
  if (firstPersonRatio >= 0.3) negativeSignals.push('Frequent first-person titles suggest a creator-led format');
  if (visualAvailable && faceHeavyRatio >= 0.7) negativeSignals.push('Most sampled thumbnails contain prominent faces');
  if (recurringPresenterRatio !== null && recurringPresenterRatio >= 0.6) negativeSignals.push('A recurring presenter signature was detected');

  let score = 48
    + Math.min(positiveHits, 5) * 5
    + positiveTitleRatio * 28
    + Math.min(productionHits, 2) * 8
    - Math.min(negativeHits, 4) * 9
    - negativeTitleRatio * 42
    - firstPersonRatio * 18
    - (personalName ? 18 : 0);
  if (visualAvailable && faceHeavyRatio < 0.25) score += 5;
  if (visualAvailable && faceHeavyRatio >= 0.7 && (personalName || negativeTitleRatio > 0.1)) score -= 12;
  if (recurringPresenterRatio !== null) score += recurringPresenterRatio < 0.25 ? 8 : recurringPresenterRatio >= 0.6 ? -24 : 0;
  score = clamp(score, 0, 100);

  let confidence = clamp(
    0.32
      + Math.min(items.length, 12) / 12 * 0.36
      + (channel.description ? 0.1 : 0)
      + (visualAvailable ? 0.1 : 0)
      + (recurringPresenterRatio !== null ? 0.08 : 0)
      + (channel.channelPublishedAt ? 0.04 : 0),
    0.32,
    0.97
  );

  let status = score >= 70 && confidence >= 0.6
    ? 'strict'
    : score < 45 || negativeTitleRatio >= 0.5
      ? 'rejected'
      : 'review';
  if (feedback === 'faceless') {
    status = 'strict';
    score = Math.max(score, 90);
    confidence = Math.max(confidence, 0.98);
    evidence.unshift('Confirmed faceless by the local user');
  } else if (feedback === 'not_faceless') {
    status = 'rejected';
    score = Math.min(score, 10);
    confidence = Math.max(confidence, 0.98);
    negativeSignals.unshift('Rejected as faceless by the local user');
  } else if (feedback === 'ignore') {
    status = 'ignored';
    confidence = 1;
  }

  return { score, confidence, status, evidence, negativeSignals, classifierVersion: CLASSIFIER_VERSION };
}

function buildFormatFingerprint(channel = {}, videos = []) {
  const items = Array.isArray(videos) ? videos.slice(0, 20) : [];
  const titles = items.map(item => String(item.title || '').toLowerCase());
  const durations = items.map(item => finiteMetric(item.durationSeconds)).filter(value => value !== null);
  const patterns = [
    ['documentary', /\bdocumentar|\bfull (?:story|history)|\bentire history/i],
    ['explainer', /\bwhy\b|\bhow\b|\bexplained\b|\bwhat (?:is|happened)/i],
    ['ranked-list', /\btop\s*\d+|\b\d+\s+(?:facts|ways|reasons|things)|\branked/i],
    ['biography', /\b(?:rise|fall|life|story|truth) of\b|\bfamily\b|\bdynasty\b/i],
    ['news-analysis', /\bbreaking\b|\bupdate\b|\bnews\b|\banalysis\b/i],
    ['archive-story', /\barchive\b|\bfootage\b|\bforgotten\b|\bhidden\b/i],
    ['sleep-longform', /\bsleep\b|\brelax\b|\bfall asleep\b/i]
  ];
  const ranked = patterns
    .map(([id, pattern]) => ({ id, hits: titles.filter(title => pattern.test(title)).length }))
    .sort((a, b) => b.hits - a.hits);
  const primary = ranked[0]?.hits ? ranked[0].id : 'narrative-longform';
  const medianDuration = durations.length ? median(durations) : null;
  return {
    id: primary,
    label: primary.replace(/-/g, ' '),
    confidence: items.length ? clamp((ranked[0]?.hits || 1) / Math.min(items.length, 8), 0.25, 0.95) : 0.25,
    medianDuration,
    titleSamples: items.slice(0, 3).map(item => item.title).filter(Boolean)
  };
}

const NICHE_RPM_TABLE = {
  finance: { min: 8.0, max: 18.0, base: 12.0, label: 'Finance & Wealth' },
  tech: { min: 6.0, max: 14.0, base: 9.5, label: 'Tech & AI' },
  engineering: { min: 5.0, max: 11.0, base: 7.5, label: 'Engineering & Megaprojects' },
  history: { min: 4.0, max: 9.5, base: 6.5, label: 'History & Civilizations' },
  science: { min: 4.5, max: 10.0, base: 7.0, label: 'Science & Space' },
  crime: { min: 4.5, max: 8.5, base: 6.0, label: 'True Crime & Mystery' },
  military: { min: 4.0, max: 8.0, base: 5.5, label: 'Military & Warfare' },
  geopolitics: { min: 3.5, max: 7.5, base: 5.0, label: 'Geopolitics & News' },
  aviation: { min: 4.0, max: 8.5, base: 6.0, label: 'Aviation & Disasters' },
  mythology: { min: 3.0, max: 6.5, base: 4.5, label: 'Mythology & Folklore' },
  wildlife: { min: 2.5, max: 5.5, base: 3.8, label: 'Nature & Wildlife' },
  philosophy: { min: 3.5, max: 7.0, base: 5.0, label: 'Philosophy & Stoicism' },
  general: { min: 3.0, max: 6.5, base: 4.5, label: 'General Faceless' }
};

function detectNicheCategory(text = '') {
  const t = String(text || '').toLowerCase();
  if (/\b(financ|money|billionaire|wealth|invest|stock|crypto|rich|economy|business|dollar)\b/i.test(t)) return 'finance';
  if (/\b(tech|artificial intelligence|\bai\b|cyber|software|robot|algorithm)\b/i.test(t)) return 'tech';
  if (/\b(engineer|megaproject|construction|bridge|tunnel|skyscraper|dam|machine)\b/i.test(t)) return 'engineering';
  if (/\b(histor|empire|rome|ancient|egypt|warrior|medieval|century|archaeolog)\b/i.test(t)) return 'history';
  if (/\b(space|universe|planet|galaxy|astronom|physics|quantum|telescope|cosmos)\b/i.test(t)) return 'science';
  if (/\b(crime|murder|killer|heist|mystery|unsolved|conspiracy|detective|investigation|prison)\b/i.test(t)) return 'crime';
  if (/\b(militar|warfare|tank|submarine|army|navy|missile|battle|combat|weapon|soldier)\b/i.test(t)) return 'military';
  if (/\b(geopolitic|border|country|conflict|sanction|propaganda|nation|territor)\b/i.test(t)) return 'geopolitics';
  if (/\b(aviat|plane|crash|flight|helicopter|pilot|boeing|airport|disaster)\b/i.test(t)) return 'aviation';
  if (/\b(myth|gods|folklore|legend|creature|monster|zeus|norse|greek)\b/i.test(t)) return 'mythology';
  if (/\b(animal|wildlife|nature|ocean|shark|jungle|predator|species|forest)\b/i.test(t)) return 'wildlife';
  if (/\b(stoic|philosoph|psycholog|mindset|habit|marcus aurelius|behavior|wisdom)\b/i.test(t)) return 'philosophy';
  return 'general';
}

function estimateNicheRpm(nicheOrText = '', durationSeconds = 600) {
  const category = NICHE_RPM_TABLE[nicheOrText] ? nicheOrText : detectNicheCategory(nicheOrText);
  const info = NICHE_RPM_TABLE[category] || NICHE_RPM_TABLE.general;
  const duration = Number(durationSeconds) || 600;
  const durationMultiplier = duration >= 1200 ? 1.65 : duration >= 480 ? 1.35 : 0.85;
  const min = Math.round(info.min * durationMultiplier * 10) / 10;
  const max = Math.round(info.max * durationMultiplier * 10) / 10;
  const base = Math.round(info.base * durationMultiplier * 10) / 10;
  return {
    category,
    label: info.label,
    minRpm: min,
    maxRpm: max,
    baseRpm: base,
    rangeFormatted: `$${min.toFixed(2)} - $${max.toFixed(2)}`
  };
}

function computeMonetizationStatus(channel = {}) {
  const subs = finiteMetric(channel.subscriberCount, { allowZero: true }) || 0;
  const topViews = finiteMetric(channel.topVideo?.viewCount, { allowZero: true }) || 0;
  const videosCount = finiteMetric(channel.channelVideoCount, { allowZero: true }) || 0;
  const hasMonetizationMarker = Boolean(channel.isMonetized || channel.hasJoinButton || channel.monetized);
  return hasMonetizationMarker || (subs >= 1000 && (topViews >= 50000 || videosCount >= 5));
}

function computeQualityTier(channel = {}, videos = []) {
  const subs = Math.max(100, finiteMetric(channel.subscriberCount, { allowZero: true }) || 0);
  const topViews = finiteMetric(channel.topVideo?.viewCount, { allowZero: true }) || 0;
  const ratio = topViews / subs;
  const count = (Array.isArray(videos) && videos.length) || finiteMetric(channel.channelVideoCount, { allowZero: true }) || 0;
  const outlier = finiteMetric(channel.topVideo?.outlierScore ?? channel.medianOutlier) || 0;
  if (ratio >= 3.0 && count >= 3) return 'high';
  if (ratio >= 1.2 || outlier >= 5.0) return 'medium';
  return 'low';
}

function computeMonthlyRevenueEstimate(channel = {}, videos = [], nicheRpm = estimateNicheRpm()) {
  const top = channel.topVideo || {};
  const daily = finiteMetric(top.viewsPerDay ?? channel.avgVelocity) || ((finiteMetric(top.viewCount) || 10000) / Math.max(1, (finiteMetric(channel.channelAgeDays) || 30)));
  const monthlyViews = Math.max(1000, Math.round(daily * 30));
  const minEarnings = Math.round((monthlyViews / 1000) * nicheRpm.minRpm);
  const maxEarnings = Math.round((monthlyViews / 1000) * nicheRpm.maxRpm);
  return {
    monthlyViews,
    minEarnings,
    maxEarnings,
    formatted: `$${formatCompactInternal(minEarnings)} - $${formatCompactInternal(maxEarnings)}/mo`
  };
}

function computeAiBreakout(channel = {}, topVideo = {}) {
  const age = finiteMetric(channel.channelAgeDays);
  const outlier = finiteMetric(topVideo.outlierScore ?? channel.medianOutlier) || 0;
  const velocity = finiteMetric(topVideo.viewsPerDay ?? channel.avgVelocity) || 0;
  const faceless = finiteMetric(channel.facelessScore) || 0;
  return (age === null || age <= 120) && (outlier >= 8.0 || velocity >= 3500) && faceless >= 60;
}

function formatCompactInternal(value) {
  const n = Number(value) || 0;
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(n));
}

function buildOpportunityDossier(channel = {}, videos = [], fingerprint = buildFormatFingerprint(channel, videos)) {
  const items = Array.isArray(videos) ? videos.slice(0, 20) : [];
  const avgDuration = average(items.map(item => finiteMetric(item.durationSeconds)).filter(value => value !== null));
  const cadenceDays = publicationCadence(items);
  const productionDifficulty = avgDuration >= 2400 ? 'high' : avgDuration >= 900 ? 'medium' : 'low';
  const archiveRisk = /\barchive|movie|film|celebrity|sports|news\b/i.test(
    `${channel.description || ''} ${items.map(item => item.title || '').join(' ')}`
  );
  const replicability = clamp(
    72
      - (productionDifficulty === 'high' ? 18 : productionDifficulty === 'medium' ? 8 : 0)
      - (archiveRisk ? 14 : 0)
      + (fingerprint.confidence || 0) * 18,
    10,
    95
  );
  const combinedText = `${channel.channelTitle || ''} ${channel.description || ''} ${items.map(item => item.title || '').join(' ')}`;
  const nicheRpm = estimateNicheRpm(combinedText, avgDuration || 600);
  const monetized = computeMonetizationStatus(channel);
  const qualityTier = computeQualityTier(channel, items);
  const revenueEstimate = computeMonthlyRevenueEstimate(channel, items, nicheRpm);
  const aiBreakout = computeAiBreakout(channel, channel.topVideo || items[0] || {});

  return {
    fingerprint,
    productionDifficulty,
    cadenceDays,
    copyrightRisk: archiveRisk ? 'elevated' : 'normal',
    replicability,
    nicheCategory: nicheRpm.category,
    nicheLabel: nicheRpm.label,
    estimatedRpm: nicheRpm,
    monetized,
    qualityTier,
    revenueEstimate,
    aiBreakout,
    summary: `${fingerprint.label} format with ${productionDifficulty} production effort`,
    nextActions: [
      'Validate three recent long-form uploads',
      'Compare the trigger against the recent channel median',
      archiveRisk ? 'Review footage and copyright dependencies' : 'Map repeatable title and thumbnail patterns'
    ]
  };
}

function estimateVelocitySignal(viewCount, publishedAt) {
  const views = finiteMetric(viewCount);
  if (!views || !publishedAt) return null;
  const ageDays = Math.max(1, (Date.now() - new Date(publishedAt).getTime()) / 86400000);
  if (!Number.isFinite(ageDays)) return null;
  return clamp(Math.round(Math.max(1, views / 30000, (views / ageDays) / 3000) * 10) / 10, 1, 999);
}

function publicationCadence(items) {
  const dates = items
    .map(item => new Date(item.publishedAt || 0).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => b - a);
  if (dates.length < 2) return null;
  const gaps = [];
  for (let index = 1; index < dates.length; index += 1) gaps.push((dates[index - 1] - dates[index]) / 86400000);
  return Math.round(median(gaps) * 10) / 10;
}

function patternHits(text, patterns) {
  return patterns.reduce((count, pattern) => count + (pattern.test(String(text || '')) ? 1 : 0), 0);
}

function ratioMatching(values, patterns) {
  if (!values.length) return 0;
  let matches = 0;
  for (const value of values) {
    if (patterns.some(pattern => pattern.test(String(value || '')))) matches += 1;
  }
  return matches / values.length;
}

function looksLikePersonalChannelName(value) {
  const name = String(value || '').trim();
  if (!name || /\b(tv|media|stories|history|daily|world|insights|explained|documentary|studio|archive|files)\b/i.test(name)) return false;
  const words = name.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 3 && words.every(word => /^[A-Z][A-Za-z.'-]{1,20}$/.test(word));
}

function median(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (!clean.length) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function average(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function evaluateBabyChannel(channel = {}, videos = []) {
  const items = (Array.isArray(videos) && videos.length ? videos : (channel.videos || [])).filter(v => v?.publishedAt);
  if (!items.length) {
    const fallbackDays = finiteMetric(channel.firstUploadAgeDays ?? channel.channelAgeDays);
    return {
      firstUploadAt: channel.firstUploadAt || channel.firstObservedUploadAt || null,
      firstUploadAgeDays: fallbackDays,
      isBabyChannel: fallbackDays !== null && fallbackDays <= 75 && (finiteMetric(channel.channelVideoCount) || 0) <= 18
    };
  }
  let oldest = items[0];
  for (const item of items) {
    if (new Date(item.publishedAt).getTime() < new Date(oldest.publishedAt).getTime()) {
      oldest = item;
    }
  }
  const now = Date.now();
  const firstTime = new Date(oldest.publishedAt).getTime();
  const firstUploadAgeDays = Math.max(0, Math.round((now - firstTime) / 86400000));
  const videoCount = finiteMetric(channel.channelVideoCount) || items.length;
  const isBabyChannel = firstUploadAgeDays <= 75 && videoCount <= 18;
  return {
    firstUploadAt: oldest.publishedAt,
    firstUploadAgeDays,
    isBabyChannel
  };
}

function computeOutlierVelocityRatio(video = {}, channel = {}) {
  const views = finiteMetric(video.viewCount, { allowZero: true }) || 0;
  const rawTime = new Date(video.publishedAt || Date.now()).getTime();
  const publishedTime = Number.isFinite(rawTime) ? rawTime : Date.now();
  const ageHours = Math.max(1, Math.round((Date.now() - publishedTime) / 3600000));
  const viewsPerHour = Math.max(0, Math.round(views / ageHours));
  const subs = Math.max(100, finiteMetric(channel.subscriberCount ?? video.subscriberCount, { allowZero: true }) || 0);
  const baseline = finiteMetric(video.baselineMedianViews ?? channel.baselineMedianViews) || subs;
  const outlierMultiplier = Math.round((views / Math.max(100, subs)) * 10) / 10;
  const outlierScore = Math.round((views / Math.max(100, baseline)) * 10) / 10;
  const isSuperOutlier = outlierMultiplier >= 5.0 || (views >= 40000 && subs <= 15000) || (outlierScore >= 8.0);

  return {
    views,
    subs,
    ageHours,
    viewsPerHour,
    outlierMultiplier,
    outlierScore,
    isSuperOutlier
  };
}

function filterVideosByCriteria(videos = [], filters = {}) {
  if (!Array.isArray(videos)) return [];
  const minViews = finiteMetric(filters.minViews, { allowZero: true });
  const maxViews = finiteMetric(filters.maxViews, { allowZero: true });
  const maxSubs = finiteMetric(filters.maxSubscribers, { allowZero: true });
  const minOutlierRatio = finiteMetric(filters.minOutlierRatio, { allowZero: true });
  const minVph = finiteMetric(filters.minVph, { allowZero: true });
  const publishedDays = finiteMetric(filters.publishedWithinDays, { allowZero: true });
  const onlyGems = Boolean(filters.onlyGems);

  return videos.filter(video => {
    const views = finiteMetric(video.viewCount, { allowZero: true }) || 0;
    const subs = finiteMetric(video.subscriberCount, { allowZero: true }) || 0;
    const ovr = computeOutlierVelocityRatio(video, { subscriberCount: subs });

    if (minViews !== null && views < minViews) return false;
    if (maxViews !== null && views > maxViews) return false;
    if (maxSubs !== null && subs > 0 && subs > maxSubs) return false;
    if (minOutlierRatio !== null && (ovr.outlierMultiplier < minOutlierRatio && (video.outlierScore || 0) < minOutlierRatio)) return false;
    if (minVph !== null && ovr.viewsPerHour < minVph) return false;
    if (onlyGems && !ovr.isSuperOutlier && (video.outlierScore || 0) < 5.0) return false;

    if (publishedDays !== null && publishedDays > 0 && video.publishedAt) {
      const ageDays = (Date.now() - new Date(video.publishedAt).getTime()) / 86400000;
      if (ageDays > publishedDays) return false;
    }

    return true;
  });
}

function generateViralAngles(video = {}) {
  const title = String(video.title || 'Untitled Outlier').trim();
  const views = Number(video.viewCount) || 0;
  const channel = String(video.channelTitle || 'Creator').trim();
  const category = detectNicheCategory(title);

  const cleanTitle = title.replace(/[|•–—].*$/, '').trim();

  const angles = [
    {
      type: 'curiosity',
      badge: '🔍 Curiosidade & Mistério',
      title: `The Untold Truth About ${cleanTitle}`,
      alternativeTitle: `Why Nobody Is Allowed to Talk About ${cleanTitle}`,
      hookFormula: 'Quebra de padrão inicial + Revelação proibida ou fato oculto nos primeiros 5 segundos.'
    },
    {
      type: 'high_stakes',
      badge: '⚠️ Alto Risco & Urgência',
      title: `The Catastrophic Reality Behind ${cleanTitle}`,
      alternativeTitle: `How One Fatal Mistake Changed ${cleanTitle} Forever`,
      hookFormula: 'Exposição imediata de um momento crítico de perigo ou consequência monumental.'
    },
    {
      type: 'epic_documentary',
      badge: '🎬 Documentário Épico',
      title: `The Full Story of ${cleanTitle} (Explained)`,
      alternativeTitle: `Inside the Mastermind That Built ${cleanTitle}`,
      hookFormula: 'Introdução cinemática conectando uma linha do tempo grandiosa a um clímax emocionante.'
    }
  ];

  const scriptRetentionHook = {
    first3Seconds: `"[Pergunta intrigante ou afirmação chocante que contraria o senso comum sobre ${cleanTitle}]. Mas a verdadeira razão que quase ninguém sabe é muito mais sombria..."`,
    next10Seconds: `"Nos próximos minutos, você vai descobrir como [pequeno detalhe crucial] mudou tudo — e porque [autoridade ou grupo] tentou esconder isso por anos."`,
    retentionTrigger: 'Apresentar 3 pistas visuais rápidas antes dos 15 segundos para prender a taxa de retenção inicial (AVD) acima de 70%.'
  };

  return {
    sourceTitle: title,
    views,
    channel,
    category,
    angles,
    scriptRetentionHook
  };
}

module.exports = {
  CLASSIFIER_VERSION,
  MIN_BASELINE_VIDEOS,
  MIN_CONSISTENCY_VIDEOS,
  NICHE_RPM_TABLE,
  detectNicheCategory,
  estimateNicheRpm,
  computeMonetizationStatus,
  computeQualityTier,
  computeMonthlyRevenueEstimate,
  computeAiBreakout,
  evaluateBabyChannel,
  finiteMetric,
  stableChannelKey,
  applyChannelBaselines,
  computeDataCoverage,
  classifyFacelessChannel,
  buildFormatFingerprint,
  buildOpportunityDossier,
  estimateVelocitySignal,
  computeOutlierVelocityRatio,
  filterVideosByCriteria,
  generateViralAngles
};

