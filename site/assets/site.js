/* CDC Outbreak Agent — static site. Every number comes from data/*.json.
   Missing/invalid file => "Not run yet". Nothing is estimated or filled in. */
"use strict";
(function () {
  const NOT_RUN = "Not run yet";
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else n.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  };
  const SVG = "http://www.w3.org/2000/svg";
  const sv = (tag, attrs = {}) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);

  /* data/index.json lists which files exist, so missing sections don't 404 in the console. */
  let manifest = null;
  async function getManifest() {
    if (!manifest) manifest = fetch("data/index.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    return manifest;
  }
  async function load(name) {
    const m = await getManifest();
    if (!m || !Array.isArray(m.available) || !m.available.includes(name)) return null;
    try {
      const r = await fetch(`data/${name}.json`, { cache: "no-cache" });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }
  function notRun(body, detail) {
    body.replaceChildren(el("div", { class: "empty", role: "status" }, NOT_RUN, detail ? ` · ${detail}` : ""));
  }
  function stamp(sec, d) {
    const c = $("[data-stamp]", sec); if (!c) return;
    const t = d && (d.generated_at || d.run_at || d.recorded_at);
    c.textContent = t ? fmtDate(t) : NOT_RUN;
  }
  function fmtDate(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" });
  }

  /* Durations: two largest non-zero units. */
  function fmtDuration(ms) {
    if (!isNum(ms) || ms < 0) return null;
    if (ms < 1000) return `${Math.round(ms)} ms`;
    const s1 = Math.round(ms / 100) / 10;
    if (s1 < 60) return `${s1 % 1 === 0 ? s1.toFixed(0) : s1.toFixed(1)} s`;
    let rest = Math.round(ms / 1000); const parts = [];
    for (const [l, z] of [["d", 86400], ["h", 3600], ["min", 60], ["s", 1]]) { const n = Math.floor(rest / z); rest -= n * z; if (n) parts.push(`${n} ${l}`); }
    return parts.slice(0, 2).join(" ");
  }
  const pct = (v) => (isNum(v) ? `${(v * 100).toFixed(1)}%` : null);
  const int = (v) => (isNum(v) ? Math.round(v).toLocaleString("en-US") : null);
  const dec = (v, d = 2) => (isNum(v) ? v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : null);
  const cell = (s) => (s == null ? el("td", { class: "na", text: "—" }) : el("td", { text: s }));

  /* (a) Dashboard */
  function renderDashboard(sec, d) {
    const body = $("[data-body]", sec);
    const ms = d && Array.isArray(d.metrics) ? d.metrics.filter((m) => m && m.label && isNum(m.value)) : [];
    if (!ms.length) return notRun(body, "data/dashboard.json");
    if (d.as_of_week) $("#as-of").textContent = `as of ${d.as_of_week}`;
    body.replaceChildren(el("div", { class: "metrics" }, ms.map((m) =>
      el("div", { class: "metric" },
        el("div", { class: "lab", text: m.label }),
        el("div", { class: "val" }, m.format === "pct" ? pct(m.value) : (Number.isInteger(m.value) ? int(m.value) : dec(m.value, m.decimals ?? 1)),
          m.unit && m.format !== "pct" ? el("span", { class: "unit", text: m.unit }) : null),
        m.change_text ? el("div", { class: "ch", text: m.change_text }) : null))));
  }

  /* (b) Eval table */
  const EVAL_COLS = [
    ["numeric_accuracy", "Numeric accuracy", pct, "max"],
    ["tool_choice", "Tool choice", pct, "max"],
    ["correct_refusals", "Correct refusals", pct, "max"],
    ["false_refusals", "False refusals", pct, "min"],
    ["grounded", "Grounded answers", pct, "max"],
    ["checker_catches", "Checker catches", int, null],
    ["ms_per_answer", "Time / answer", fmtDuration, "min"],
    ["tokens_per_answer", "Tokens / answer", int, "min"],
  ];
  function renderEval(sec, d) {
    const body = $("[data-body]", sec);
    const rows = d && Array.isArray(d.rows) ? d.rows.filter((r) => r && r.model) : [];
    if (!rows.length) return notRun(body, "data/eval.json");
    const best = {};
    for (const [k, , , dir] of EVAL_COLS) {
      if (!dir || rows.length < 2) continue;
      const vals = rows.map((r) => r[k]).filter(isNum);
      if (vals.length) best[k] = dir === "max" ? Math.max(...vals) : Math.min(...vals);
    }
    const table = el("table", {},
      el("thead", {}, el("tr", {}, el("th", { scope: "col", text: "Model" }), EVAL_COLS.map(([, h]) => el("th", { scope: "col", text: h })))),
      el("tbody", {}, rows.map((r) => el("tr", {}, el("td", { text: r.model }),
        EVAL_COLS.map(([k, , f]) => { const c = cell(f(r[k])); if (isNum(r[k]) && best[k] === r[k]) c.classList.add("best"); return c; })))));
    const meta = [];
    if (isNum(d.n_questions)) meta.push(el("span", { class: "chip", text: `${int(d.n_questions)} questions` }));
    if (d.dataset_version) meta.push(el("span", { class: "chip", text: d.dataset_version }));
    body.replaceChildren(el("div", { class: "scroll" }, table), meta.length ? el("div", { class: "meta" }, meta) : "");
  }

  /* (c) Backtest chart: MAE and WMAPE per model across horizons 1–4 */
  const PALETTE = ["#f39444", "#ededed", "#8a8a90", "#5c5c62", "#c7c7cc"];
  function lineChart(title, models, key, fmt) {
    const W = 560, H = 220, L = 52, R = 14, T = 12, B = 30;
    const hs = [1, 2, 3, 4];
    const vals = models.flatMap((m) => m.horizons.map((h) => h[key])).filter(isNum);
    const wrap = el("div", { class: "chart" }, el("h3", { text: title }));
    if (!vals.length) { wrap.append(el("div", { class: "empty", text: NOT_RUN })); return wrap; }
    const max = Math.max(...vals) || 1, ymax = max * 1.1;
    const x = (h) => L + ((h - 1) / 3) * (W - L - R);
    const y = (v) => T + (1 - v / ymax) * (H - T - B);
    const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${title} by horizon` });
    for (let i = 0; i <= 4; i++) {
      const v = (ymax * i) / 4, yy = y(v);
      svg.append(sv("line", { x1: L, x2: W - R, y1: yy, y2: yy, stroke: "rgba(255,255,255,.08)" }));
      const t = sv("text", { x: L - 8, y: yy + 4, "text-anchor": "end", fill: "#6b6b70", "font-size": 11, "font-family": "Geist Mono, monospace" }); t.textContent = fmt(v); svg.append(t);
    }
    for (const h of hs) { const t = sv("text", { x: x(h), y: H - 8, "text-anchor": "middle", fill: "#9a9a9f", "font-size": 11, "font-family": "Geist Mono, monospace" }); t.textContent = `h${h}`; svg.append(t); }
    models.forEach((m, i) => {
      const col = PALETTE[i % PALETTE.length];
      const pts = m.horizons.filter((p) => hs.includes(p.h) && isNum(p[key])).sort((a, b) => a.h - b.h);
      if (pts.length > 1) svg.append(sv("polyline", { points: pts.map((p) => `${x(p.h)},${y(p[key])}`).join(" "), fill: "none", stroke: col, "stroke-width": 1.6 }));
      for (const p of pts) { const c = sv("circle", { cx: x(p.h), cy: y(p[key]), r: 3, fill: col }); const tt = sv("title"); tt.textContent = `${m.model} · h${p.h} · ${fmt(p[key])}`; c.append(tt); svg.append(c); }
    });
    wrap.append(svg);
    return wrap;
  }
  function renderBacktest(sec, d) {
    const body = $("[data-body]", sec);
    const models = d && Array.isArray(d.models) ? d.models.filter((m) => m && m.model && Array.isArray(m.horizons)) : [];
    if (!models.length) return notRun(body, "data/backtest.json");
    const legend = el("div", { class: "legend" }, models.map((m, i) => { const sw = el("i"); sw.style.background = PALETTE[i % PALETTE.length]; return el("span", {}, sw, m.model); }));
    const fmtMae = (v) => (v >= 100 ? int(v) : dec(v, v >= 10 ? 1 : 2));
    const table = el("table", {},
      el("thead", {}, el("tr", {}, el("th", { text: "Model" }), [1, 2, 3, 4].flatMap((h) => [el("th", { text: `MAE h${h}` }), el("th", { text: `WMAPE h${h}` })]))),
      el("tbody", {}, models.map((m) => el("tr", {}, el("td", { text: m.model }), [1, 2, 3, 4].flatMap((h) => {
        const p = m.horizons.find((q) => q.h === h) || {};
        return [cell(isNum(p.mae) ? fmtMae(p.mae) : null), cell(pct(p.wmape))];
      })))));
    const meta = [];
    if (d.target) meta.push(el("span", { class: "chip", text: d.target }));
    if (d.mae_unit) meta.push(el("span", { class: "chip", text: `MAE in ${d.mae_unit}` }));
    if (isNum(d.n_origins)) meta.push(el("span", { class: "chip", text: `${int(d.n_origins)} forecast origins` }));
    body.replaceChildren(el("div", { class: "charts" }, lineChart("MAE", models, "mae", fmtMae), lineChart("WMAPE", models, "wmape", (v) => `${(v * 100).toFixed(0)}%`)),
      legend, el("details", {}, el("summary", { text: "Show numbers" }), el("div", { class: "scroll" }, table)), meta.length ? el("div", { class: "meta" }, meta) : "");
  }

  /* (d) Replay of recorded answers — same shape as POST /api/agent/ask */
  function fmtInputs(i) { if (i == null) return ""; if (typeof i !== "object") return String(i); return Object.entries(i).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(", "); }
  function renderReplay(sec, d) {
    const body = $("[data-body]", sec);
    const items = d && Array.isArray(d.answers) ? d.answers.filter((a) => a && typeof a.answer === "string") : [];
    if (!items.length) return notRun(body, "data/replay.json");
    body.replaceChildren(el("div", { class: "replay" }, items.map((a) => {
      const refused = a.status === "refused" || a.status === "unverified";
      const calls = Array.isArray(a.tool_calls) ? a.tool_calls : [];
      const meta = [];
      if (a.as_of_week) meta.push(el("span", { class: "chip", text: `as of ${a.as_of_week}` }));
      const took = fmtDuration(a.elapsed_ms); if (took) meta.push(el("span", { class: "chip", text: `took ${took}` }));
      if (typeof a.correct === "boolean") meta.push(el("span", { class: a.correct ? "chip acc" : "chip", text: a.correct ? "graded correct" : "graded wrong" }));
      return el("article", { class: refused ? "qa refused" : "qa" },
        a.question ? el("div", { class: "q", text: a.question }) : null,
        refused ? el("div", { class: "flag", text: a.status === "unverified" ? "Could not verify" : "Declined to answer" }) : null,
        el("div", { class: "a", text: a.answer }),
        meta.length ? el("div", { class: "meta" }, meta) : null,
        calls.length ? el("details", {}, el("summary", { text: `${calls.length} tool call${calls.length === 1 ? "" : "s"}` }),
          el("ol", { class: "calls" }, calls.map((c) => el("li", {}, el("code", { text: c.tool || "unknown" }), " ",
            el("span", { class: "in", text: fmtInputs(c.inputs) || "no inputs" }), " · ",
            isNum(c.rows) ? `${int(c.rows)} row${c.rows === 1 ? "" : "s"}` : "rows not reported",
            isNum(c.ms) ? ` · ${fmtDuration(c.ms)}` : "")))) : el("div", { class: "meta" }, el("span", { class: "chip", text: "no tool calls" })));
    })));
  }

  /* (e) Try it live */
  function renderLive(sec, d) {
    const body = $("[data-body]", sec);
    const url = d && typeof d.url === "string" && /^https:\/\//.test(d.url) ? d.url : null;
    const label = el("span", { text: "Try it live" }), small = el("small", { text: "may take a minute to wake" });
    const btn = url ? el("a", { class: "btn", href: url, rel: "noopener" }, label, small)
      : el("a", { class: "btn", "aria-disabled": "true", role: "link" }, label, el("small", { text: `may take a minute to wake · ${NOT_RUN}` }));
    body.replaceChildren(el("p", { class: "note", text: "Opens the hosted agent. It sleeps when idle, so the first question can be slow." }), btn);
  }

  const SECTIONS = [["dashboard", "#sec-dashboard", renderDashboard], ["eval", "#sec-eval", renderEval], ["backtest", "#sec-backtest", renderBacktest], ["replay", "#sec-replay", renderReplay], ["live", "#sec-live", renderLive]];
  for (const [name, sel, fn] of SECTIONS) {
    const sec = $(sel);
    load(name).then((d) => { if (name !== "live") stamp(sec, d); try { fn(sec, d); } catch (e) { notRun($("[data-body]", sec), `data/${name}.json could not be read`); console.warn(e); } });
  }
})();
