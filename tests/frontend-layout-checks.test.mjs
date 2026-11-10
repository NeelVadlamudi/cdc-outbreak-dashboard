import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertMobileLayout, assertScrollableTable } from '../scripts/layout_checks.mjs';

const clean = { outsideViewport: [], wideContainers: [], overflowingElements: [], invalidScrollports: [] };
test('hidden body overflow does not excuse an off-screen element', () => {
  assert.throws(() => assertMobileLayout({ ...clean, width: 390,
    outsideViewport: [{ element: '.slider-value', right: 457 }] }), /past the viewport/);
});
test('main container clipping fails independently of document width', () => {
  assert.throws(() => assertMobileLayout({ ...clean,
    wideContainers: [{ element: '.card', clientWidth: 358, scrollWidth: 440 }] }), /conceal overflow/);
});
test('an accessible table scrollport passes without widening its page', () => {
  assertMobileLayout(clean);
  assertScrollableTable({ exists: true, overflowX: 'auto', clientWidth: 312, scrollWidth: 470,
    scrollLeft: 158, lastColumnVisible: true });
});
test('a missing or unreachable table scrollport fails', () => {
  assert.throws(() => assertScrollableTable({ exists: false }), /horizontal scrollport/);
  assert.throws(() => assertScrollableTable({ exists: true, overflowX: 'auto', clientWidth: 312,
    scrollWidth: 470, scrollLeft: 0, lastColumnVisible: false }), /final rate column/);
});

test('a small badge concealing long text fails even inside the viewport', () => {
  assert.throws(() => assertMobileLayout({ ...clean,
    overflowingElements: [{ element: '.status-badge', clientWidth: 240, scrollWidth: 950 }] }), /conceal horizontal content/);
});
test('a marker without a usable horizontal scrollport fails', () => {
  assert.throws(() => assertMobileLayout({ ...clean,
    invalidScrollports: [{ element: '#clipped', overflowX: 'hidden', scrollLeft: 0 }] }), /not usable horizontal scrollports/);
});
