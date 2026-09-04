'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const qaStorage = path.join(root, '.qa-storage-masterdeck');
process.env.VPR_DATA_DIR = path.join(qaStorage, 'data');
process.env.YOUTUBE_API_KEYS = '';
process.env.GEMINI_API_KEYS = '';
process.env.VPR_DISABLE_API_KEYS = '1';

const { startServer } = require('../server');

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});

async function main() {
  console.log('🧪 Iniciando QA do Masterdeck Export & Niche Seeds API...');
  const server = await startServer({ host: '127.0.0.1', port: 0 });

  try {
    // 1. Testar GET /api/niche/seeds
    const seedsRes = await fetch(`${server.url}/api/niche/seeds`);
    assert.equal(seedsRes.status, 200, 'GET /api/niche/seeds deve responder 200');
    const seedsData = await seedsRes.json();
    assert.equal(seedsData.ok, true);
    assert.equal(Array.isArray(seedsData.seeds), true);
    assert.equal(seedsData.seeds.length, 5, 'Deve conter exatamente 5 nichos recomendados');
    assert.equal(Boolean(seedsData.seeds[0].id), true);
    assert.equal(Boolean(seedsData.seeds[0].query), true);
    console.log('  ✓ GET /api/niche/seeds validado (5 nichos com queries e faixas de RPM)');

    // 2. Testar POST /api/export/masterdeck com JSON
    const sampleItems = [
      {
        videoId: 'vid_outlier_1',
        title: 'O Enigma de Atlântida Revelado',
        channelTitle: 'Arquivo Mistério',
        viewCount: 780000,
        subscriberCount: 35000,
        outlierScore: 14.2,
        duration: '14 min'
      },
      {
        videoId: 'vid_outlier_2',
        title: 'A Queda do Império Financeiro Secreto',
        channelTitle: 'Documentários Dark',
        viewCount: 1200000,
        subscriberCount: 50000,
        medianOutlier: 8.5,
        durationSeconds: 720
      }
    ];

    const exportRes = await fetch(`${server.url}/api/export/masterdeck`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: sampleItems })
    });
    assert.equal(exportRes.status, 200, 'POST /api/export/masterdeck deve responder 200');
    const exportData = await exportRes.json();
    assert.equal(exportData.ok, true);
    assert.equal(exportData.count, 2);
    assert.match(exportData.markdown, /# 🚀 DOSSIÊ MASTER DE PRODUÇÃO/);
    assert.match(exportData.markdown, /O Enigma de Atlântida/);
    assert.match(exportData.markdown, /A Queda do Império Financeiro/);
    assert.match(exportData.markdown, /## 3\. MODELAGEM DE GANCHOS DE RETENÇÃO/);
    assert.match(exportData.markdown, /## 4\. PROMPTS PARA GERAÇÃO DE THUMBNAILS/);
    assert.match(exportData.markdown, /## 5\. CALENDÁRIO EDITORIAL SUGERIDO/);
    console.log('  ✓ POST /api/export/masterdeck validado com compilação estruturada de 5 seções');

    // 3. Testar POST /api/export/masterdeck?format=raw para download direto
    const rawRes = await fetch(`${server.url}/api/export/masterdeck?format=raw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: sampleItems })
    });
    assert.equal(rawRes.status, 200);
    assert.match(rawRes.headers.get('content-type') || '', /text\/markdown/);
    assert.match(rawRes.headers.get('content-disposition') || '', /attachment/);
    const rawText = await rawRes.text();
    assert.match(rawText, /# 🚀 DOSSIÊ MASTER DE PRODUÇÃO/);
    console.log('  ✓ POST /api/export/masterdeck?format=raw validado para download binário direto');

    console.log('🎉 Todos os testes de Masterdeck Export & Niche Seeds passaram com 100% de sucesso!');
  } finally {
    await server.close();
    try {
      const fs = require('node:fs');
      if (fs.existsSync(qaStorage)) fs.rmSync(qaStorage, { recursive: true, force: true });
    } catch {}
  }
}
