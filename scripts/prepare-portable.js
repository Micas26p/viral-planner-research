'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist', 'win-unpacked');
const exeFile = path.join(distDir, 'Viral Research.exe');
const dataDir = path.join(distDir, 'data');

if (!fs.existsSync(exeFile)) {
  throw new Error(`Executable not found: ${exeFile}`);
}

fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });
copyIfExists(path.join(root, '.env'), path.join(distDir, '.env'));
copyIfExists(path.join(root, 'build', 'icon.ico'), path.join(distDir, 'icon.ico'));

for (const file of ['seen.json', 'last-results.json']) {
  copyIfExists(path.join(root, 'data', file), path.join(dataDir, file));
}

console.log(`Portable app ready: ${distDir}`);
console.log('Copied .env when present without printing its contents.');

function copyIfExists(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
