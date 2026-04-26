#!/usr/bin/env node
/**
 * build-extension.mjs
 * Creates a production-ready ZIP of the extension/ folder for Chrome Web Store submission.
 * Usage: node build-extension.mjs
 * Output: sgt-captcha-extension.zip
 */

import { execSync } from 'child_process';
import { existsSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname);
const EXT = resolve(ROOT, 'extension');
const OUT = resolve(ROOT, 'sgt-captcha-extension.zip');

if (existsSync(OUT)) {
  rmSync(OUT);
  console.log('🗑  Removed old ZIP');
}

console.log('📦  Building extension ZIP...');
console.log(`    Source: ${EXT}`);
console.log(`    Output: ${OUT}`);

// zip -r <output> <folder> from repo root so paths are relative to extension/
execSync(`cd "${EXT}" && zip -r "${OUT}" . --exclude "*.DS_Store" --exclude "__MACOSX/*" --exclude "*.map"`, {
  stdio: 'inherit'
});

console.log('\n✅  Done! Submit this file to the Chrome Web Store:');
console.log(`    ${OUT}\n`);
