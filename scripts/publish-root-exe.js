'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist', 'win-unpacked');
const exeName = 'Viral Research.exe';
const legacyExeName = 'Viral Planner Research.exe';
const exeFile = path.join(distDir, exeName);

if (!fs.existsSync(exeFile)) {
  throw new Error(`Portable executable not found: ${exeFile}`);
}

const skipNames = new Set(['.env', 'data']);
const replaceDirs = new Set(['locales', 'resources', 'tools']);

for (const entry of fs.readdirSync(distDir, { withFileTypes: true })) {
  if (skipNames.has(entry.name)) continue;

  const from = path.join(distDir, entry.name);
  const to = path.join(root, entry.name);
  assertInsideRoot(to);

  if (entry.isDirectory()) {
    if (!replaceDirs.has(entry.name)) continue;
    fs.rmSync(to, { recursive: true, force: true });
    fs.cpSync(from, to, { recursive: true });
    continue;
  }

  try {
    fs.copyFileSync(from, to);
  } catch (err) {
    if (!fs.existsSync(to)) throw err;
  }
}

copyIfMissing(path.join(distDir, '.env'), path.join(root, '.env'));
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
const legacyExe = path.join(root, legacyExeName);
if (legacyExeName !== exeName && fs.existsSync(legacyExe)) fs.rmSync(legacyExe, { force: true });

console.log(`Desktop executable published in project root: ${path.join(root, exeName)}`);
console.log('Runtime files were refreshed beside the executable; .env was not printed or overwritten.');

function copyIfMissing(from, to) {
  if (!fs.existsSync(from) || fs.existsSync(to)) return;
  fs.copyFileSync(from, to);
}

function assertInsideRoot(target) {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside project: ${target}`);
  }
}
