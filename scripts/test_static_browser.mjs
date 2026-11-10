import assert from 'node:assert/strict';
import { createServer as httpServer } from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as viteServer } from '../frontend/node_modules/vite/dist/node/index.js';
import { chromium } from '../frontend/node_modules/@playwright/test/index.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const site = resolve(repo, '_site');
const cases = JSON.parse(readFileSync(resolve(site, 'browser-cases.json')));
const manifest = JSON.parse(readFileSync(resolve(site, 'data/static/manifest.json')));
const mime = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json',
  '.wasm': 'application/wasm', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
function serveFile(root, path, response, fallback) {
  let file = resolve(root, '.' + path);
  if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file += '/index.html';
  if (!existsSync(file)) file = fallback;
  if (!file || !existsSync(file)) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
  response.end(readFileSync(file));
}
const built = httpServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname.replace(/^\/cdc-outbreak-dashboard/, '');
  serveFile(site, path, response, resolve(site, 'app/index.html'));
});
await new Promise(resolve => built.listen(4174, '127.0.0.1', resolve));
const dev = await viteServer({
  root: resolve(repo, 'frontend'),
  server: { port: 4175, host: '127.0.0.1', strictPort: true },
  plugins: [{ name: 'local-static-data', configureServer(server) {
    server.middlewares.use('/data/static', (request, response) => {
      serveFile(resolve(site, 'data/static'), new URL(request.url, 'http://localhost').pathname, response);
    });
  } }],
});
await dev.listen();
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const results = { parity: 0, renderRequests: 0, blockedExternal: [], pages: [], databaseAssets: [], fontAssets: [] };
try {
  const context = await browser.newContext();
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    if (url.hostname.endsWith('.onrender.com')) results.renderRequests++;
    results.blockedExternal.push(url.origin);
    return route.abort();
  });
  const page = await context.newPage();
  page.on('response', response => {
    if (response.url().endsWith('.woff2')) {
      assert.equal(new URL(response.url()).hostname, '127.0.0.1');
      assert.equal(response.status(), 200);
      results.fontAssets.push(response.url().replace(/.*\//, ''));
    }
    if (/\.wasm$|public\.duckdb$|duckdb-browser-.*worker/.test(response.url())) {
      results.databaseAssets.push(response.url().replace(/.*\//, ''));
    }
  });
  page.on('pageerror', error => console.error('Browser error:', error.message));
  await page.goto('http://127.0.0.1:4175/');
  for (const item of cases) {
    const actual = await page.evaluate(async endpoint => {
      const { readStatic } = await import('/src/staticData.js');
      return readStatic(endpoint);
    }, item.endpoint);
    assert.deepEqual(actual, item.expected, item.endpoint);
    results.parity++;
  }
  // Measure bundled assets separately from the development server's source files.
  results.fontAssets = [];
  for (const path of ['', 'analytics', 'wastewater', 'forecasts', 'advanced', 'map', 'ask']) {
    const failures = [];
    const failed = request => {
      if (request.url().includes('/data/static/') || request.url().endsWith('.wasm')) failures.push(request.url());
    };
    page.on('requestfailed', failed);
    const began = Date.now();
    await page.goto(`http://127.0.0.1:4174/cdc-outbreak-dashboard/app/${path}`);
    await page.getByRole('status').filter({ hasText: 'Published data through' }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.loading-page'), { timeout: 60000 });
    await page.waitForLoadState('networkidle');
    assert.equal(failures.length, 0, `Data load failures on ${path}: ${failures}`);
    assert.ok(!/Error Loading Data|Failed to load|Published data through unavailable/i.test(await page.locator('body').innerText()), path);
    results.pages.push({ path: path || 'overview', elapsedMs: Date.now() - began });
    page.off('requestfailed', failed);
  }
  results.fonts = await page.evaluate(async () => {
    const variants = [
      ['Space Grotesk', 'normal', 400], ['Space Grotesk', 'normal', 500],
      ['Space Grotesk', 'normal', 600], ['Space Grotesk', 'normal', 700],
      ['Fraunces', 'normal', 500], ['Fraunces', 'normal', 600], ['Fraunces', 'normal', 700],
      ['Courier Prime', 'normal', 400], ['Courier Prime', 'normal', 700],
      ['Courier Prime', 'italic', 400],
    ];
    return Promise.all(variants.map(async ([family, style, weight]) => {
      const faces = await document.fonts.load(`${style} ${weight} 16px "${family}"`, 'Dashboard Đông Łódź');
      return { family, style, weight, loaded: faces.length > 0 && faces.every(face => face.status === 'loaded') };
    }));
  });
  assert.ok(results.fonts.every(font => font.loaded), 'Bundled font variants must load');
  assert.ok(!results.blockedExternal.some(origin => /googleapis|gstatic/.test(origin)), 'Unexpected external font request');
  assert.equal(results.renderRequests, 0, 'Read-only views contacted Render');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:4174/cdc-outbreak-dashboard/app/');
  await page.waitForFunction(() => !document.querySelector('.loading-page'));
  results.mobileViewport = await page.evaluate(date => ({
    width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth,
    dateVisible: document.body.textContent.includes(`Published data through ${date}`),
  }), manifest.data_date);
  assert.ok(results.mobileViewport.dateVisible);
  assert.equal(results.renderRequests, 0);
  await page.goto('http://127.0.0.1:4174/cdc-outbreak-dashboard/app/wastewater');
  await page.waitForFunction(() => !document.querySelector('.loading-page'));
  const weekCard = page.locator('.stat-card').filter({ hasText: 'WEEK ENDING' });
  const dateValue = weekCard.locator('.stat-card-value');
  assert.match(await dateValue.innerText(), /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(await dateValue.evaluate(node => node.scrollWidth <= node.clientWidth), 'Wastewater date must not clip');
  results.wastewaterMobileDate = await dateValue.innerText();
  results.wastewaterMobileViewport = await page.evaluate(() => ({
    width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.equal(results.wastewaterMobileViewport.width, results.wastewaterMobileViewport.scrollWidth);
  results.blockedExternal = [...new Set(results.blockedExternal)];
  results.databaseAssets = [...new Set(results.databaseAssets)];
  results.fontAssets = [...new Set(results.fontAssets)];
  assert.equal(results.fontAssets.length, 12, 'All bundled font subsets must load');
  mkdirSync(resolve(repo, '_site/test-results'), { recursive: true });
  writeFileSync(resolve(repo, '_site/test-results/browser.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  await dev.close();
  await new Promise(resolve => built.close(resolve));
}
