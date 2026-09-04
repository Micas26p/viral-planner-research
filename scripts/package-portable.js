'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const electronCache = path.join(root, '.electron-cache');
fs.mkdirSync(electronCache, { recursive: true });
process.env.ELECTRON_CACHE = electronCache;
process.env.electron_config_cache = electronCache;

const electronExe = require('electron');
const electronDist = path.dirname(electronExe);
const outputDir = path.join(root, 'dist', 'win-unpacked');
const appDir = path.join(outputDir, 'resources', 'app');
const exeName = 'Viral Research.exe';
const npmCli = process.env.npm_execpath;

assertInsideRoot(outputDir);
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

fs.cpSync(electronDist, outputDir, { recursive: true });
fs.renameSync(path.join(outputDir, 'electron.exe'), path.join(outputDir, exeName));

fs.mkdirSync(appDir, { recursive: true });
copy(path.join(root, 'package.json'), path.join(appDir, 'package.json'));
copy(path.join(root, 'package-lock.json'), path.join(appDir, 'package-lock.json'));
copy(path.join(root, 'server.js'), path.join(appDir, 'server.js'));
copyDir(path.join(root, 'desktop'), path.join(appDir, 'desktop'));
copyDir(path.join(root, 'lib'), path.join(appDir, 'lib'));
copyDir(path.join(root, 'public'), path.join(appDir, 'public'));
copyOptionalFfmpeg();

if (!npmCli) {
  throw new Error('npm_execpath is required. Run this through npm.cmd run desktop:dist.');
}

const cacheDir = path.join(root, '.npm-cache');
const install = spawnSync(process.execPath, [npmCli, 'install', '--omit=dev'], {
  cwd: appDir,
  stdio: 'inherit',
  shell: false,
  env: { ...process.env, npm_config_cache: cacheDir }
});

if (install.status !== 0) {
  const detail = install.error ? `: ${install.error.message}` : install.signal ? ` signal ${install.signal}` : '';
  throw new Error(`Production dependency install failed with code ${install.status}${detail}`);
}

console.log(`Packaged portable Electron app: ${path.join(outputDir, exeName)}`);

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDir(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

function copyOptionalFfmpeg() {
  const source = [process.env.VPR_FFMPEG_PATH, 'C:\\ffmpeg\\bin\\ffmpeg.exe']
    .filter(Boolean)
    .find(file => fs.existsSync(file));
  if (!source) {
    console.warn('Optional FFmpeg compatibility decoder was not found; Chromium playback remains available.');
    return;
  }
  copy(source, path.join(outputDir, 'tools', 'ffmpeg.exe'));
}

function assertInsideRoot(target) {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to remove path outside project: ${target}`);
  }
}
