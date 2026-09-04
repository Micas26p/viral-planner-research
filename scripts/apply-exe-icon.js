'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { rcedit } = require('rcedit');

const root = path.resolve(__dirname, '..');
const exePath = path.resolve(root, process.argv[2] || path.join('dist', 'win-unpacked', 'Viral Research.exe'));
const iconPath = path.join(root, 'build', 'icon.ico');

if (process.platform !== 'win32') {
  console.log('Skipping Windows executable icon update on this platform.');
  process.exit(0);
}

if (!fs.existsSync(exePath)) {
  throw new Error(`Executable not found: ${exePath}`);
}

if (!fs.existsSync(iconPath)) {
  throw new Error(`Icon not found: ${iconPath}`);
}

rcedit(exePath, {
  icon: iconPath,
  'file-version': '1.0.0',
  'product-version': '1.0.0',
  'version-string': {
    CompanyName: 'Viral Research',
    FileDescription: 'Viral Research',
    InternalName: 'Viral Research',
    OriginalFilename: 'Viral Research.exe',
    ProductName: 'Viral Research'
  }
}).then(() => {
  console.log(`Applied Viral Research icon to ${exePath}`);
}).catch(err => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
