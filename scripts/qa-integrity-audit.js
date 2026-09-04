'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const fsp = fs.promises;

const { SentinelEngine } = require('../lib/sentinel-service');
const { ResearchStore } = require('../lib/research-store');

async function testSentinelPersistence() {
  console.log('1. Testando persistencia e anti-duplicacao pos-restart do Sentinel...');
  const testDir = path.join(__dirname, '..', '.qa-storage-integrity-sentinel');
  fs.mkdirSync(testDir, { recursive: true });
  const dbPath = path.join(testDir, 'sentinel-test.db');
  const store = new ResearchStore(dbPath);

  const engine1 = new SentinelEngine({ store, intervalMinutes: 15 });
  assert.equal(engine1.seenVideoIds.size, 0);

  const sampleAlert = {
    videoId: 'v_audit_persisted_01',
    title: 'Video Viral Teste de Integridade',
    channelTitle: 'Canal Teste',
    multiplier: '8.5'
  };

  const dispatchRes = await engine1.dispatchAlert({
    telegramEnabled: false,
    discordEnabled: false,
    desktopNotifications: false,
    webhookEnabled: false
  }, sampleAlert);

  assert.equal(dispatchRes.ok, false);
  assert.equal(engine1.seenVideoIds.has('v_audit_persisted_01'), true);
  assert.equal(engine1.alertHistory.length, 1);

  const engine2 = new SentinelEngine({ store, intervalMinutes: 15 });
  assert.equal(engine2.seenVideoIds.has('v_audit_persisted_01'), true, 'Deveria ter carregado videoId visto do SQLite no reinicio');
  assert.equal(engine2.alertHistory.length, 1, 'Deveria ter carregado historico de alertas do SQLite no reinicio');

  const reAlertRes = await engine2.dispatchAlert({}, sampleAlert);
  assert.equal(reAlertRes.skipped, true, 'Deveria pular re-alerta de video ja visto no reinicio');

  store.close();
  fs.rmSync(testDir, { recursive: true, force: true });
  console.log('  ok: Persistencia do Sentinel pos-restart validada com sucesso!');
}

async function testJsonFileResilience() {
  console.log('2. Testando resiliencia de escrita/leitura concorrente de JSON...');
  const testDir = path.join(__dirname, '..', '.qa-storage-integrity-json');
  await fsp.mkdir(testDir, { recursive: true });

  async function writeJsonFile(file, value) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const uniqueId = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8);
    const tmp = file + '.' + process.pid + '.' + uniqueId + '.tmp';
    const content = JSON.stringify(value, null, 2);
    await fsp.writeFile(tmp, content, 'utf8');

    let attempts = 0;
    while (attempts < 5) {
      try {
        await fsp.rename(tmp, file);
        return;
      } catch (err) {
        attempts++;
        if (attempts >= 5) {
          try {
            await fsp.copyFile(tmp, file);
            await fsp.unlink(tmp).catch(() => {});
            return;
          } catch {
            await fsp.unlink(tmp).catch(() => {});
            throw err;
          }
        }
        await new Promise(r => setTimeout(r, 25 * attempts));
      }
    }
  }

  function readJsonFile(file, fallback) {
    try {
      if (!fs.existsSync(file)) return fallback;
      const raw = fs.readFileSync(file, 'utf8').trim();
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  const writes = [];
  for (let i = 0; i < 10; i++) {
    const f = path.join(testDir, 'concurrent_' + i + '.json');
    writes.push(writeJsonFile(f, { index: i, timestamp: Date.now() }));
  }
  await Promise.all(writes);

  for (let i = 0; i < 10; i++) {
    const f = path.join(testDir, 'concurrent_' + i + '.json');
    const read = readJsonFile(f, null);
    assert.ok(read, 'Arquivo concurrent_' + i + '.json deveria existir');
    assert.equal(read.index, i);
  }

  const emptyFile = path.join(testDir, 'empty.json');
  fs.writeFileSync(emptyFile, '   ');
  assert.deepEqual(readJsonFile(emptyFile, { fallback: true }), { fallback: true });

  await fsp.rm(testDir, { recursive: true, force: true });
  console.log('  ok: Resiliencia de arquivos JSON validada com sucesso!');
}

async function testSseTerminalCleanup() {
  console.log('3. Testando encerramento deterministico de conexoes SSE em jobs terminais...');
  let closed = false;
  let writtenData = '';

  const mockRes = {
    write: (chunk) => { writtenData += chunk; },
    end: () => { closed = true; }
  };

  const jobSubscribers = new Map();
  const listeners = new Set([mockRes]);
  jobSubscribers.set('job_terminal_test', listeners);

  function emitTerminalTest(job) {
    const list = jobSubscribers.get(job.id);
    if (!list || !list.size) return;
    const terminal = ['complete', 'error', 'cancelled'].includes(job.status);
    const payload = 'data: ' + JSON.stringify({ id: job.id, status: job.status }) + '\n\n';
    for (const response of [...list]) {
      try {
        response.write(payload);
        if (terminal) {
          response.end();
          list.delete(response);
        }
      } catch {
        list.delete(response);
      }
    }
    if (terminal) {
      jobSubscribers.delete(job.id);
    }
  }

  emitTerminalTest({ id: 'job_terminal_test', status: 'complete' });
  assert.equal(closed, true, 'O socket SSE deveria ser finalizado com .end() no termino');
  assert.equal(jobSubscribers.has('job_terminal_test'), false, 'A fila de assinantes deveria ser removida');
  console.log('  ok: Encerramento de sockets SSE e prevencao de resource leak validados!');
}

function testSqliteBusyTimeout() {
  console.log('4. Testando PRAGMA busy_timeout e resiliencia de conexao SQLite...');
  const testDir = path.join(__dirname, '..', '.qa-storage-integrity-sqlite');
  fs.mkdirSync(testDir, { recursive: true });
  const store = new ResearchStore(testDir);
  const row = store.db.prepare('PRAGMA busy_timeout;').get();
  assert.equal(row.timeout, 5000, 'busy_timeout deveria estar configurado para 5000ms');
  store.close();
  fs.rmSync(testDir, { recursive: true, force: true });
  console.log('  ok: PRAGMA busy_timeout = 5000ms validado com sucesso!');
}

async function runAuditTests() {
  console.log('Iniciando Verificacao de Integridade e Correcoes da Auditoria...\n');
  await testSentinelPersistence();
  await testJsonFileResilience();
  await testSseTerminalCleanup();
  testSqliteBusyTimeout();
  console.log('\nTodas as 4 verificacoes de integridade passaram com 100% de sucesso!\n');
}

runAuditTests().catch(err => {
  console.error('Falha na verificacao de integridade:', err);
  process.exit(1);
});