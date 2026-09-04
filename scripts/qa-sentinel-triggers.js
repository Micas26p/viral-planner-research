'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const { evaluateSentinelCandidate, sendGenericWebhookAlert, SentinelEngine } = require('../lib/sentinel-service');
const { generateViralBlueprint } = require('../lib/blueprint-generator');
const { ResearchStore } = require('../lib/research-store');

async function runTests() {
  console.log('🧪 Iniciando QA dos Novos Gatilhos de Automação (Sentinel 2.0)...');

  // Teste 1: Gatilho de Arbitragem Internacional (Mina de Ouro BR)
  console.log('  1. Testando Gatilho de Arbitragem Internacional...');
  const foreignCandidate = {
    videoId: 'arb_foreign_01',
    title: 'The Secret Disappearance of Flight 19',
    channelTitle: 'Aviation Unsolved',
    viewCount: 65000,
    subscriberCount: 2000,
    publishedAt: new Date(Date.now() - 30 * 86400000).toISOString(),
    channelAgeDays: 120
  };

  const arbResult = evaluateSentinelCandidate(foreignCandidate, {
    allowArbitrage: true,
    minMultiplier: 5.0
  });

  assert.equal(arbResult.qualifies, true, 'Deveria qualificar candidato de arbitragem');
  assert.equal(arbResult.isArbitrage, true, 'Deveria marcar isArbitrage');
  assert.equal(arbResult.type, 'arbitrage', 'Tipo deveria ser arbitrage');
  assert.ok(arbResult.arbitrageTitles && arbResult.arbitrageTitles.length > 0, 'Deveria conter títulos adaptados para PT-BR');
  console.log('  ✓ Gatilho de Arbitragem Internacional validado com sucesso!');

  // Teste 2: Gatilho de Breakout Velocity (Pico de VPH)
  console.log('  2. Testando Gatilho de Breakout Velocity (VPH Spike)...');
  const breakoutCandidate = {
    videoId: 'vph_spike_01',
    title: 'O Mistério da Cidade Submersa no Brasil',
    channelTitle: 'Histórias do Brasil',
    viewCount: 28800, // 28800 views em 48h = 600 vph
    subscriberCount: 5000,
    publishedAt: new Date(Date.now() - 48 * 3600000).toISOString(),
    channelAgeDays: 90
  };

  const vphResult = evaluateSentinelCandidate(breakoutCandidate, {
    allowArbitrage: true,
    allowVphSpike: true,
    minVphSpike: 300
  });

  assert.equal(vphResult.qualifies, true, 'Deveria qualificar breakout velocity');
  assert.equal(vphResult.isVphBreakout, true, 'Deveria marcar isVphBreakout');
  assert.equal(vphResult.type, 'vph_spike', 'Tipo deveria ser vph_spike');
  assert.ok(vphResult.vph >= 300, 'VPH calculado deve ser >= 300');
  console.log('  ✓ Gatilho de Breakout Velocity validado (' + vphResult.vph + ' views/hora)!');

  // Teste 3: Gatilho de Auto-Geração de Blueprints
  console.log('  3. Testando Auto-Geração e Persistência de Blueprints no SQLite...');
  const testDbDir = path.join(__dirname, '..', '.qa-storage-triggers');
  fs.mkdirSync(testDbDir, { recursive: true });
  const store = new ResearchStore(path.join(testDbDir, 'test-triggers.db'));

  const blueprintCandidate = {
    videoId: 'bp_super_outlier',
    title: 'A História Oculta de Chernobyl',
    channelTitle: 'Dossiês Secretos',
    viewCount: 150000,
    subscriberCount: 10000
  };

  const bp = generateViralBlueprint(blueprintCandidate, { style: 'documentary' });
  assert.ok(bp.id, 'Blueprint deve ter ID gerado');
  assert.ok(bp.scriptBlocks && bp.scriptBlocks.length > 0, 'Blueprint deve ter blocos de roteiro estruturados');
  assert.ok(bp.thumbMatrix && bp.thumbMatrix.length > 0, 'Blueprint deve ter matriz de thumbnails');

  store.saveSnapshot('blueprint', bp.id, bp);
  const loadedSnapshots = store.listSnapshots('blueprint', 10);
  const found = loadedSnapshots.find(s => s.id === bp.id);
  assert.ok(found, 'Blueprint deve ser recuperado do banco');
  assert.equal(found.sourceVideo.title, blueprintCandidate.title, 'Título do blueprint deve coincidir');
  store.close();
  fs.rmSync(testDbDir, { recursive: true, force: true });
  console.log('  ✓ Auto-geração e persistência de blueprints validadas!');

  // Teste 4: Gatilho de Webhook Genérico (Mock Server)
  console.log('  4. Testando Envio de Webhook Customizado...');
  let receivedWebhookPayload = null;

  const mockServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        receivedWebhookPayload = JSON.parse(body);
      } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: true }));
    });
  });

  await new Promise(resolve => mockServer.listen(0, '127.0.0.1', resolve));
  const port = mockServer.address().port;
  const webhookUrl = 'http://127.0.0.1:' + port + '/webhook';

  const webhookAlert = {
    videoId: 'wh_test_123',
    title: 'Super Explosão Viral',
    channelTitle: 'Canal Revelação',
    outlierMultiplier: '14.2',
    viewText: '180.000',
    isArbitrage: true,
    isBaby: true,
    reason: 'Vídeo furando o algoritmo'
  };

  const hookRes = await sendGenericWebhookAlert(webhookUrl, webhookAlert);
  assert.equal(hookRes.ok, true, 'sendGenericWebhookAlert deve retornar ok: true');
  assert.ok(receivedWebhookPayload, 'Servidor deve ter recebido o payload');
  assert.equal(receivedWebhookPayload.event, 'viral_sentinel_alert');
  assert.equal(receivedWebhookPayload.alert.videoId, 'wh_test_123');
  assert.equal(receivedWebhookPayload.alert.isArbitrage, true);

  await new Promise(resolve => mockServer.close(resolve));
  console.log('  ✓ Envio de Webhook customizado recebido e validado com sucesso!');

  console.log('\n🎉 Todos os Novos Gatilhos de Automação passaram com 100% de sucesso!\n');
}

runTests().catch(err => {
  console.error('❌ Falha nos testes de automação:', err);
  process.exit(1);
});
