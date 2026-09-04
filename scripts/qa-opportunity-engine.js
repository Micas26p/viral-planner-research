'use strict';

const assert = require('node:assert/strict');
const {
  MIN_BASELINE_VIDEOS,
  finiteMetric,
  stableChannelKey,
  applyChannelBaselines,
  computeDataCoverage,
  classifyFacelessChannel,
  buildFormatFingerprint,
  buildOpportunityDossier
} = require('../lib/opportunity-engine');

function video(id, views, title = 'Why Ancient Empires Collapsed') {
  return {
    videoId: id,
    channelId: 'UC_TEST',
    channelTitle: 'History Files',
    title,
    viewCount: views,
    durationSeconds: 900,
    publishedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    url: `https://www.youtube.com/watch?v=${id}`
  };
}

assert.equal(finiteMetric(null), null);
assert.equal(finiteMetric(0), null);
assert.equal(finiteMetric(0, { allowZero: true }), 0);
assert.equal(stableChannelKey({ channelTitle: 'Unknown channel' }), '');
assert.equal(stableChannelKey({ channelPath: '/@HistoryFiles/videos' }), 'path:@historyfiles/videos');

const insufficient = applyChannelBaselines([
  video('trigger', 1000000),
  video('peer-1', 10000),
  video('peer-2', 12000)
]);
assert.equal(insufficient[0].outlierScore, null, 'two peer videos must not create a confirmed outlier');
assert.equal(insufficient[0].baselineSampleSize, MIN_BASELINE_VIDEOS - 1);

const sufficient = applyChannelBaselines([
  video('trigger', 1000000),
  video('peer-1', 10000),
  video('peer-2', 12000),
  video('peer-3', 14000)
]);
assert.equal(sufficient[0].baselineMedianViews, 12000);
assert.ok(sufficient[0].outlierScore > 83 && sufficient[0].outlierScore < 84);

const facelessVideos = [
  video('f1', 120000, 'Why Rome Could Not Survive'),
  video('f2', 90000, 'The Entire History of Ancient Trade'),
  video('f3', 70000, 'How Empires Controlled the Sea'),
  video('f4', 65000, 'Lost Archive Explained'),
  video('f5', 60000, '10 Facts About Forgotten Kingdoms'),
  video('f6', 55000, 'Why Ancient Cities Disappeared')
];
const faceless = classifyFacelessChannel({
  channelId: 'UC_FACELESS',
  channelTitle: 'History Files',
  description: 'Animated documentary stories and historical analysis.'
}, facelessVideos);
assert.equal(faceless.status, 'strict');
assert.ok(faceless.score >= 70);

const presenter = classifyFacelessChannel({
  channelId: 'UC_HOST',
  channelTitle: 'John Smith',
  description: 'Welcome back to my channel and weekly podcast.'
}, [
  video('p1', 10000, 'My Day in My Life Vlog'),
  video('p2', 11000, 'I React to Your Questions'),
  video('p3', 9000, 'Podcast Interview with My Friend'),
  video('p4', 8000, 'My Journey This Week'),
  video('p5', 7000, 'Q&A: Ask Me Anything')
]);
assert.equal(presenter.status, 'rejected');

assert.equal(classifyFacelessChannel({}, [], 'faceless').status, 'strict');
assert.equal(classifyFacelessChannel({}, [], 'not_faceless').status, 'rejected');
assert.equal(classifyFacelessChannel({}, [], 'ignore').status, 'ignored');

const coverage = computeDataCoverage({
  channelId: 'UC_COMPLETE',
  viewCount: 100000,
  publishedAt: new Date().toISOString(),
  durationSeconds: 900,
  subscriberCount: 5000,
  channelVideoCount: 12,
  baselineMedianViews: 10000,
  channelAgeDays: 40,
  avatarUrl: 'https://example.test/avatar.jpg',
  description: 'Documentary channel'
});
assert.ok(coverage >= 0.95);

const fingerprint = buildFormatFingerprint({}, facelessVideos);
assert.ok(['documentary', 'explainer'].includes(fingerprint.id));
const dossier = buildOpportunityDossier({}, facelessVideos, fingerprint);
assert.ok(dossier.replicability >= 10 && dossier.replicability <= 95);
assert.equal(dossier.nextActions.length, 3);
assert.ok(dossier.revenueEstimate.minEarnings > 0);
assert.ok(dossier.revenueEstimate.maxEarnings >= dossier.revenueEstimate.minEarnings);
assert.match(dossier.revenueEstimate.formatted, /^\$/);

const { evaluateBabyChannel } = require('../lib/opportunity-engine');
const babyVideos = [
  { videoId: 'b1', publishedAt: new Date(Date.now() - 15 * 86400000).toISOString() },
  { videoId: 'b2', publishedAt: new Date(Date.now() - 30 * 86400000).toISOString() }
];
const babyCheck = evaluateBabyChannel({ channelVideoCount: 6 }, babyVideos);
assert.equal(babyCheck.isBabyChannel, true);
assert.ok(babyCheck.firstUploadAgeDays >= 29 && babyCheck.firstUploadAgeDays <= 31);

const oldVideos = [
  { videoId: 'o1', publishedAt: new Date(Date.now() - 300 * 86400000).toISOString() }
];
const oldCheck = evaluateBabyChannel({ channelVideoCount: 80 }, oldVideos);
assert.equal(oldCheck.isBabyChannel, false);

console.log('Opportunity engine QA passed.');
