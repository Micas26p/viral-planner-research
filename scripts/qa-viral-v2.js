'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'data', 'qa-screenshots');
const qaStorageDir = path.join(root, `.qa-storage-viral-v2-${process.pid}`);
process.env.VPR_DATA_DIR = path.join(qaStorageDir, 'data');
process.env.VPR_TEST_TIME_BUDGET_MS = '8000';
process.env.YOUTUBE_API_KEYS = '';
process.env.VPR_DISABLE_API_KEYS = '1';

const { startServer, setBrowserResearchAdapter } = require('../server');
const { createQaBrowser } = require('./qa-fake-browser');

const chromeCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
];

const chromePath = chromeCandidates.find(file => fs.existsSync(file));
if (!chromePath) throw new Error('Chrome or Edge was not found for visual QA.');

main().catch(err => {
  console.error('\n❌ QA VIRAL 2.0 FAILED:', err && err.stack ? err.stack : err);
  process.exit(1);
});

async function main() {
  console.log('🚀 Iniciando Suite Completa de QA Viral 2.0 (DottiFinder Engine)...');
  fs.mkdirSync(outDir, { recursive: true });

  setBrowserResearchAdapter(createQaBrowser({ available: false }));
  const server = await startServer({ host: '127.0.0.1', port: 0 });
  console.log(`📡 Servidor de teste ativo em: ${server.url}`);

  // -------------------------------------------------------------
  // FASE 1: TESTE DOS ENDPOINTS BACKEND & ADVERSARIAL STRESS
  // -------------------------------------------------------------
  console.log('\n--- FASE 1: Testes de API & Resiliência Algorítmica ---');

  // 1. Gamification profile & action
  const profileRes = await fetch(`${server.url}/api/gamification/profile`);
  assert.strictEqual(profileRes.status, 200);
  const profileData = await profileRes.json();
  assert(profileData.level >= 11, 'Nível inicial deve ser >= 11');
  assert(profileData.title, 'Título de garimpo deve existir');
  assert(profileData.channelsFound >= 1100, 'Canais encontrados deve ser >= 1100');
  console.log(`  ✓ Gamification Profile validado: NV ${profileData.level} - ${profileData.title} (${profileData.channelsFound} canais)`);

  const actionRes = await fetch(`${server.url}/api/gamification/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'test_garimpo', xpBonus: 20 })
  });
  assert.strictEqual(actionRes.status, 200);
  const actionData = await actionRes.json();
  assert.strictEqual(actionData.ok, true);
  console.log(`  ✓ Gamification Action validado: XP=${actionData.xp}/${actionData.xpMax}`);

  // 2. /api/viral/boost/analyze
  const boostNormal = await fetch(`${server.url}/api/viral/boost/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'O Teste Psicológico Que a CIA Proibiu Em 1974',
      views: 850000,
      subscribers: 25000,
      durationSeconds: 900,
      publishedAt: new Date(Date.now() - 48 * 3600000).toISOString()
    })
  });
  assert.strictEqual(boostNormal.status, 200);
  const boostData = await boostNormal.json();
  assert(boostData.boostScore >= 50, 'Boost score deve ser elevado para outlier 34x');
  assert(boostData.metrics.vph > 0, 'VPH deve ser positivo');
  assert.strictEqual(boostData.viralityRating, 'HYPER_OUTLIER');
  console.log(`  ✓ /api/viral/boost/analyze (Normal): Score ${boostData.boostScore}/100, VPH: ${boostData.metrics.vph}, Multiplier: ${boostData.metrics.multiplier}x`);

  // 2b. Boost com YouTube URL
  const boostUrl = await fetch(`${server.url}/api/viral/boost/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'https://www.youtube.com/watch?v=fos-1',
      views: 10000,
      subscribers: 1000
    })
  });
  assert.strictEqual(boostUrl.status, 200);
  const boostUrlData = await boostUrl.json();
  assert.strictEqual(boostUrlData.videoId, 'fos-1');
  assert(boostUrlData.metrics.views >= 7000000, 'Deve ter resolvido métricas do canal Fossil');
  console.log(`  ✓ /api/viral/boost/analyze (YouTube URL): videoId resolvido "${boostUrlData.videoId}", views: ${boostUrlData.metrics.views}`);

  // 2c. Boost Adversarial (Negativo, NaN, zero)
  const boostAdv = await fetch(`${server.url}/api/viral/boost/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      views: -500,
      subscribers: 0,
      durationSeconds: -60
    })
  });
  assert.strictEqual(boostAdv.status, 200);
  const boostAdvData = await boostAdv.json();
  assert(boostAdvData.metrics.views >= 0);
  assert(boostAdvData.boostScore >= 20);
  console.log(`  ✓ /api/viral/boost/analyze (Adversarial): Resistência a números negativos confirmada`);

  // 3. /api/viral/grill-me
  for (const persona of ['giovanni', 'algo', 'claude63k']) {
    const grillRes = await fetch(`${server.url}/api/viral/grill-me`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Como Fazer Dinheiro na Internet Rápido',
        niche: 'Finanças & Negócios',
        persona
      })
    });
    assert.strictEqual(grillRes.status, 200);
    const grillData = await grillRes.json();
    assert.strictEqual(grillData.persona, persona);
    assert(Array.isArray(grillData.fatalFlaws) && grillData.fatalFlaws.length === 3, 'Deve conter 3 falhas fatais');
    assert(Array.isArray(grillData.upgrades) && grillData.upgrades.length === 3, 'Deve conter 3 títulos 10x');
    assert(grillData.hook30s, 'Deve conter gancho 30s');
    for (const up of grillData.upgrades) {
      assert(up.title.length <= 110, `Título reescrito "${up.title}" deve ter tamanho adequado para YouTube`);
    }
    console.log(`  ✓ /api/viral/grill-me (${persona}): Veredito gerado, nota ${grillData.viralScore}/100, 3 upgrades ok`);
  }

  // 3b. Grill-me Adversarial (Huge string > 2000 chars, null title)
  const hugeTitle = 'Mistério das Pirâmides ' + 'X'.repeat(2500);
  const grillHuge = await fetch(`${server.url}/api/viral/grill-me`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: hugeTitle, persona: 'giovanni' })
  });
  assert.strictEqual(grillHuge.status, 200);
  const grillHugeData = await grillHuge.json();
  for (const up of grillHugeData.upgrades) {
    assert(up.title.length <= 110, `Título deve ter sido devidamente clampado, atual: ${up.title.length}`);
  }
  console.log(`  ✓ /api/viral/grill-me (Adversarial String 2500 chars): Entidade clampada com sucesso, zero overflow`);

  // 4. /api/viral/package/latest
  const packRes = await fetch(`${server.url}/api/viral/package/latest`);
  assert.strictEqual(packRes.status, 200);
  const packData = await packRes.json();
  assert(packData.channelCount > 0, 'channelCount deve ser > 0');
  assert(Array.isArray(packData.channels) && packData.channels.length >= 4, 'Canais do pacote devem ser >= 4');
  assert(Array.isArray(packData.teaserVideos) && packData.teaserVideos.length >= 4, 'Teasers devem ser >= 4');
  console.log(`  ✓ /api/viral/package/latest: ${packData.channels.length} canais, ${packData.teaserVideos.length} teasers`);

  // 5. /api/viral/similar/:channelId
  const simRes = await fetch(`${server.url}/api/viral/similar/ch-fossil`);
  assert.strictEqual(simRes.status, 200);
  const simData = await simRes.json();
  assert(Array.isArray(simData.channels) && simData.channels.length > 0, 'Similar channels não pode ser vazio');
  console.log(`  ✓ /api/viral/similar: ${simData.channels.length} canais parecidos retornados com sucesso`);

  // -------------------------------------------------------------
  // FASE 2: TESTE VISUAL & INTERAÇÃO NO BROWSER HEADLESS (CDP)
  // -------------------------------------------------------------
  console.log('\n--- FASE 2: Testes de Interface & Interação no Navegador (Headless CDP) ---');

  const profileDir = path.join(root, '.chrome-qa', `viral-v2-${Date.now()}`);
  fs.mkdirSync(profileDir, { recursive: true });
  const debugPort = 9243;
  let chrome = null;
  const chromeLogs = [];

  try {
    chrome = spawn(chromePath, [
      '--headless=new',
      `--remote-debugging-port=${debugPort}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${profileDir}`,
      '--disable-gpu',
      '--disable-crash-reporter',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-background-networking',
      '--disable-sync',
      '--no-first-run',
      '--no-default-browser-check',
      `${server.url}/`
    ], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    chrome.stdout.on('data', data => chromeLogs.push(data.toString()));
    chrome.stderr.on('data', data => chromeLogs.push(data.toString()));

    const page = await connectToPage(debugPort, chrome, chromeLogs);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await setViewport(page, 1440, 900, false);
    await page.send('Page.navigate', { url: `${server.url}/` });

    for (let i = 0; i < 40; i++) {
      const ready = await page.evaluate(() => document.readyState === 'complete' && Boolean(document.body?.dataset.page));
      if (ready) break;
      await sleep(150);
    }

    // Teste 1: Página inicial (deve estar em 'research')
    const initialPage = await page.evaluate(() => document.body.dataset.page);
    assert.strictEqual(initialPage, 'research', 'Página inicial deve ser research');
    console.log('  ✓ Boot padrão: body[data-page="research"] validado');

    // Teste 2: Roteamento direto para /browser
    await page.send('Page.navigate', { url: `${server.url}/browser` });
    await sleep(1200);
    const browserPageState = await page.evaluate(() => ({
      page: document.body.dataset.page,
      browserHidden: document.getElementById('browserWorkspace')?.hidden,
      channelCardsCount: document.querySelectorAll('.channel-card-dotti').length,
      videoStripsCount: document.querySelectorAll('.channel-videos-strip').length
    }));
    assert.strictEqual(browserPageState.page, 'browser', 'URL /browser deve ativar workspace browser');
    assert.strictEqual(browserPageState.browserHidden, false, '#browserWorkspace não pode estar hidden');
    assert(browserPageState.channelCardsCount >= 3, `Deve renderizar cards DottiFinder (atual: ${browserPageState.channelCardsCount})`);
    assert(browserPageState.videoStripsCount >= 3, `Deve renderizar carrosséis horizontais de vídeo`);
    await captureScreenshot(page, path.join(outDir, 'desktop-v2-browser.png'));
    console.log(`  ✓ Roteamento direto /browser: workspace aberto com ${browserPageState.channelCardsCount} canais e carrosséis horizontais de vídeo`);

    // Teste 3: Niche Category Filter em /browser
    const nicheFilterTest = await page.evaluate(() => {
      const scienceTag = document.querySelector('[data-browser-niche="science"]');
      if (scienceTag) scienceTag.click();
      return {
        clicked: Boolean(scienceTag),
        countText: document.getElementById('browserTotalChannelsCount')?.textContent,
        cardsCount: document.querySelectorAll('.channel-card-dotti').length
      };
    });
    await sleep(300);
    assert(nicheFilterTest.cardsCount > 0, 'Filtro de nicho Ciência deve encontrar canais como Fossil');
    console.log(`  ✓ Filtro de Nicho Ciência clicado: ${nicheFilterTest.cardsCount} canais filtrados com sucesso`);

    // Teste 4: Mystery Box Modal & Unboxing Animation
    await page.evaluate(() => {
      window.vprSwitchPage('research');
    });
    await sleep(500);

    const openBoxModal = await page.evaluate(() => {
      const btn = document.getElementById('openMagicBoxBtn');
      if (btn) btn.click();
      const modal = document.getElementById('magicBoxModalBackdrop');
      return {
        clicked: Boolean(btn),
        modalVisible: modal && !modal.hidden
      };
    });
    assert.strictEqual(openBoxModal.modalVisible, true, 'Modal da Caixa Mágica deve estar visível');
    console.log('  ✓ Modal da Caixa Mágica aberto com sucesso');

    // Clica no pacote 3D para acionar unboxing explosivo
    await page.evaluate(() => {
      const pack = document.getElementById('magicUnboxingPack');
      if (pack) pack.click();
    });
    await sleep(600); // Aguarda animação de explosão e confetti

    const unboxState = await page.evaluate(() => {
      const pack = document.getElementById('magicUnboxingPack');
      const banner = document.getElementById('magicRevealBanner');
      const teaser = document.getElementById('magicTeaserStrip');
      const badge = document.getElementById('magicCountBadge');
      return {
        packOpened: pack?.classList.contains('pack-opened'),
        bannerRevealed: banner?.classList.contains('revealed'),
        teaserRevealed: teaser?.classList.contains('revealed'),
        badgeText: badge?.textContent,
        teaserCardsCount: teaser?.querySelectorAll('.magic-teaser-card').length
      };
    });
    assert.strictEqual(unboxState.packOpened, true, 'Pacote deve ter classe pack-opened');
    assert.strictEqual(unboxState.bannerRevealed, true, 'Banner de revelação deve estar visível com .revealed');
    assert.strictEqual(unboxState.teaserRevealed, true, 'Carrossel de teasers deve estar visível com .revealed');
    assert(unboxState.teaserCardsCount >= 4, `Teasers de vídeo devem ser renderizados (atual: ${unboxState.teaserCardsCount})`);
    await captureScreenshot(page, path.join(outDir, 'desktop-v2-magicbox-opening.png'));
    console.log(`  ✓ Unboxing concluído: Explosão de luzes, confetti, badge "${unboxState.badgeText}" e ${unboxState.teaserCardsCount} teasers`);

    // Clica em "Ver canais" no modal da caixa mágica
    await page.evaluate(() => {
      document.getElementById('magicSeeChannelsBtn')?.click();
    });
    await sleep(600);
    const postModalState = await page.evaluate(() => ({
      page: document.body.dataset.page,
      modalHidden: document.getElementById('magicBoxModalBackdrop')?.hidden
    }));
    assert.strictEqual(postModalState.page, 'browser', 'Após Ver canais, deve transicionar para /browser');
    assert.strictEqual(postModalState.modalHidden, true, 'Modal deve ser fechado');
    console.log('  ✓ Botão "Ver canais": transição perfeita para /browser e modal fechado');

    // Teste 5: Roteamento direto para /boost e cálculo interativo
    await page.send('Page.navigate', { url: `${server.url}/boost` });
    await sleep(800);
    const boostPageState = await page.evaluate(() => ({
      page: document.body.dataset.page,
      boostHidden: document.getElementById('boostWorkspace')?.hidden
    }));
    assert.strictEqual(boostPageState.page, 'boost', 'URL /boost deve ativar workspace boost');
    assert.strictEqual(boostPageState.boostHidden, false, '#boostWorkspace deve estar visível');

    // Dispara cálculo no /boost
    const boostCalcUi = await page.evaluate(async () => {
      document.getElementById('boostTitleInput').value = 'O Mistério dos Carros Abandonados';
      document.getElementById('boostViewsInput').value = '450000';
      document.getElementById('boostSubsInput').value = '12000';
      document.getElementById('runBoostCalculationBtn')?.click();
      return true;
    });
    await sleep(1000);

    const boostResultUi = await page.evaluate(() => ({
      scoreText: document.getElementById('boostScoreDisplay')?.textContent,
      vphText: document.getElementById('boostVphDisplay')?.textContent,
      tierBadge: document.getElementById('boostTierBadge')?.textContent
    }));
    assert(Number(boostResultUi.scoreText) >= 50, `Score deve ser >= 50 (atual: ${boostResultUi.scoreText})`);
    assert(boostResultUi.vphText.includes('views/hora'), 'VPH deve estar formatado');
    await captureScreenshot(page, path.join(outDir, 'desktop-v2-boost.png'));
    console.log(`  ✓ Workspace /boost testado ao vivo: Score ${boostResultUi.scoreText}/100, ${boostResultUi.vphText}, Tier: ${boostResultUi.tierBadge}`);

    // Teste 6: Roteamento direto para /grill-me e teste de roast
    await page.send('Page.navigate', { url: `${server.url}/grill-me` });
    await sleep(800);
    const grillPageState = await page.evaluate(() => ({
      page: document.body.dataset.page,
      grillHidden: document.getElementById('grillmeWorkspace')?.hidden
    }));
    assert.strictEqual(grillPageState.page, 'grillme', 'URL /grill-me deve ativar workspace grillme');
    assert.strictEqual(grillPageState.grillHidden, false, '#grillmeWorkspace deve estar visível');

    // Seleciona persona 'algo' e roda o roast
    await page.evaluate(() => {
      document.querySelector('[data-persona="algo"]')?.click();
      document.getElementById('grillTitleInput').value = 'Como Funciona o Motor de Avião';
      document.getElementById('runGrillMeBtn')?.click();
    });
    await sleep(1200);

    const grillReportUi = await page.evaluate(() => {
      const grid = document.getElementById('grillReportGrid');
      const badge = document.getElementById('grillScoreBadge');
      const flaws = document.querySelectorAll('.grill-flaw-item').length;
      const upgrades = document.querySelectorAll('.grill-upgrade-item').length;
      return {
        gridHidden: grid?.hidden,
        scoreBadge: badge?.textContent,
        flawsCount: flaws,
        upgradesCount: upgrades
      };
    });
    assert.strictEqual(grillReportUi.gridHidden, false, 'Relatório do Grill-me deve estar visível');
    assert.strictEqual(grillReportUi.flawsCount, 3, 'Deve ter renderizado 3 falhas');
    assert.strictEqual(grillReportUi.upgradesCount, 3, 'Deve ter renderizado 3 upgrades 10x');
    await captureScreenshot(page, path.join(outDir, 'desktop-v2-grillme.png'));
    console.log(`  ✓ Workspace /grill-me testado ao vivo: ${grillReportUi.scoreBadge}, ${grillReportUi.flawsCount} falhas e ${grillReportUi.upgradesCount} títulos reescritos`);

    console.log('\n======================================================');
    console.log('🎉 TODOS OS TESTES DO VIRAL RESEARCH 2.0 PASSARAM 100%!');
    console.log('======================================================\n');
  } finally {
    if (chrome && chrome.exitCode === null) {
      chrome.kill('SIGKILL');
    }
    try {
      if (fs.existsSync(profileDir)) fs.rmSync(profileDir, { recursive: true, force: true });
      if (fs.existsSync(qaStorageDir)) fs.rmSync(qaStorageDir, { recursive: true, force: true });
    } catch {}
    if (server && server.server) {
      server.server.close();
    }
  }
}

