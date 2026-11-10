import assert from 'node:assert/strict';
import process from 'node:process';
import { inspectMobileLayout, assertMobileLayout, inspectHospitalizationScroll, assertScrollableTable } from './layout_checks.mjs';
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
const defaultScenario = JSON.parse(readFileSync(resolve(repo, 'frontend/src/data/simulator-default.json')));
const manifest = JSON.parse(readFileSync(resolve(site, 'data/static/manifest.json')));
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
const results = { parity: 0, renderRequests: 0, blockedExternal: [], pages: [], databaseAssets: [], fontAssets: [], landingFontAssets: [], mapAssets: [], errors: [] };
try {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.__fetchCalls = [];
    const original = window.fetch;
    window.fetch = function(input, options) {
      window.__fetchCalls.push({ url: String(input), method: options?.method || 'GET' });
      return original.call(this, input, options);
    };
  });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
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
  results.developmentCharts = await assertRenderedCharts(page, { minimum: 3, titlesById: {
    'overview-activity': ['ARI activity'], 'overview-positivity': ['% Positive'], 'overview-hospitalizations': ['Rate per 100k'],
  }, map: true });
  results.developmentHovers = [];
  for (const chart of results.developmentCharts) results.developmentHovers.push(await hoverChart(page, chart.id));
  assertNoBrowserErrors(results.errors);
  // Measure bundled assets separately from the development server's source files.
  results.fontAssets = [];
  const pages = [
    { path: '', minimum: 3, titlesById: {
      'overview-activity': ['ARI activity'], 'overview-positivity': ['% Positive'], 'overview-hospitalizations': ['Rate per 100k'],
    }, map: true },
    { path: 'analytics', minimum: 3, titlesById: {
      'analytics-positivity': ['% Positive'], 'analytics-hospitalizations': ['Rate per 100k'], 'analytics-seasons': ['Rate per 100k'],
    } },
    { path: 'wastewater', minimum: 1, titlesById: { 'wastewater-activity': ['WVAL'] }, map: true },
    { path: 'forecasts', minimum: 1, titlesById: {
      'forecast-primary': ['Week', 'Rate per 100k'], 'forecast-alternate': ['Week', 'Rate per 100k'],
    }, optionalIds: ['forecast-alternate'] },
    { path: 'advanced', minimum: 3, titlesById: {
      'advanced-models': ['Week', 'Rate per 100k'], 'advanced-importance': ['Importance Score'],
      'advanced-age': ['Week Ending', 'Rate/100k'], 'advanced-seasons': ['MMWR Week', 'Rate per 100k'],
    }, optionalIds: ['advanced-importance'] },
    { path: 'map?state=Ohio', minimum: 1, titlesById: { 'map-history': [] } },
    { path: 'simulator', minimum: 2, titlesById: {
      'simulator-beds': ['Week', 'Beds Needed'], 'simulator-icu': ['Week', 'ICU Beds Needed', 'Overflow %'],
    } },
    { path: 'ask', minimum: 0, titlesById: {} },
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
      result.hovers = [];
      for (const chart of result.charts) result.hovers.push(await hoverChart(page, chart.id));
      if (expected.path.startsWith('map')) result.globe = await inspectGlobe(page);
    } else {
      assert.equal(await page.locator('.js-plotly-plot').count(), 0, 'Ask has no chart until a question is answered');
      await page.getByPlaceholder(/Ask about COVID/).waitFor();
      result.note = 'Input-only Ask page: no chart or live submission expected';
    }
    if (expected.path === 'simulator') {
      await page.locator('#simulation-source').filter({ hasText: 'pre-built default result' }).waitFor();
      const calls = await page.evaluate(() => window.__fetchCalls);
      const nonShell = calls.filter(call => !call.url.endsWith('/data/static/manifest.json'));
      assert.deepEqual(nonShell, [], 'Simulator mounting must not make any fetch call');
      const readScenario = () => page.evaluate(() => ({
        beds: document.getElementById('simulator-beds').data.find(trace => trace.name === 'Mean bed demand').y,
        icu: document.getElementById('simulator-icu').data.find(trace => trace.name === 'ICU demand').y,
        capacity: document.getElementById('simulator-beds').data.find(trace => trace.name === 'Capacity').y,
      }));
      const before = await readScenario();
      assert.deepEqual(before.beds, defaultScenario.result.bed_demand_mean);
      assert.deepEqual(before.icu, defaultScenario.result.icu_demand_mean);
      results.simulatorLoad = { componentFetches: nonShell.length, shellManifestFetches: calls.length, defaultVisible: true };
      await page.locator('input[type=range]').nth(5).press('ArrowRight');
      assert.equal(await page.locator('input[type=range]').nth(5).inputValue(), '550');
      // Reject the actual client fetch before any network access; never return a successful fixture.
      await page.evaluate(() => {
        const original = window.fetch;
        window.__failedSimulationAttempts = [];
        window.fetch = function(input, options) {
          if (String(input).endsWith('/api/simulator/run')) {
            window.__failedSimulationAttempts.push({ url: String(input), method: options.method, params: JSON.parse(options.body) });
            return Promise.reject(new TypeError('Simulation service unavailable'));
          }
          return original.call(this, input, options);
        };
      });
      await page.getByRole('button', { name: 'Run scenario', exact: true }).click();
      const alert = page.getByRole('alert').filter({ hasText: 'Could not run the scenario' });
      await alert.waitFor({ timeout: 20000 });
      assert.match(await alert.innerText(), /pre-built default result/);
      assert.deepEqual(await readScenario(), before, 'A failed run must retain all default data and capacities');
      assert.equal(await page.getByRole('button', { name: 'Run scenario', exact: true }).isEnabled(), true);
      const attempts = await page.evaluate(() => window.__failedSimulationAttempts);
      assert.equal(attempts.length, 3);
      assert.ok(attempts.every(attempt => new URL(attempt.url).hostname === 'cdc-outbreak-api.onrender.com' && attempt.method === 'POST' && attempt.params.beds_available === 550));
      const retainedCharts = await assertRenderedCharts(page, expected);
      results.simulatorRetainedHovers = [];
      for (const chart of retainedCharts) results.simulatorRetainedHovers.push(await hoverChart(page, chart.id));
      results.simulatorFailure = { productionApiHost: new URL(attempts[0].url).hostname, attempts: attempts.length, error: await alert.innerText(), defaultRetained: true, selectedBeds: 550, displayedBeds: before.capacity[0] };
    }
    if (expected.path === 'analytics') {
      await page.evaluate(() => {
        const chart = document.getElementById('analytics-seasons');
        delete chart.layout.yaxis.title;
        chart.querySelectorAll('.ytitle').forEach(title => title.remove());
      });
      const mutated = await inspectCharts(page);
      assert.ok(mutated.find(chart => chart.id === 'analytics-hospitalizations').renderedTitles.includes('Rate per 100k'));
      assert.throws(() => assertChartSnapshots(mutated, expected), /analytics-seasons.*Rate per 100k/);
      results.missingTitleRejectedById = true;
      await page.evaluate(() => {
        const chart = document.getElementById('analytics-positivity');
        chart.layout.hovermode = false;
        chart._fullLayout.hovermode = false;
      });
      await assert.rejects(() => hoverChart(page, 'analytics-positivity', { timeout: 100 }), /analytics-positivity/);
      results.missingHoverRejectedById = true;
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
    let charts = [];
    const hovers = [];
    if (expected.minimum) {
      charts = await assertRenderedCharts(page, expected);
      for (const chart of charts) hovers.push(await hoverChart(page, chart.id));
    }
    const clipped = await page.locator('.stat-card-value, .stat-card-label, .stat-card-plain, .stat-card-wow, .stat-card-week').evaluateAll(nodes =>
      nodes.filter(node => node.scrollWidth > node.clientWidth).map(node => node.textContent.trim()));
    assert.deepEqual(clipped, [], `Clipped mobile summary on ${expected.path}`);
    await page.mouse.move(0, 0);
    const layout = await inspectMobileLayout(page);
    if (expected.path === '') {
      results.layoutNegatives = [];
      for (const kind of ['nowrap-badge', 'unwrapped-table', 'unmarked-scrollport', 'clipped-marker']) {
        const probe = await page.evaluate(kind => {
          const node = document.createElement('div');
          node.id = 'layout-negative-probe';
          node.style.cssText = 'position:fixed;left:24px;top:140px;width:240px;max-width:240px;z-index:9999;background:white;color:black;';
          if (kind === 'nowrap-badge' || kind === 'clipped-marker') {
            node.className = 'status-badge';
            node.style.cssText += 'display:block;white-space:nowrap;overflow:hidden;';
            node.textContent = 'CDC week ending 2026-10-10 · refresh may be delayed · last checked 12:42 PM '.repeat(8);
            if (kind === 'clipped-marker') node.setAttribute('data-scroll-x', '');
          } else {
            const table = document.createElement('table');
            table.id = 'layout-negative-table';
            table.style.cssText = 'width:1200px;min-width:1200px;white-space:nowrap;';
            table.innerHTML = '<tbody><tr><td>Weekly rate</td><td>Cumulative rate</td></tr></tbody>';
            node.append(table);
            if (kind === 'unmarked-scrollport') node.style.overflowX = 'auto';
          }
          document.querySelector('.main-content').append(node);
          return { kind, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, right: node.getBoundingClientRect().right };
        }, kind);
        try {
          assert.ok(probe.scrollWidth > probe.clientWidth + 1, `${kind} must reproduce real internal overflow`);
          const injected = await inspectMobileLayout(page);
          assert.throws(() => assertMobileLayout(injected), undefined, `${kind} must fail the real browser layout gate`);
          if (kind === 'nowrap-badge') {
            assert.ok(probe.right < 390, 'The clipped badge box itself must remain inside the viewport');
            assert.ok(injected.overflowingElements.some(item => item.element === '#layout-negative-probe'), 'The collector must detect the badge own concealed text');
          }
          results.layoutNegatives.push({ ...probe, rejected: true, layout: injected });
        } finally {
          await page.locator('#layout-negative-probe').evaluate(node => node.remove());
        }
        assertMobileLayout(await inspectMobileLayout(page));
      }
    }
    const screenshotNames = { '': 'overview', analytics: 'trends', simulator: 'surge-planning' };
    if (Object.hasOwn(screenshotNames, expected.path)) {
      const directory = process.env.STATIC_SCREENSHOT_DIR || resolve(site, 'test-results/mobile');
      mkdirSync(directory, { recursive: true });
      const name = screenshotNames[expected.path];
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: resolve(directory, `${name}-viewport.png`) });
      await page.screenshot({ path: resolve(directory, `${name}-full.png`), fullPage: true });
      if (expected.path === 'analytics') {
        const card = page.locator('.card').filter({ hasText: 'Recent Hospitalization Data' });
        await card.scrollIntoViewIfNeeded();
        await page.screenshot({ path: resolve(directory, `${name}-table.png`) });
        results.hospitalizationScroll = await inspectHospitalizationScroll(page);
        await page.locator('#hospitalization-table-scroll').evaluate(node => { node.scrollLeft = node.scrollWidth; });
        await page.screenshot({ path: resolve(directory, `${name}-table-right.png`) });
        await page.locator('#hospitalization-table-scroll').evaluate(node => { node.scrollLeft = 0; });
      }
      if (expected.path === 'simulator') {
        await page.getByText('Scenario settings', { exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: resolve(directory, `${name}-values.png`) });
      }
    }
    results.mobilePages.push({ path: expected.path || 'overview', ...size, clipped, charts: charts.map(chart => chart.id), hovers, layout });
    assertNoBrowserErrors(results.errors);
  }
  for (const result of results.mobilePages) assertMobileLayout(result.layout);
  assertScrollableTable(results.hospitalizationScroll);
  assertNoBrowserErrors(results.errors);
  assert.equal(results.blockedExternal.length, 0, 'The application attempted an external asset request');
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
