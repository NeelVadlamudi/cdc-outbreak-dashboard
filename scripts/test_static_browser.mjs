import assert from 'node:assert/strict';
import { createServer as httpServer } from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as viteServer } from '../frontend/node_modules/vite/dist/node/index.js';
import { chromium } from '../frontend/node_modules/@playwright/test/index.mjs';
import { assertNoBrowserErrors, inspectCharts, assertChartSnapshots, assertRenderedCharts, hoverChart, inspectGlobe } from './chart_checks.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const site = resolve(repo, '_site');
const cases = JSON.parse(readFileSync(resolve(site, 'browser-cases.json')));
const manifest = JSON.parse(readFileSync(resolve(site, 'data/static/manifest.json')));
const simulation = JSON.parse(readFileSync(resolve(site, 'simulator-case.json')));
const mime = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json',
  '.wasm': 'application/wasm', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
function serveFile(root, path, response, fallback) {
  let file = resolve(root, '.' + path);
  if (file !== root && !file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
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
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = { parity: 0, renderRequests: 0, blockedExternal: [], pages: [], databaseAssets: [], fontAssets: [], landingFontAssets: [], mapAssets: [], errors: [], simulatorFixtureRequests: 0 };
try {
  const context = await browser.newContext();
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/api/simulator/run') {
      if (route.request().method() === 'POST') {
        assert.deepEqual(route.request().postDataJSON(), simulation.params);
        results.simulatorFixtureRequests++;
      }
      return route.fulfill({ status: 200, json: simulation.expected, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    if (url.hostname === '127.0.0.1') return route.continue();
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    if (url.hostname.endsWith('.onrender.com')) results.renderRequests++;
    results.blockedExternal.push(url.origin);
    return route.abort();
  });
  const blank = await context.newPage();
  await blank.setContent('<div class="js-plotly-plot"><svg class="main-svg"><path class="axis" d="M0,0L100,0" /></svg></div>');
  const awaitedBlank = await inspectCharts(blank);
  assert.throws(() => assertChartSnapshots(awaitedBlank), /Blank chart/);
  await blank.close();
  results.blankChartRejected = true;
  const page = await context.newPage();
  page.on('response', response => {
    if (response.status() >= 400) results.errors.push(`HTTP ${response.status()}: ${response.url()}`);
    if (/usa_110m\.json|earth-water.*\.png/.test(response.url())) results.mapAssets.push(response.url());
    if (response.url().endsWith('.woff2')) {
      assert.equal(new URL(response.url()).hostname, '127.0.0.1');
      assert.equal(response.status(), 200);
      const fonts = response.url().includes('/app/') ? results.fontAssets : results.landingFontAssets;
      fonts.push(response.url().replace(/.*\//, ''));
    }
    if (/\.wasm$|public\.duckdb$|duckdb-browser-.*worker/.test(response.url())) {
      results.databaseAssets.push(response.url().replace(/.*\//, ''));
    }
  });
  page.on('requestfailed', request => results.errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`));
  page.on('pageerror', error => results.errors.push(`pageerror: ${error.stack || error.message}`));
  page.on('console', message => { if (message.type() === 'error') results.errors.push(`console: ${message.text()}`); });
  await page.goto('http://127.0.0.1:4175/');
  for (const item of cases) {
    const actual = await page.evaluate(async endpoint => {
      const { readStatic } = await import('/src/staticData.js');
      return readStatic(endpoint);
    }, item.endpoint);
    assert.deepEqual(actual, item.expected, item.endpoint);
    results.parity++;
  }
  await page.waitForLoadState('networkidle');
  await assertRenderedCharts(page, { minimum: 3, titles: ['ARI activity', '% Positive', 'Rate per 100k'], map: true });
  assertNoBrowserErrors(results.errors);
  // Measure bundled assets separately from the development server's source files.
  results.fontAssets = [];
  const pages = [
    { path: '', minimum: 3, titles: ['ARI activity', '% Positive', 'Rate per 100k'], map: true },
    { path: 'analytics', minimum: 3, titles: ['% Positive', 'Rate per 100k'] },
    { path: 'wastewater', minimum: 1, titles: ['WVAL'], map: true },
    { path: 'forecasts', minimum: 1, titles: ['Week', 'Rate per 100k'] },
    { path: 'advanced', minimum: 3, titles: ['Week', 'Rate per 100k', 'Week Ending', 'Rate/100k', 'MMWR Week'] },
    { path: 'map?state=Ohio', minimum: 1, titles: [] },
    { path: 'simulator', minimum: 2, titles: ['Week', 'Beds Needed', 'ICU Beds Needed', 'Overflow %'] },
    { path: 'ask', minimum: 0, titles: [] },
  ];
  for (const expected of pages) {
    const failures = [];
    const failed = request => failures.push(request.url());
    page.on('requestfailed', failed);
    const began = Date.now();
    await page.goto(`http://127.0.0.1:4174/cdc-outbreak-dashboard/app/${expected.path}`);
    await page.getByRole('status').filter({ hasText: 'Published data through' }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.loading-page'), { timeout: 60000 });
    await page.waitForLoadState('networkidle');
    assertNoBrowserErrors(results.errors);
    assert.equal(failures.length, 0, `Request failures on ${expected.path}: ${failures}`);
    assert.ok(!/Error Loading Data|Failed to load|Published data through unavailable/i.test(await page.locator('body').innerText()), expected.path);
    const result = { path: expected.path || 'overview', elapsedMs: Date.now() - began };
    if (expected.minimum) {
      result.charts = await assertRenderedCharts(page, expected);
      result.hover = await hoverChart(page);
      if (expected.path.startsWith('map')) result.globe = await inspectGlobe(page);
    } else {
      assert.equal(await page.locator('.js-plotly-plot').count(), 0, 'Ask has no chart until a question is answered');
      await page.getByPlaceholder(/Ask about COVID/).waitFor();
      result.note = 'Input-only Ask page: no chart or live submission expected';
    }
    assertNoBrowserErrors(results.errors);
    results.pages.push(result);
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
  results.mobilePages = [];
  for (const expected of pages) {
    await page.goto(`http://127.0.0.1:4174/cdc-outbreak-dashboard/app/${expected.path}`);
    await page.waitForFunction(() => !document.querySelector('.loading-page'));
    await page.waitForLoadState('networkidle');
    const size = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.equal(size.width, size.scrollWidth, `Mobile overflow on ${expected.path}: ${JSON.stringify(size)}`);
    if (expected.minimum) await assertRenderedCharts(page, expected);
    const clipped = await page.locator('.stat-card-value, .stat-card-label, .stat-card-plain, .stat-card-week').evaluateAll(nodes =>
      nodes.filter(node => node.scrollWidth > node.clientWidth).map(node => node.textContent.trim()));
    assert.deepEqual(clipped, [], `Clipped mobile summary on ${expected.path}`);
    results.mobilePages.push({ path: expected.path || 'overview', ...size, clipped });
    assertNoBrowserErrors(results.errors);
  }
  assertNoBrowserErrors(results.errors);
  assert.equal(results.blockedExternal.length, 0, 'The application attempted an external asset request');
  assert.ok(results.simulatorFixtureRequests > 0);
  results.mapAssets = [...new Set(results.mapAssets)];
  results.embeddedGeography = await page.evaluate(() => Object.keys(window.PlotlyGeoAssets.topojson.usa_110m.objects));
  assert.ok(results.embeddedGeography.includes('subunits'));
  assert.ok(results.mapAssets.some(url => url.includes('earth-water')));
  results.blockedExternal = [...new Set(results.blockedExternal)];
  results.databaseAssets = [...new Set(results.databaseAssets)];
  results.fontAssets = [...new Set(results.fontAssets)];
  assert.equal(results.fontAssets.length, 12, 'All bundled font subsets must load');
  results.landingFontAssets = [];
  await page.goto('http://127.0.0.1:4174/cdc-outbreak-dashboard/');
  assertNoBrowserErrors(results.errors);
  await page.getByRole('heading', { name: 'Respiratory Virus Dashboard', exact: true }).waitFor();
  await page.waitForLoadState('networkidle');
  results.landingFonts = await page.evaluate(fonts => Promise.all(fonts.map(async ({ family, style, weight }) => {
    const faces = await document.fonts.load(`${style} ${weight} 16px "${family}"`, 'Dashboard Đông Łódź');
    return { family, style, weight, loaded: faces.length > 0 && faces.every(face => face.status === 'loaded') };
  })), results.fonts);
  assert.ok(results.landingFonts.every(font => font.loaded), 'Landing font variants must load locally');
  results.landingFontAssets = [...new Set(results.landingFontAssets)];
  assert.equal(results.landingFontAssets.length, 12, 'All landing font subsets must load');
  assertNoBrowserErrors(results.errors);
  assert.equal(results.blockedExternal.length, 0, 'Landing page attempted an external request');
  mkdirSync(resolve(repo, '_site/test-results'), { recursive: true });
  writeFileSync(resolve(repo, '_site/test-results/browser.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  mkdirSync(resolve(repo, '_site/test-results'), { recursive: true });
  writeFileSync(resolve(repo, '_site/test-results/browser.json'), JSON.stringify(results, null, 2));
  throw error;
} finally {
  await browser.close();
  await dev.close();
  await new Promise(resolve => built.close(resolve));
}
