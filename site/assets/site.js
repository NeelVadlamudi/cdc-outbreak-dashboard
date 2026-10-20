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
    if (d.as_of) $("#as-of").textContent = `as of ${d.as_of}`;
    body.replaceChildren(el("div", { class: "metrics" }, ms.map((m) =>
      el("div", { class: "metric" },
        el("div", { class: "lab", text: m.label }),
        el("div", { class: "val" }, m.format === "pct" ? pct(m.value) : (Number.isInteger(m.value) ? int(m.value) : dec(m.value, m.decimals ?? 1)),
          m.unit && m.format !== "pct" ? el("span", { class: "unit", text: m.unit }) : null),
        m.change_text ? el("div", { class: "ch", text: m.change_text }) : null))));
  }

  /* (b) Eval table. Keys are exactly evals/run_evals.py summarize() output.
     Rates are already percentages 0-100 (1 dp): shown as given + "%". null => "Not run yet". */
  const asGiven = (v) => (isNum(v) ? String(v) : null);
  const pctGiven = (v) => (isNum(v) ? `${v.toFixed(1)}%` : null); // already 1 dp; toFixed only restores a trailing ".0"
  const EVAL_COLS = [
    ["questions", "Questions", asGiven, null],
    ["numeric_accuracy", "Numeric accuracy", pctGiven, "max"],
    ["tool_choice", "Tool choice", pctGiven, "max"],
    ["correct_refusals", "Correct refusals", pctGiven, "max"],
    ["false_refusals", "False refusals", pctGiven, "min"],
    ["grounded_answers", "Grounded answers", pctGiven, "max"],
    ["median_s", "Median time / answer", secsFmt, "min"],
    ["p95_s", "p95 time / answer", secsFmt, "min"],
    ["median_input_tokens", "Median input tokens", asGiven, "min"],
    ["median_output_tokens", "Median output tokens", asGiven, "min"],
  ];
  function secsFmt(v) { return isNum(v) ? fmtDuration(v * 1000) : null; }
  const evalCell = (s) => (s == null ? el("td", { class: "na", text: NOT_RUN }) : el("td", { text: s }));
  /* Eval: runs[] is appended on each rerun (oldest first). The latest run is the headline table;
     earlier runs are listed underneath as history. A computed change column appears only against the
     most recent earlier run with the same question set: same `questions` count and, if a question-set id
     key is present in both summaries, the same id. Never between different question sets. */
  const QSET_ID_KEYS = []; // run_evals.py summarize() has no question-set id today; add the key name here if bob adds one.
  const DELTA = {
    pct: (x) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(x).toFixed(1)} pp`,
    s: (x) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${fmtDuration(Math.abs(x) * 1000)}`,
    n: (x) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(x).toLocaleString("en-US")}`,
  };
  const KIND = { questions: "n", numeric_accuracy: "pct", tool_choice: "pct", correct_refusals: "pct", false_refusals: "pct",
    grounded_answers: "pct", median_s: "s", p95_s: "s", median_input_tokens: "n", median_output_tokens: "n" };
  function sameQuestionSet(a, b) {
    if (!isNum(a.questions) || a.questions !== b.questions) return false;
    for (const k of QSET_ID_KEYS) if (k in a || k in b) { if (a[k] == null || a[k] !== b[k]) return false; }
    return true;
  }
  const runLabel = (r) => [r.model, r.date].filter(Boolean).join(" · ");
  function renderEval(sec, d) {
    const body = $("[data-body]", sec);
    const runs = d && Array.isArray(d.runs) ? d.runs.filter((r) => r && r.model && r.summary && typeof r.summary === "object") : [];
    if (!runs.length) return notRun(body, "data/eval.json");
    const latest = runs[runs.length - 1], earlier = runs.slice(0, -1);
    let base = null;
    for (let i = earlier.length - 1; i >= 0; i--) if (sameQuestionSet(latest.summary, earlier[i].summary)) { base = earlier[i]; break; }
    const head = el("tr", {}, el("th", { scope: "col", text: "Score" }),
      el("th", { scope: "col" }, el("span", { class: "runhd", text: latest.model }), el("span", { class: "runsub", text: [latest.date, "latest run"].filter(Boolean).join(" · ") })),
      base ? el("th", { scope: "col", class: "delta-h" }, el("span", { class: "runhd", text: "Change · computed" }), el("span", { class: "runsub", text: `vs ${runLabel(base)}, same question set` })) : null);
    const rows = EVAL_COLS.map(([k, label, f]) => {
      const z = latest.summary[k], a = base ? base.summary[k] : null;
      const dc = !base ? null : isNum(a) && isNum(z)
        ? el("td", { class: "delta", title: "Computed: latest minus earlier run", text: DELTA[KIND[k]](Math.round((z - a) * 100) / 100) })
        : el("td", { class: "na", text: "—" });
      return el("tr", {}, el("th", { scope: "row", text: label }), evalCell(f(z)), dc);
    });
    const parts = [el("div", { class: "scroll" }, el("table", { class: "evalhist" }, el("thead", {}, head), el("tbody", {}, rows)))];
    if (earlier.length) {
      const hist = el("table", { class: "evalpast" },
        el("thead", {}, el("tr", {}, el("th", { scope: "col", text: "Earlier run" }), EVAL_COLS.map(([, h]) => el("th", { scope: "col", text: h })))),
        el("tbody", {}, [...earlier].reverse().map((r) => el("tr", {}, el("td", { text: runLabel(r) }), EVAL_COLS.map(([k, , f]) => evalCell(f(r.summary[k])))))));
      parts.push(el("h3", { class: "subhead", text: `History · ${earlier.length} earlier run${earlier.length === 1 ? "" : "s"}` }), el("div", { class: "scroll" }, hist));
    }
    if (base) parts.push(el("div", { class: "meta" }, el("span", { class: "chip", text: "pp = percentage points" })));
    body.replaceChildren(...parts);
  }

  /* (c) Backtest chart: MAE and WMAPE per model across horizons 1–4 */
  /* evals/backtest.py names each entry "<Model> · <Target>" and scores a "Last value" baseline
     on the same origins. The site groups by target and compares each model with that baseline per
     horizon (a comparison only; no value is computed). Values are shown exactly as given. */
  const BASELINE = "Last value";
  const SEP = " · ";
  // Orange is reserved for "beats the baseline", so model lines stay neutral.
  const MODEL_STYLE = { [BASELINE]: { stroke: "#6b6b70", dash: "4 4" }, LSTM: { stroke: "#ededed" }, XGBoost: { stroke: "#a9b8c6" } };
  const EXTRA = ["#c7c7cc", "#7d8a96", "#d9d0c1"];
  function splitModel(name) {
    const i = name.lastIndexOf(SEP);
    return i > 0 ? { model: name.slice(0, i), target: name.slice(i + SEP.length) } : { model: name, target: "" };
  }
  const maeTxt = (v) => (isNum(v) ? String(v) : null);
  const wmTxt = (v) => (isNum(v) ? `${(v * 100).toFixed(1)}%` : null);
  function lineChart(title, series, key, fmt) {
    const W = 520, H = 170, L = 46, R = 10, T = 10, B = 24, hs = [1, 2, 3, 4];
    const vals = series.flatMap((m) => m.horizons.map((h) => h[key])).filter(isNum);
    const wrap = el("div", { class: "chart" }, el("h3", { text: title }));
    if (!vals.length) { wrap.append(el("div", { class: "empty", text: NOT_RUN })); return wrap; }
    const ymax = (Math.max(...vals) || 1) * 1.1;
    const x = (h) => L + ((h - 1) / 3) * (W - L - R), y = (v) => T + (1 - v / ymax) * (H - T - B);
    const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${title} by horizon` });
    for (let i = 0; i <= 3; i++) {
      const v = (ymax * i) / 3, yy = y(v);
      svg.append(sv("line", { x1: L, x2: W - R, y1: yy, y2: yy, stroke: "rgba(255,255,255,.08)" }));
      const t = sv("text", { x: L - 6, y: yy + 4, "text-anchor": "end", fill: "#6b6b70", "font-size": 10, "font-family": "Geist Mono, monospace" }); t.textContent = fmt(v); svg.append(t);
    }
    for (const h of hs) { const t = sv("text", { x: x(h), y: H - 6, "text-anchor": "middle", fill: "#9a9a9f", "font-size": 10, "font-family": "Geist Mono, monospace" }); t.textContent = `h${h}`; svg.append(t); }
    series.forEach((m) => {
      const st = m.style;
      const pts = m.horizons.filter((p) => hs.includes(p.h) && isNum(p[key])).sort((a, b) => a.h - b.h);
      if (pts.length > 1) svg.append(sv("polyline", { points: pts.map((p) => `${x(p.h)},${y(p[key])}`).join(" "), fill: "none", stroke: st.stroke, "stroke-width": 1.6, ...(st.dash ? { "stroke-dasharray": st.dash } : {}) }));
      for (const p of pts) { const c = sv("circle", { cx: x(p.h), cy: y(p[key]), r: 2.6, fill: st.stroke }); const tt = sv("title"); tt.textContent = `${m.name} · h${p.h} · ${key === "mae" ? maeTxt(p[key]) : wmTxt(p[key])}`; c.append(tt); svg.append(c); }
    });
    wrap.append(svg);
    return wrap;
  }
  function renderBacktest(sec, d) {
    const body = $("[data-body]", sec);
    const models = d && Array.isArray(d.models) ? d.models.filter((m) => m && m.model && Array.isArray(m.horizons)) : [];
    if (!models.length) return notRun(body, "data/backtest.json");
    const groups = new Map();
    let extra = 0;
    for (const m of models) {
      const { model, target } = splitModel(m.model);
      if (!groups.has(target)) groups.set(target, []);
      const style = MODEL_STYLE[model] || (MODEL_STYLE[model] = { stroke: EXTRA[extra++ % EXTRA.length] });
      groups.get(target).push({ ...m, name: model, full: m.model, style });
    }
    const at = (m, h) => m.horizons.find((q) => q.h === h) || {};
    const panels = [...groups].map(([target, ms]) => {
      const base = ms.find((m) => m.name === BASELINE) || null;
      const cmpCell = (m, h, key, txt) => {
        const v = at(m, h)[key];
        const c = cell(txt(v));
        if (base && m !== base && isNum(v)) {
          const bv = at(base, h)[key];
          if (isNum(bv)) {
            if (v < bv) { c.classList.add("beats"); c.title = `Lower ${key.toUpperCase()} than ${BASELINE} (${txt(bv)})`; c.append(el("span", { class: "mark", text: " ▼" })); }
            else { c.classList.add("loses"); c.title = `${v === bv ? "Ties" : "Higher than"} ${BASELINE} (${txt(bv)})`; }
          }
        }
        if (m === base) c.classList.add("base");
        return c;
      };
      const table = el("table", { class: "bt" },
        el("thead", {}, el("tr", {}, el("th", { text: "Model" }), [1, 2, 3, 4].map((h) => el("th", { text: `MAE h${h}` })), [1, 2, 3, 4].map((h) => el("th", { text: `WMAPE h${h}` })))),
        el("tbody", {}, ms.map((m) => el("tr", { "data-model": m.full, class: m === base ? "baserow" : null },
          el("td", { text: m === base ? `${m.name} (baseline)` : m.name }),
          [1, 2, 3, 4].map((h) => cmpCell(m, h, "mae", maeTxt)), [1, 2, 3, 4].map((h) => cmpCell(m, h, "wmape", wmTxt))))));
      const legend = el("div", { class: "legend" }, ms.map((m) => { const sw = el("i"); sw.style.background = m.style.stroke; if (m.style.dash) sw.classList.add("dash"); return el("span", {}, sw, m === base ? `${m.name} (baseline)` : m.name); }));
      return el("div", { class: "btgroup" },
        el("h3", { class: "subhead", text: target || "All" }),
        el("div", { class: "charts" }, lineChart("MAE", ms, "mae", (v) => (v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2))), lineChart("WMAPE", ms, "wmape", (v) => `${(v * 100).toFixed(0)}%`)),
        legend, el("div", { class: "scroll" }, table));
    });
    const meta = [];
    if (d.target) meta.push(el("span", { class: "chip", text: d.target }));
    if (d.mae_unit) meta.push(el("span", { class: "chip", text: `MAE in ${d.mae_unit}` }));
    if (isNum(d.n_origins)) meta.push(el("span", { class: "chip", text: `${int(d.n_origins)} forecast origins` }));
    const hasBase = [...groups.values()].some((ms) => ms.some((m) => m.name === BASELINE));
    const key = hasBase ? el("p", { class: "note btkey" }, el("span", { class: "beats", text: "▼ orange" }), ` = lower error than the ${BASELINE} baseline at that horizon. Grey = same or higher. Values as recorded; nothing is computed.`) : null;
    const notes = Array.isArray(d.notes) ? d.notes.filter((n) => typeof n === "string" && n) : [];
    const noteList = notes.length ? el("ul", { class: "bt-notes" }, notes.map((n) => el("li", { text: n }))) : "";
    body.replaceChildren(noteList, key || "", ...panels, meta.length ? el("div", { class: "meta" }, meta) : "");
  }

  /* (d) Replay of recorded answers. Each item: { question, response: <POST /api/agent/ask body>, correct? } */
  function fmtInputs(i) { if (i == null) return ""; if (typeof i !== "object") return String(i); return Object.entries(i).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(", "); }
  const secs = (s) => (isNum(s) ? fmtDuration(s * 1000) : null);
  function outputRows(rows) {
    if (!Array.isArray(rows) || !rows.length) return null;
    const cols = [...new Set(rows.flatMap((r) => (r && typeof r === "object" ? Object.keys(r) : [])))];
    return el("details", { class: "out" }, el("summary", { text: `output rows (${int(rows.length)})` }),
      el("div", { class: "scroll" }, el("table", {},
        el("thead", {}, el("tr", {}, cols.map((c) => el("th", { text: c })))),
        el("tbody", {}, rows.map((r) => el("tr", {}, cols.map((c) => cell(r?.[c] == null ? null : String(r[c])))))))));
  }
  function renderReplay(sec, d) {
    const body = $("[data-body]", sec);
    const items = d && Array.isArray(d.answers) ? d.answers.filter((a) => a && a.response && typeof a.response.answer === "string") : [];
    if (!items.length) return notRun(body, "data/replay.json");
    body.replaceChildren(el("div", { class: "replay" }, items.map((it) => {
      const a = it.response;
      const flagged = a.status === "refused" || a.status === "unverified";
      const calls = Array.isArray(a.tool_calls) ? a.tool_calls : [];
      const meta = [];
      meta.push(el("span", { class: "chip", text: a.as_of ? `as of ${a.as_of}` : "no data date" }));
      const took = secs(a.elapsed_s); if (took) meta.push(el("span", { class: "chip", text: `took ${took}` }));
      if (a.model) meta.push(el("span", { class: "chip", text: a.model }));
      const stale = a.checker && Array.isArray(a.checker.stale_tables) ? a.checker.stale_tables : [];
      if (stale.length) meta.push(el("span", { class: "chip", text: `stale: ${stale.join(", ")}` }));
      if (typeof it.correct === "boolean") meta.push(el("span", { class: it.correct ? "chip acc" : "chip", text: it.correct ? "graded correct" : "graded wrong" }));
      return el("article", { class: flagged ? "qa refused" : "qa" },
        it.question ? el("div", { class: "q", text: it.question }) : null,
        flagged ? el("div", { class: "flag", text: a.status === "unverified" ? "Could not verify" : "Declined to answer" }) : null,
        el("div", { class: "a", text: a.answer }),
        el("div", { class: "meta" }, meta),
        calls.length ? el("details", {}, el("summary", { text: `${calls.length} tool call${calls.length === 1 ? "" : "s"}` }),
          el("ol", { class: "calls" }, calls.map((c) => {
            const o = c.output && typeof c.output === "object" ? c.output : {};
            const facts = [isNum(c.rows_returned) ? `${int(c.rows_returned)} row${c.rows_returned === 1 ? "" : "s"} returned` : "rows not reported"];
            const t = secs(c.elapsed_s); if (t) facts.push(t);
            if (o.source_table) facts.push(`table ${o.source_table}`);
            if (o.units) facts.push(o.units);
            if (o.error) facts.push(`error: ${o.error}`);
            return el("li", {}, el("code", { text: c.tool || "unknown" }), " ",
              el("span", { class: "in", text: fmtInputs(c.inputs) || "no inputs" }),
              el("div", { class: "facts", text: facts.join(" · ") }), outputRows(o.rows));
          }))) : el("div", { class: "meta" }, el("span", { class: "chip", text: "no tool calls" })));
    })));
  }

  /* (e) Try it live */
  function renderLive(sec, d) {
    // Hidden unless live.json is listed in index.json and holds an https URL.
    const url = d && typeof d.url === "string" && /^https:\/\//.test(d.url) ? d.url : null;
    if (!url) { sec.hidden = true; return; }
    $("[data-body]", sec).replaceChildren(
      el("p", { class: "note", text: "Opens the hosted agent. It sleeps when idle, so the first question can be slow." }),
      el("a", { class: "btn", href: url, rel: "noopener" }, el("span", { text: "Try it live" }), el("small", { text: "may take a minute to wake" })));
    sec.hidden = false;
  }

  /* Freshness strip: only dates that exist in the data. Staleness only from the data's own flags
     (get_data_freshness rows[].stale, checker.stale_tables); no thresholds here. */
  function renderFreshness(dash, replay) {
    const strip = $("#freshness");
    const items = new Map(); // table -> {date, stale}
    const answers = replay && Array.isArray(replay.answers) ? replay.answers : [];
    const staleFlag = new Set();
    let fresh = null;
    for (const it of answers) {
      const r = it && it.response; if (!r) continue;
      for (const t of (r.checker && Array.isArray(r.checker.stale_tables) ? r.checker.stale_tables : [])) staleFlag.add(t);
      for (const c of Array.isArray(r.tool_calls) ? r.tool_calls : []) {
        const o = c && c.output; if (!o) continue;
        if (c.tool === "get_data_freshness" && Array.isArray(o.rows)) fresh = o.rows; // last recorded wins
        else if (o.source_table && o.source_table !== "all" && typeof o.as_of === "string") {
          const prev = items.get(o.source_table);
          if (!prev || o.as_of > prev.date) items.set(o.source_table, { table: o.source_table, date: o.as_of, stale: false, legacy: false });
        }
      }
    }
    if (fresh) {
      items.clear();
      // get_data_freshness can return one row per wastewater dataset; key by table + dataset so none overwrite each other.
      for (const row of fresh) if (row && row.table) {
        const label = row.dataset ? `${row.table} · ${row.dataset}` : row.table;
        items.set(label, { table: row.table, date: typeof row.latest_week === "string" ? row.latest_week : null, stale: row.stale === true, legacy: row.legacy === true });
      }
    }
    for (const t of staleFlag) {
      const hits = [...items.values()].filter((v) => v.table === t && !v.legacy);
      if (hits.length) hits.forEach((v) => (v.stale = true)); else items.set(t, { table: t, date: null, stale: true, legacy: false });
    }
    const chips = [];
    if (dash && typeof dash.as_of === "string") chips.push(el("span", { class: "chip" }, "dashboard ", el("b", { text: dash.as_of })));
    for (const [t, v] of [...items].sort((x, y) => (x[1].legacy - y[1].legacy) || x[0].localeCompare(y[0])))
      chips.push(el("span", { class: v.legacy ? "chip legacy" : v.stale ? "chip stale" : "chip" }, `${t} `, el("b", { text: v.date ?? "no data" }), v.stale ? " · stale" : ""));
    if (!chips.length) { strip.hidden = true; return; }
    const rec = replay && replay.recorded_at ? ` (from answers recorded ${fmtDate(replay.recorded_at)})` : "";
    strip.replaceChildren(el("span", { class: "fr-lab", text: "Data as of" }), ...chips, fresh || staleFlag.size ? el("span", { class: "fr-note", text: `Stale flags come from the agent's own checks${rec}.` }) : "");
    strip.hidden = false;
  }

  const SECTIONS = [["dashboard", "#sec-dashboard", renderDashboard], ["eval", "#sec-eval", renderEval], ["backtest", "#sec-backtest", renderBacktest], ["replay", "#sec-replay", renderReplay], ["live", "#sec-live", renderLive]];
  Promise.all([load("dashboard"), load("replay")]).then(([dsh, rp]) => renderFreshness(dsh, rp)).catch(() => { $("#freshness").hidden = true; });
  for (const [name, sel, fn] of SECTIONS) {
    const sec = $(sel);
    load(name).then((d) => { if (name !== "live") stamp(sec, d); try { fn(sec, d); } catch (e) { notRun($("[data-body]", sec), `data/${name}.json could not be read`); console.warn(e); } });
  }
})();
