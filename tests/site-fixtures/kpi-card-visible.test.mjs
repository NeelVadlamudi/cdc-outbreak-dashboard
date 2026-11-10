import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { visibleCaptionText, wowLine } from "../../frontend/src/lib/metricCardText.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const siteSrc = readFileSync(resolve(repo, "site/assets/site.js"), "utf8");
const overviewSrc = readFileSync(resolve(repo, "frontend/src/pages/Overview.jsx"), "utf8");
const dashboard = JSON.parse(readFileSync(resolve(repo, "site/data/dashboard.json"), "utf8"));

const SEP = " · ";

function countOccurrences(text, snippet) {
  if (!text || !snippet) return 0;
  let n = 0;
  let i = 0;
  while ((i = text.indexOf(snippet, i)) !== -1) {
    n += 1;
    i += snippet.length;
  }
  return n;
}

function siteRendererCaption(metric) {
  // Mirrors site/assets/site.js card captions (must stay in sync with the live renderer).
  const usesLegacyInsight = /m\.insight\s*&&\s*m\.insight\s*!==\s*m\.plain/.test(siteSrc);
  const lines = [];
  if (metric.plain) lines.push(metric.plain);
  if (usesLegacyInsight) {
    if (metric.insight && metric.insight !== metric.plain) lines.push(metric.insight);
  } else if (wowLine(metric)) {
    lines.push(wowLine(metric));
  }
  return lines.join("\n");
}

function appRendererCaption(metric) {
  // Mirrors Overview.jsx MetricCard captions (must stay in sync with the live renderer).
  const usesLegacyInsight = /metric\.insight\s*&&\s*metric\.insight\s*!==\s*plain/.test(overviewSrc);
  const legacyPlainFallback = /metric\?\.plain\s*\|\|\s*metric\?\.insight/.test(overviewSrc);
  const lines = [];
  const plain = legacyPlainFallback
    ? (metric.plain || metric.insight || null)
    : (metric.plain || null);
  if (plain) lines.push(plain);
  if (usesLegacyInsight) {
    if (metric.insight && metric.insight !== plain) lines.push(metric.insight);
  } else if (wowLine(metric)) {
    lines.push(wowLine(metric));
  }
  return lines.join("\n");
}

describe("KPI card visible text", () => {
  test("static site renderer does not print plain twice", () => {
    const withPlain = dashboard.metrics.filter((m) => m.plain);
    assert.ok(withPlain.length > 0);
    for (const metric of withPlain) {
      const text = siteRendererCaption(metric);
      assert.equal(
        countOccurrences(text, metric.plain),
        1,
        `${metric.id} static site text repeats plain: ${JSON.stringify(text)}`,
      );
    }
  });

  test("app Overview renderer does not print plain twice", () => {
    const withPlain = dashboard.metrics.filter((m) => m.plain);
    assert.ok(withPlain.length > 0);
    for (const metric of withPlain) {
      const text = appRendererCaption(metric);
      assert.equal(
        countOccurrences(text, metric.plain),
        1,
        `${metric.id} app Overview text repeats plain: ${JSON.stringify(text)}`,
      );
    }
  });

  test("fallback splits published insight when wow is missing", () => {
    const oldShape = {
      plain: "about 1 in 29 tests positive",
      insight: "about 1 in 29 tests positive · unchanged from last week",
    };
    assert.equal(wowLine(oldShape), "unchanged from last week");
    const text = visibleCaptionText(oldShape);
    assert.equal(text, "about 1 in 29 tests positive\nunchanged from last week");
    assert.equal(countOccurrences(text, oldShape.plain), 1);
    assert.ok(!text.includes(SEP));

    const covid = dashboard.metrics.find((m) => m.id === "positivity_covid19");
    assert.ok(covid);
    assert.ok(!covid.wow, "committed dashboard.json has no wow until the next nightly");
    assert.equal(wowLine(covid), "unchanged from last week");
    assert.equal(countOccurrences(visibleCaptionText(covid), covid.plain), 1);

    const noMatch = { plain: "about 1 in 29 tests positive", insight: "something else" };
    assert.equal(wowLine(noMatch), null);
    assert.equal(visibleCaptionText(noMatch), "about 1 in 29 tests positive");

    const explicit = { plain: "about 1 in 11 tests positive", wow: "up from 7.7% last week", insight: "ignored · combined" };
    assert.equal(wowLine(explicit), "up from 7.7% last week");
  });

  test("change line is separate from the sentence", () => {
    const text = visibleCaptionText({
      plain: "about 1 in 29 tests positive",
      insight: "about 1 in 29 tests positive · unchanged from last week",
    });
    const lines = text.split("\n");
    assert.equal(lines[0], "about 1 in 29 tests positive");
    assert.equal(lines[1], "unchanged from last week");
  });
});
