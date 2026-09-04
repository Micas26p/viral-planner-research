'use strict';

const assert = require('node:assert/strict');
const { __test } = require('../server');

const { sanitizeResearchBody, presetMatchState, researchFunnel } = __test;
const recent = new Date(Date.now() - 6 * 86400000).toISOString();
const old = new Date(Date.now() - 20 * 86400000).toISOString();
const added = new Date(Date.now() - 3 * 86400000).toISOString();

const cases = [
  ['small', { viewCount: 180000, subscriberCount: 8200 }, 'eligible'],
  ['small', { viewCount: 180000, subscriberCount: 12000 }, 'rejected'],
  ['medium', { viewCount: 1400000, subscriberCount: 22000 }, 'eligible'],
  ['medium', { viewCount: 900000, subscriberCount: 22000 }, 'rejected'],
  ['above1m', { viewCount: 1000000 }, 'eligible'],
  ['outlier', { outlierScore: 20 }, 'eligible'],
  ['few', { viewCount: 1200000, channelVideoCount: 8 }, 'eligible'],
  ['few', { viewCount: 1200000, channelVideoCount: 14 }, 'rejected'],
  ['added', { firstSeenAt: added }, 'eligible'],
  ['recent', { publishedAt: recent }, 'eligible'],
  ['recent', { publishedAt: old }, 'rejected'],
  ['long', { durationSeconds: 480 }, 'eligible'],
  ['long', { durationSeconds: 479 }, 'rejected'],
  ['formula63k', { viewCount: 80000, subscriberCount: 45000, durationSeconds: 720 }, 'eligible'],
  ['formula63k', { viewCount: 80000, subscriberCount: 180000, durationSeconds: 720 }, 'rejected'],
  ['formula63k', { viewCount: 80000, subscriberCount: 45000, durationSeconds: 300 }, 'rejected']
];

for (const [preset, result, expected] of cases) {
  assert.equal(presetMatchState(result, preset).status, expected, `${preset} should be ${expected}`);
}

assert.equal(presetMatchState({ viewCount: 200000 }, 'small').status, 'pending');
assert.equal(presetMatchState({}, 'outlier').status, 'pending');

const sanitized = sanitizeResearchBody({
  mode: 'browser',
  keywords: ['faceless documentary'],
  filters: { presetId: 'medium' }
});
assert.equal(sanitized.filters.presetId, 'medium');
assert.equal(sanitizeResearchBody({ filters: { presetId: 'invalid' } }).filters.presetId, 'all');

const funnel = researchFunnel([
  { videoId: 'one', channelId: 'a', viewCount: 1500000, subscriberCount: 20000 },
  { videoId: 'two', channelId: 'b', viewCount: 200000, subscriberCount: null }
], [
  { channelId: 'a', facelessStatus: 'strict', autoPotential: true, dataCoverage: 0.9 },
  { channelId: 'b', facelessStatus: 'review', autoPotential: false, dataCoverage: 0.4 }
], { presetId: 'medium' });
assert.equal(funnel.mappedChannels, 2);
assert.equal(funnel.presetEligible, 1);
assert.equal(funnel.pendingEnrichment, 0);
assert.equal(funnel.presetRejected, 1);
assert.equal(funnel.facelessEligible, 1);

console.log(JSON.stringify({ ok: true, presets: cases.length, funnel }));
