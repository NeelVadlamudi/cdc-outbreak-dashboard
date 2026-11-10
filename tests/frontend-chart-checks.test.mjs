import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { assertChartSnapshots, assertNoBrowserErrors, hoverChart } from '../scripts/chart_checks.mjs';

const chart = { id: 'example', renderedTitles: ['Week'], svg: true, marks: 3, hasData: true, stringTitles: [], declaredTitles: ['Week'], renderedText: ['Week'], mapPaths: 0 };

test('a blank chart fails even when its SVG container exists', () => {
  assert.throws(() => assertChartSnapshots([{ ...chart, marks: 0 }]), /Blank chart/);
  assert.throws(() => assertChartSnapshots([]), /Expected at least/);
});
test('missing titles and geographic data paths fail', () => {
  assert.throws(() => assertChartSnapshots([{ ...chart, renderedTitles: [] }]), /title not rendered/);
  assert.throws(() => assertChartSnapshots([chart], { map: true }), /Geographic data paths/);
});
test('page and console errors fail the same gate', () => {
  assert.throws(() => assertNoBrowserErrors(['pageerror: test failure']), /Browser errors/);
  assert.throws(() => assertNoBrowserErrors(['console: test failure']), /Browser errors/);
  assertNoBrowserErrors([]);
});
test('data marks and the declared title pass', () => assertChartSnapshots([chart], { titlesById: { example: ['Week'] } }));


test('another chart cannot supply a missing repeated title', () => {
  const first = { ...chart, id: 'first', declaredTitles: ['Rate per 100k'], renderedText: ['Rate per 100k'], renderedTitles: ['Rate per 100k'] };
  const second = { ...chart, id: 'second', declaredTitles: [], renderedText: [], renderedTitles: [] };
  assert.throws(() => assertChartSnapshots([first, second], {
    titlesById: { first: ['Rate per 100k'], second: ['Rate per 100k'] },
  }), /second.*Rate per 100k/);
});

test('a chart without hover cannot borrow another chart hover label', async () => {
  const mark = { scrollIntoViewIfNeeded: async () => {}, hover: async () => {} };
  const empty = { count: async () => 0 };
  const otherChartMarks = { count: async () => 1, nth: () => mark };
  const page = {
    locator: selector => selector.startsWith('[id=')
      ? { count: async () => 1, scrollIntoViewIfNeeded: async () => {}, locator: () => empty }
      : selector === '.hoverlayer text' ? { allTextContents: async () => ['Other chart hover'] } : otherChartMarks,
    waitForFunction: async () => {}, mouse: { move: async () => {} },
  };
  await assert.rejects(() => hoverChart(page, 'no-hover'), /no-hover/);
});

const assets = fileURLToPath(new URL('../frontend/dist/assets/', import.meta.url));

test('production styles contain no unused MapLibre styles', { skip: !existsSync(assets) }, () => {
  for (const file of readdirSync(assets).filter(name => name.endsWith('.css'))) {
    assert.doesNotMatch(readFileSync(`${assets}/${file}`, 'utf8'), /maplibre/i);
  }
});