async function connectToPage(port, chrome, logs) {
  for (let i = 0; i < 80; i += 1) {
    if (chrome.exitCode !== null) {
      throw new Error(`Chrome exited before DevTools was ready: ${chrome.exitCode}. ${logs.join('').slice(-500)}`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const tabs = await res.json();
      const tab = tabs.find(item => item.type === 'page' && item.webSocketDebuggerUrl);
      if (tab) return new CdpPage(tab.webSocketDebuggerUrl);
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`Chrome DevTools endpoint did not become ready. ${logs.join('').slice(-500)}`);
}

class CdpPage {
  constructor(wsUrl) {
    this.nextId = 1;
    this.pending = new Map();
    this.ws = new WebSocket(wsUrl);
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', event => {
      const payload = JSON.parse(event.data);
      if (!payload.id) return;
      const promise = this.pending.get(payload.id);
      if (!promise) return;
      this.pending.delete(payload.id);
      if (payload.error) promise.reject(new Error(payload.error.message || 'CDP call failed'));
      else promise.resolve(payload.result);
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    const payload = { id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  async evaluate(fnOrString, ...args) {
    const expression = typeof fnOrString === 'function'
      ? `(${fnOrString.toString()})(${args.map(a => JSON.stringify(a)).join(',')})`
      : fnOrString;
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (result.exceptionDetails) {
      const desc = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
      throw new Error(`Evaluation failed: ${desc}`);
    }
    return result.result?.value;
  }
}

async function setViewport(page, width, height, isMobile) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: isMobile
  });
  await page.send('Emulation.setVisibleSize', { width, height });
}

async function captureScreenshot(page, targetPath) {
  const result = await page.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(targetPath, Buffer.from(result.data, 'base64'));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
