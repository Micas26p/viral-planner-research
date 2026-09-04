'use strict';

const assert = require('node:assert/strict');
const {
  COLOR_PALETTES,
  COMPOSITION_ARCHETYPES,
  analyzeThumbnail
} = require('../lib/thumb-analyzer');

async function runQa() {
  console.log('🧪 Iniciando QA do Thumb-Matrix AI Scanner (Inovação 5)...');

  // Teste 1: Paletas e Arquétipos Carregados
  assert.equal(COLOR_PALETTES.length >= 4, true);
  assert.equal(COMPOSITION_ARCHETYPES.length >= 3, true);
  console.log('  ✓ Paletas de cores e arquétipos de composição carregados');

  // Teste 2: Análise de Thumbnail de Mistério Militar / Perigo (Paleta Vermelha / Arquétipo Arquivo)
  const dangerThumb = analyzeThumbnail('https://i.ytimg.com/vi/abc123/hqdefault.jpg', {
    title: 'O Documento Militar Secreto Que Ninguém Deveria Ler',
    viewCount: 450000,
    outlierMultiplier: 8.5
  });

  assert.equal(dangerThumb.palette.primary, '#ef476f', 'Deveria escolher paleta de tensão/alerta');
  assert.equal(dangerThumb.archetype.id, 'investigative_pov', 'Deveria escolher arquétipo documental/arquivo');
  assert.equal(dangerThumb.visualCtrScore >= 80, true, 'Score deve refletir alto potencial');
  assert.equal(dangerThumb.recreationPrompts.midjourney.includes('--ar 16:9'), true);
  assert.equal(dangerThumb.recreationPrompts.flux.length > 50, true);
  console.log('  ✓ Análise de mistério militar e geração de prompts validada');

  // Teste 3: Análise de Tecnologia / Anomalia Espacial (Paleta Ciano)
  const techThumb = analyzeThumbnail('https://i.ytimg.com/vi/xyz789/hqdefault.jpg', {
    title: 'A Nova Anomalia Espacial Que a Ciência Não Consegue Explicar',
    viewCount: 180000,
    outlierMultiplier: 4.2
  });

  assert.equal(techThumb.palette.primary, '#06d6a0', 'Deveria escolher paleta ciano/anomalia');
  assert.equal(techThumb.designRules.length >= 4, true);
  console.log('  ✓ Análise cromática de tecnologia e regras de design validadas');

  console.log('🎉 Todos os testes do Thumb-Matrix AI Scanner passaram com 100% de sucesso!');
}

runQa().catch(err => {
  console.error('❌ Falha no QA do Thumb Scanner:', err);
  process.exit(1);
});
