'use strict';

const assert = require('node:assert/strict');
const {
  detectLanguage,
  adaptTitleToPortuguese,
  evaluateArbitrage
} = require('../lib/arbitrage-engine');

async function runQa() {
  console.log('🧪 Iniciando QA do Arbitrage Engine (Inovação 4)...');

  // Teste 1: Detecção de Idiomas
  assert.equal(detectLanguage('The Secret History of the Lost Roman Legion'), 'en');
  assert.equal(detectLanguage('El Misterio del Campamento Abandonado en el Bosque'), 'es');
  assert.equal(detectLanguage('A Verdade Oculta Sobre a Ilha da Queimada Grande no Brasil'), 'pt');
  assert.equal(detectLanguage('Тайны секретных бункеров холодной войны'), 'ru');
  console.log('  ✓ Detecção de múltiplos idiomas (EN, ES, PT, RU) validada');

  // Teste 2: Adaptação de Título para Português (PT-BR)
  const adapted = adaptTitleToPortuguese('The Secret History of The Antarctica Anomaly', 'en');
  assert.equal(Array.isArray(adapted), true);
  assert.equal(adapted.length >= 2, true);
  assert.equal(adapted.some(t => t.includes('Antarctica Anomaly') || t.includes('O Segredo')), true);
  console.log('  ✓ Adaptação semântica com gatilhos de clique para PT-BR validada');

  // Teste 3: Avaliação de Arbitragem Internacional (Vídeo Estrangeiro com Alta Tração)
  const viralForeign = {
    title: 'What Really Happened Inside the Cold War Vault',
    channelTitle: 'Mystery Archive Documents',
    viewCount: 340000,
    subscriberCount: 20000,
    outlierMultiplier: 17.0
  };

  const evalForeign = evaluateArbitrage(viralForeign);
  assert.equal(evalForeign.isForeign, true);
  assert.equal(evalForeign.inexploredBrazil, true);
  assert.equal(evalForeign.arbitrageScore >= 70, true);
  assert.equal(evalForeign.importStrategy !== null, true);
  assert.equal(evalForeign.importStrategy.competitionLevelInBrazil.includes('Oceano Azul'), true);
  console.log('  ✓ Qualificação como "Mina de Ouro BR" (Oceano Azul) validada com sucesso');

  // Teste 4: Vídeo já em Português (Não deve qualificar para arbitragem de importação)
  const localVideo = {
    title: 'Como Fiz 100 Mil Reais com Canais Dark no Brasil',
    channelTitle: 'Mestre do YouTube BR',
    viewCount: 80000,
    subscriberCount: 10000,
    outlierMultiplier: 8.0
  };

  const evalLocal = evaluateArbitrage(localVideo);
  assert.equal(evalLocal.isForeign, false);
  assert.equal(evalLocal.inexploredBrazil, false);
  console.log('  ✓ Vídeo nacional ignorado para arbitragem corretamente');

  console.log('🎉 Todos os testes de Arbitragem Internacional passaram com 100% de sucesso!');
}

runQa().catch(err => {
  console.error('❌ Falha no QA de Arbitragem:', err);
  process.exit(1);
});
