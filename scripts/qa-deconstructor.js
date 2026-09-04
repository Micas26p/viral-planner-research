'use strict';

const assert = require('node:assert');
const {
  deconstructVideoStructure,
  parseTimedTextXml,
  HOOK_ARCHETYPES
} = require('../lib/video-deconstructor');

console.log('Testing Deep Video Deconstructor...');

// 1. Test parseTimedTextXml
const sampleXml = `
<transcript>
  <text start="0.5" dur="3.2">¿Por qué nadie habla sobre este misterio?</text>
  <text start="3.7" dur="4.1">En 1985, un documento secreto fue destruido.</text>
  <text start="8.0" dur="5.0">Todo lo que sabías sobre la historia militar está a punto de cambiar.</text>
  <text start="16.0" dur="8.0">Para entender lo que realmente ocurrió, debemos analizar las pruebas desclasificadas.</text>
  <text start="50.0" dur="10.0">El primer informe oficial reveló detalles escalofriantes.</text>
</transcript>
`;

const segments = parseTimedTextXml(sampleXml);
assert.strictEqual(segments.length, 5, 'Should parse 5 transcript segments');
assert.strictEqual(segments[0].text, '¿Por qué nadie habla sobre este misterio?');
assert.strictEqual(segments[0].start, 0.5);

// 1b. Test parseTimedTextXml with missing dur and varied attributes
const flexibleXml = `
<transcript>
  <text start="0.0">Texto inicial sem duracao explicita</text>
  <text id="cue2" start="5.5" dur="2.5">Texto intermediario com duracao</text>
</transcript>
`;
const flexibleSegments = parseTimedTextXml(flexibleXml);
assert.strictEqual(flexibleSegments.length, 2, 'Should parse segments even when dur is missing');
assert.strictEqual(flexibleSegments[0].duration, 3, 'Default duration should be assigned');
assert.strictEqual(flexibleSegments[1].duration, 2.5, 'Explicit duration should be parsed');

// 2. Test Hook Classification & Deconstruction
const videoData = {
  videoId: 'test_123',
  title: 'El Gran Secreto Militar Que Nadie Te Contó',
  channelTitle: 'El Campamento Secreto',
  durationSeconds: 720,
  viewCount: 150000,
  subscriberCount: 2000
};

const analysis = deconstructVideoStructure(videoData, segments);

assert.strictEqual(analysis.videoId, 'test_123');
assert.strictEqual(analysis.hasRealTranscript, true);
assert.ok(analysis.hook.score >= 70, 'Hook score should be >= 70');
assert.ok(analysis.hook.wpm > 100, 'Hook WPM should be calculated');
assert.ok(analysis.hook.archetype.id, 'Hook archetype should be detected');
assert.strictEqual(analysis.outlierMultiplier, '75.0', 'Outlier multiplier should be 150000 / 2000 = 75.0');

// 3. Test Blueprint generation
assert.ok(analysis.blueprint.titleVariations.length >= 3, 'Should have title variations');
assert.ok(analysis.blueprint.scriptOutline.length >= 4, 'Should have 4 script phases');
assert.ok(analysis.blueprint.aiScriptPrompt.includes('El Gran Secreto Militar'), 'AI prompt should reference title');
assert.ok(analysis.blueprint.aiThumbPrompt.toLowerCase().includes('photorealistic'), 'AI thumb prompt should be generated');

console.log('Deep Video Deconstructor QA Passed Successfully!');
