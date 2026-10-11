// Automated playtest: drives the game with its built-in autopilot (?bot=1)
// in headless Chromium, records console errors, periodic screenshots and the
// final run summary.
//
//   npx http-server -p 8123 -s .        (in another terminal)
//   NODE_PATH=$(npm root -g) node tools/playtest.cjs [url-params] [outDir]
//
// Example: node tools/playtest.cjs "bot=1&speed=6&char=gravedigger" out
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const params = process.argv[2] || 'bot=1&speed=6';
  const out = process.argv[3] || 'playtest-out';
  const shotEvery = parseFloat(process.argv[4] || '20');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '')));
  await page.goto(`http://127.0.0.1:8123/index.html?${params}`);
  const t0 = Date.now();
  let nextShot = 0, i = 0;
  const maxMs = parseFloat(process.env.MAX_MS || '600000');
  while (Date.now() - t0 < maxMs) {
    await page.waitForTimeout(500);
    const st = await page.evaluate(() => ({ state: window.__G && __G.state, time: window.__G && __G.time, result: window.__result || null }));
    if (st.time >= nextShot && (st.state === 'play' || st.state === 'levelup')) {
      await page.screenshot({ path: path.join(out, `shot-${String(i++).padStart(2, '0')}-${Math.round(st.time)}s.png`) });
      nextShot = st.time + shotEvery;
    }
    if (st.result) {
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(out, 'result.png') });
      fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(st.result, null, 2));
      console.log(JSON.stringify(st.result, null, 1));
      break;
    }
    if (errors.length > 20) break;
  }
  fs.writeFileSync(path.join(out, 'errors.txt'), errors.join('\n'));
  console.log('errors:', errors.length);
  errors.slice(0, 15).forEach(e => console.log(e));
  console.log('elapsed', Math.round((Date.now() - t0) / 1000), 's');
  await browser.close();
})();
