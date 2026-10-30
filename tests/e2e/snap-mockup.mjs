// Screenshots the OpenDesign mockup at a given size, for side-by-side comparison with the app.
//   node tests/e2e/snap-mockup.mjs out.png [width] [height]
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const [out = 'mockup.png', w = '1440', h = '900'] = process.argv.slice(2);
const dir = mkdtempSync(resolve(tmpdir(), 'wat-mock-'));
writeFileSync(resolve(dir, 'main.cjs'), `const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => { const win = new BrowserWindow({ width: ${w}, height: ${h}, show: true }); win.loadFile(${JSON.stringify(resolve('WA-Turbo-Mac-App/index.html'))}); });`);
writeFileSync(resolve(dir, 'package.json'), '{"main":"main.cjs"}');
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
const app = await electron.launch({ executablePath: require('electron'), args: [dir], env });
const page = await app.firstWindow();
await page.setViewportSize({ width: Number(w), height: Number(h) });
await page.waitForTimeout(1500);
await page.screenshot({ path: out });
await app.close();
console.log('saved', out);
