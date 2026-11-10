/** Week-over-week caption for a KPI card.

Published dashboard.json (and other already-released assets) may only have
`insight` in the old "plain · wow" shape until the next nightly. Prefer the
dedicated `wow` field when present.
*/
const SEP = " · ";

export function wowLine(metric) {
  if (!metric || typeof metric !== "object") return null;
  if (typeof metric.wow === "string" && metric.wow) return metric.wow;
  const plain = typeof metric.plain === "string" ? metric.plain : null;
  const insight = typeof metric.insight === "string" ? metric.insight : null;
  if (plain && insight && insight.startsWith(plain + SEP)) {
    const rest = insight.slice(plain.length + SEP.length);
    return rest || null;
  }
  return null;
}

export function visibleCaptionText(metric) {
  const plain = typeof metric?.plain === "string" && metric.plain ? metric.plain : null;
  const wow = wowLine(metric);
  return [plain, wow].filter(Boolean).join("\n");
}
