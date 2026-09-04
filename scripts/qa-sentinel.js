'use strict';

const assert = require('node:assert/strict');
const {
  escapeTelegramMarkdown,
  evaluateSentinelCandidate,
  SentinelEngine
} = require('../lib/sentinel-service');

async function runQa() {
  console.log('🧪 Iniciando QA do Sentinel 24/7 Service...');

  // Teste 1: escapeTelegramMarkdown
  const rawText = 'Alerta! Canal (Top #1) - 100% [PROIBIDO] ~teste~';
  const escaped = escapeTelegramMarkdown(rawText);
  assert.equal(escaped.includes('\\!'), true, 'Deveria escapar exclamação');
  assert.equal(escaped.includes('\\('), true, 'Deveria escapar parênteses');
  assert.equal(escaped.includes('\\[') , true, 'Deveria escapar colchetes');
  console.log('  ✓ escapeTelegramMarkdown validado');

  // Teste 2: evaluateSentinelCandidate - Vídeo Comum (Não qualifica)
  const normalVideo = {
    viewCount: 5000,
    subscriberCount: 20000,
    channelAgeDays: 300
  };
  const evalNormal = evaluateSentinelCandidate(normalVideo, { minMultiplier: 3.0 });
  assert.equal(evalNormal.qualifies, false, 'Vídeo comum não deve qualificar');
  console.log('  ✓ Avaliação de vídeo comum rejeitada corretamente');

  // Teste 3: evaluateSentinelCandidate - Super Outlier (Qualifica por multiplicador)
  const outlierVideo = {
    viewCount: 150000,
    subscriberCount: 10000,
    channelAgeDays: 180
  };
  const evalOutlier = evaluateSentinelCandidate(outlierVideo, { minMultiplier: 3.0 });
  assert.equal(evalOutlier.qualifies, true, 'Super outlier deve qualificar');
  assert.equal(evalOutlier.multiplier, '15.0', 'Multiplicador deve ser 15.0');
  console.log('  ✓ Detecção de Super Outlier (15x) validada');

  // Teste 4: evaluateSentinelCandidate - Canal Bebê (Qualifica por idade e tração)
  const babyVideo = {
    viewCount: 25000,
    subscriberCount: 1200,
    channelAgeDays: 35,
    isBabyChannel: true
  };
  const evalBaby = evaluateSentinelCandidate(babyVideo, { allowBabyChannels: true, minMultiplier: 5.0 });
  assert.equal(evalBaby.qualifies, true, 'Canal Bebê deve qualificar');
  assert.equal(evalBaby.isBaby, true);
  console.log('  ✓ Detecção de Canal Bebê (< 60 dias) validada');

  // Teste 5: SentinelEngine Ciclo e Deduplicação
  let desktopNotified = null;
  const engine = new SentinelEngine({
    intervalMinutes: 15,
    notifier: (alert) => { desktopNotified = alert; }
  });

  assert.equal(engine.running, false);
  engine.start();
  assert.equal(engine.running, true);

  // Dispatch de alerta mock
  const sampleAlert = {
    videoId: 'mock_vid_999',
    title: 'A Revelação da Antártida',
    channelTitle: 'Arquivo Oculto',
    outlierMultiplier: '8.5',
    viewText: '85.000'
  };

  const dispatchResult = await engine.dispatchAlert({
    desktopNotifications: true
  }, sampleAlert);

  assert.equal(dispatchResult.ok, true, 'Alerta desktop deve ser emitido');
  assert.equal(desktopNotified.videoId, 'mock_vid_999');
  assert.equal(engine.alertHistory.length, 1);
  console.log('  ✓ Disparo e gravação de histórico validados');

  // Teste de deduplicação (segundo envio do mesmo videoId deve ser ignorado)
  const duplicateResult = await engine.dispatchAlert({
    desktopNotifications: true
  }, sampleAlert);

  assert.equal(duplicateResult.skipped, true, 'Alerta duplicado deve ser ignorado');
  assert.equal(engine.alertHistory.length, 1, 'Histórico não deve duplicar');
  console.log('  ✓ Mecanismo anti-duplicação de alertas validado');

  engine.stop();
  assert.equal(engine.running, false);
  console.log('  ✓ Parada do Sentinel validada');

  console.log('🎉 Todos os testes do Sentinel 24/7 passaram com 100% de sucesso!');
}

runQa().catch(err => {
  console.error('❌ Falha no QA do Sentinel:', err);
  process.exit(1);
});
