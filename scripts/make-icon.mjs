// Renders build/icon.png (1024×1024) from the mockup's lightning mark.
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const dir = mkdtempSync(resolve(tmpdir(), 'wat-icon-'));
const html = `<html><body style="margin:0;background:transparent">
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#11866a"/><stop offset="1" stop-color="#0b6e55"/></linearGradient></defs>
  <rect x="100" y="100" width="824" height="824" rx="186" fill="url(#g)"/>
  <g transform="translate(212 212) scale(25)" fill="none" stroke="#ffffff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
    <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" fill="#ffffff"/>
  </g>
</svg></body></html>`;
writeFileSync(resolve(dir, 'icon.html'), html);
writeFileSync(resolve(dir, 'main.cjs'), `const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => { const w = new BrowserWindow({ width: 1024, height: 1024, transparent: true, frame: false }); w.loadFile(${JSON.stringify(resolve(dir, 'icon.html'))}); });`);
writeFileSync(resolve(dir, 'package.json'), '{"main":"main.cjs"}');
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
const app = await electron.launch({ executablePath: require('electron'), args: [dir], env });
const page = await app.firstWindow();
await page.setViewportSize({ width: 1024, height: 1024 });
await page.waitForTimeout(500);
await page.locator('svg').screenshot({ path: 'build/icon.png', omitBackground: true });
await app.close();
console.log('wrote build/icon.png');
