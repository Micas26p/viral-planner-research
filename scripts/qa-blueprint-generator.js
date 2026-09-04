'use strict';

const assert = require('node:assert/strict');
const {
  SCRIPT_STYLES,
  generateViralBlueprint,
  formatBlueprintAsMarkdown,
  generateProductionMasterdeckMarkdown
} = require('../lib/blueprint-generator');

async function runQa() {
  console.log('🧪 Iniciando QA do Viral Blueprint Generator...');

  const sampleVideo = {
    videoId: 'test_vid_123',
    title: 'O Mistério da Cidade Subterrânea de Derinkuyu [Documentário]',
    channelTitle: 'Arquivo Desconhecido',
    viewCount: 450000,
    subscriberCount: 22000,
    outlierMultiplier: '20.4'
  };

  // Teste 1: Estilos Disponíveis
  assert.equal(Object.keys(SCRIPT_STYLES).length, 3, 'Deveria conter 3 estilos de roteiro');
  assert.equal(Boolean(SCRIPT_STYLES.documentary), true, 'Estilo documentary deve existir');
  assert.equal(Boolean(SCRIPT_STYLES.storytelling), true, 'Estilo storytelling deve existir');
  assert.equal(Boolean(SCRIPT_STYLES.explanatory), true, 'Estilo explanatory deve existir');
  console.log('  ✓ Estilos de roteiro validados (Documentary, Storytelling, Explanatory)');

  // Teste 2: Geração de Blueprint - Documentary
  const bpDoc = generateViralBlueprint(sampleVideo, { style: 'documentary' });
  assert.equal(Boolean(bpDoc.id), true, 'ID do blueprint deve ser gerado');
  assert.equal(bpDoc.titles.length, 5, 'Deveria gerar 5 títulos para teste de CTR');
  assert.equal(bpDoc.thumbMatrix.length, 3, 'Deveria gerar 3 conceitos de thumbnail A/B');
  assert.equal(bpDoc.scriptBlocks.length >= 4, true, 'Deveria conter pelo menos 4 blocos de roteiro');
  assert.match(bpDoc.titles[0].text, /Derinkuyu/i, 'Título deve incorporar o tema');
  assert.match(bpDoc.thumbMatrix[0].promptMidjourney, /Derinkuyu/i, 'Prompt Midjourney deve citar o assunto');
  assert.match(bpDoc.thumbMatrix[0].promptFlux, /Derinkuyu/i, 'Prompt Flux deve citar o assunto');
  assert.equal(bpDoc.scriptBlocks[0].narration.length > 50, true, 'Narração do gancho deve ser substancial');
  console.log('  ✓ Geração do estilo Faceless Documentary validada');

  // Teste 3: Geração de Blueprint - Storytelling Retenção
  const bpStory = generateViralBlueprint(sampleVideo, { style: 'storytelling' });
  assert.equal(bpStory.style.id, 'storytelling');
  assert.match(bpStory.scriptBlocks[0].phase, /Gancho/i, 'Primeiro bloco deve ser o gancho');
  console.log('  ✓ Geração do estilo Storytelling de Alta Retenção validada');

  // Teste 4: Geração de Blueprint - Explanatory
  const bpExp = generateViralBlueprint(sampleVideo, { style: 'explanatory' });
  assert.equal(bpExp.style.id, 'explanatory');
  assert.equal(bpExp.totalEstimatedMinutes, 8, 'Explanatory deve ter duração estimada de ~8m');
  console.log('  ✓ Geração do estilo Explanatory / Revelação Direta validada');

  // Teste 5: Formatação em Markdown
  const markdown = formatBlueprintAsMarkdown(bpDoc);
  assert.equal(typeof markdown, 'string');
  assert.match(markdown, /# ⚡ DOSSIÊ DE PRODUÇÃO VIRAL/);
  assert.match(markdown, /TÍTULOS DE ALTA TAXA DE CLIQUE/);
  assert.match(markdown, /MATRIZ DE TESTE A\/B DE THUMBNAILS/);
  assert.match(markdown, /ROTEIRO COMPLETO FORMATADO/);
  assert.match(markdown, /TAGS E METADADOS RECOMENDADOS/);
  console.log('  ✓ Exportação de Dossiê Markdown formatado com sucesso');

  // Teste 6: Compilação do Masterdeck Operacional em Lote
  const masterdeck = generateProductionMasterdeckMarkdown([sampleVideo]);
  assert.equal(typeof masterdeck, 'string');
  assert.match(masterdeck, /# 🚀 DOSSIÊ MASTER DE PRODUÇÃO/);
  assert.match(masterdeck, /## 1\. VISÃO ESTRATÉGICA DO NICHO/);
  assert.match(masterdeck, /## 2\. MATRIZ DE VÍDEOS DE REFERÊNCIA/);
  assert.match(masterdeck, /Derinkuyu/);
  assert.match(masterdeck, /## 3\. MODELAGEM DE GANCHOS DE RETENÇÃO/);
  assert.match(masterdeck, /## 4\. PROMPTS PARA GERAÇÃO DE THUMBNAILS/);
  assert.match(masterdeck, /## 5\. CALENDÁRIO EDITORIAL SUGERIDO/);
  console.log('  ✓ Compilação de Masterdeck em Lote validada com sucesso');

  console.log('🎉 Todos os 6 testes do Viral Blueprint & Masterdeck Generator passaram com 100% de sucesso!');
}

runQa().catch(err => {
  console.error('❌ Falha no QA do Blueprint Generator:', err);
  process.exit(1);
});
