'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const electronCache = path.join(root, '.electron-cache');

fs.mkdirSync(electronCache, { recursive: true });
process.env.ELECTRON_CACHE = electronCache;
process.env.electron_config_cache = electronCache;

const electronPath = require('electron');
const child = spawn(electronPath, ['.'], {
  cwd: root,
  stdio: 'inherit',
  shell: false
});

child.on('exit', code => process.exit(code || 0));
child.on('error', err => {
  console.error(err);
  process.exit(1);
});
