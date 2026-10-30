// Launches the built app and saves a screenshot: node tests/e2e/snap.mjs out.png [width] [height]
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const [out = 'snap.png', w = '1440', h = '900', wait = '2500', clicks = ''] = process.argv.slice(2);
const app = await electron.launch({ executablePath: require('electron'), args: ['.'], env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE')) });
const page = await app.firstWindow();
await page.setViewportSize({ width: Number(w), height: Number(h) });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.waitForTimeout(Number(wait));
for (const sel of clicks.split(',').filter(Boolean)) { await page.click(sel); await page.waitForTimeout(600); }
await page.screenshot({ path: out });
if (errors.length) console.log('Page errors:\n' + errors.join('\n'));
await app.close();
console.log('saved', out);
