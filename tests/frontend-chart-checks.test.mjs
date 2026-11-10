import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertChartSnapshots, assertNoBrowserErrors } from '../scripts/chart_checks.mjs';

const chart = { svg: true, marks: 3, hasData: true, stringTitles: [], declaredTitles: ['Week'], renderedText: ['Week'], mapPaths: 0 };

test('a blank chart fails even when its SVG container exists', () => {
  assert.throws(() => assertChartSnapshots([{ ...chart, marks: 0 }]), /Blank chart/);
  assert.throws(() => assertChartSnapshots([]), /Expected at least/);
});
test('missing titles and geographic data paths fail', () => {
  assert.throws(() => assertChartSnapshots([{ ...chart, renderedText: [] }]), /title not rendered/);
  assert.throws(() => assertChartSnapshots([chart], { map: true }), /Geographic data paths/);
});
test('page and console errors fail the same gate', () => {
  assert.throws(() => assertNoBrowserErrors(['pageerror: test failure']), /Browser errors/);
  assert.throws(() => assertNoBrowserErrors(['console: test failure']), /Browser errors/);
  assertNoBrowserErrors([]);
});
test('data marks and the declared title pass', () => assertChartSnapshots([chart], { titles: ['Week'] }));
