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
  const QSET_ID_KEYS = ["question_set"]; // summarize() in run_evals.py writes the question-set id under this key.
  const DELTA = {
    pct: (x) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(x).toFixed(1)} pp`,
    s: (x) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${fmtDuration(Math.abs(x) * 1000)}`,
    n: (x) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(x).toLocaleString("en-US")}`,
  };
  const KIND = { questions: "n", numeric_accuracy: "pct", tool_choice: "pct", correct_refusals: "pct", false_refusals: "pct",
    grounded_answers: "pct", median_s: "s", p95_s: "s", median_input_tokens: "n", median_output_tokens: "n",
    overall_correct: "pct", case_and_step: "pct", proposal_accuracy: "pct", unrequested_proposals: "pct", blocked_proposals: "n" };
  // Question-set id wins; the questions count is only the fallback when neither summary carries an id.
  function sameQuestionSet(a, b) {
    for (const k of QSET_ID_KEYS) if (a[k] != null || b[k] != null) return a[k] != null && a[k] === b[k];
    return isNum(a.questions) && a.questions === b.questions;
  }
  // A run marks a scoring change with scoring_changed: true (note text is never parsed). No change is computed across it.
  const scoringChanged = (r) => r.scoring_changed === true;
  const runLabel = (r) => [r.model, r.date].filter(Boolean).join(" · ");
  function renderEval(sec, d, cfg = { cols: EVAL_COLS, file: "data/eval.json" }) {
    const cols = cfg.cols;
    const body = $("[data-body]", sec);
    const runs = d && Array.isArray(d.runs) ? d.runs.filter((r) => r && r.model && r.summary && typeof r.summary === "object") : [];
    if (!runs.length) return notRun(body, cfg.file);
    const latest = runs[runs.length - 1], earlier = runs.slice(0, -1);
    let base = null;
    let floor = 0; // earliest index comparable with the latest run under the current scoring
    for (let i = runs.length - 1; i >= 0; i--) if (scoringChanged(runs[i])) { floor = i; break; }
    for (let i = earlier.length - 1; i >= floor; i--) if (earlier[i].model === latest.model && sameQuestionSet(latest.summary, earlier[i].summary)) { base = earlier[i]; break; }
    const head = el("tr", {}, el("th", { scope: "col", text: "Score" }),
      el("th", { scope: "col" }, el("span", { class: "runhd", text: latest.model }), el("span", { class: "runsub", text: [latest.date, latest.summary.question_set, "latest run"].filter(Boolean).join(" · ") })),
      base ? el("th", { scope: "col", class: "delta-h" }, el("span", { class: "runhd", text: "Change · computed" }), el("span", { class: "runsub", text: "vs earlier run ↓" })) : null);
    const rows = cols.map(([k, label, f]) => {
      const z = latest.summary[k], a = base ? base.summary[k] : null;
      const dc = !base ? null : isNum(a) && isNum(z)
        ? el("td", { class: "delta", title: "Computed: latest minus earlier run", text: DELTA[KIND[k]](Math.round((z - a) * 100) / 100) })
        : el("td", { class: "na", text: "—" });
      return el("tr", {}, el("th", { scope: "row", text: label }), evalCell(f(z)), dc);
    });
    const parts = [el("div", { class: "scroll" }, el("table", { class: "evalhist" }, el("thead", {}, head), el("tbody", {}, rows)))];
    const noted = [...earlier].reverse().filter((r) => typeof r.note === "string" && r.note);
    if (earlier.length) {
      const hist = el("table", { class: "evalpast" },
        el("thead", {}, el("tr", {}, el("th", { scope: "col", text: "Earlier run" }), cols.map(([, h]) => el("th", { scope: "col", text: h })))),
        el("tbody", {}, [...earlier].reverse().map((r) => {
          const n = noted.indexOf(r);
          return el("tr", { class: scoringChanged(r) ? "scoring-break" : null },
            el("td", {}, [runLabel(r), r.summary.question_set ? el("span", { class: "runsub", text: r.summary.question_set }) : null, n >= 0 ? el("sup", { class: "fn", text: ` ${n + 1}` }) : null]),
            cols.map(([k, , f]) => evalCell(f(r.summary[k]))));
        })));
      parts.push(el("h3", { class: "subhead", text: `History · ${earlier.length} earlier run${earlier.length === 1 ? "" : "s"}` }), el("div", { class: "scroll" }, hist));
      if (noted.length) parts.push(el("ol", { class: "fnotes" }, noted.map((r) => el("li", {}, el("b", { text: `${runLabel(r)}: ` }), r.note))));
    }
    if (base) parts.push(el("div", { class: "meta" },
      el("span", { class: "chip cmpbase", text: `Change compares with ${runLabel(base)}${base.summary.question_set ? ` (${base.summary.question_set})` : ""}: same question set and scoring` }),
      el("span", { class: "chip", text: "pp = percentage points" })));
    if (typeof latest.note === "string" && latest.note) parts.unshift(el("p", { class: "note", text: latest.note }));
    if (cfg.headline) { const h = cfg.headline(latest.summary); if (h) parts.unshift(h); }
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
  const cellText = (v) => (v == null ? null : typeof v === "object" ? (Array.isArray(v) ? v.join(", ") : Object.entries(v).map(([k, x]) => `${k} ${x}`).join(" · ")) : String(v));
  function outputRows(rows, label = "output rows") {
    if (!Array.isArray(rows) || !rows.length) return null;
    const cols = [...new Set(rows.flatMap((r) => (r && typeof r === "object" ? Object.keys(r) : [])))];
    return el("details", { class: "out" }, el("summary", { text: `${label} (${int(rows.length)})` }),
      el("div", { class: "scroll" }, el("table", {},
        el("thead", {}, el("tr", {}, cols.map((c) => el("th", { text: c })))),
        el("tbody", {}, rows.map((r) => el("tr", {}, cols.map((c) => cell(cellText(r?.[c])))))))));
  }
  function renderReplay(sec, d) {
    const body = $("[data-body]", sec);
    const items = d && Array.isArray(d.answers) ? d.answers.filter((a) => a && a.response && typeof a.response.answer === "string") : [];
    if (!items.length) return notRun(body, "data/replay.json");
    body.replaceChildren(el("div", { class: "replay" }, items.map(answerCard)));
  }

  // Answers use **bold** and `code`; render just those as elements (text nodes only, no HTML parsing).
  function mdLite(t) {
    return String(t).split(/(\*\*[^*]+\*\*|`[^`]+`)/).filter((x) => x !== "").map((x) =>
      /^\*\*[^*]+\*\*$/.test(x) ? el("b", { text: x.slice(2, -2) }) : /^`[^`]+`$/.test(x) ? el("code", { text: x.slice(1, -1) }) : x);
  }
  function answerCard(it) {
      const a = it.response;
      const flagged = a.status === "refused" || a.status === "unverified";
      if (it.bare) return el("article", { class: flagged ? "qa refused" : "qa" }, it.question ? el("div", { class: "q", text: it.question }) : null,
        flagged ? el("div", { class: "flag", text: a.status === "unverified" ? "Could not verify" : "Declined to answer" }) : null, el("div", { class: "a" }, mdLite(a.answer)), it.extra || null);
      const calls = Array.isArray(a.tool_calls) ? a.tool_calls : [];
      const meta = [];
      if (!it.partial || a.as_of != null) meta.push(el("span", { class: "chip", text: a.as_of ? `as of ${a.as_of}` : "no data date" }));
      const took = secs(a.elapsed_s); if (took) meta.push(el("span", { class: "chip", text: `took ${took}` }));
      if (a.model) meta.push(el("span", { class: "chip", text: a.model }));
      const stale = a.checker && Array.isArray(a.checker.stale_tables) ? a.checker.stale_tables : [];
      if (stale.length) meta.push(el("span", { class: "chip", text: `stale: ${stale.join(", ")}` }));
      if (typeof it.correct === "boolean") meta.push(el("span", { class: it.correct ? "chip acc" : "chip", text: it.correct ? "graded correct" : "graded wrong" }));
      return el("article", { class: flagged ? "qa refused" : "qa" },
        it.question ? el("div", { class: "q", text: it.question }) : null,
        flagged ? el("div", { class: "flag", text: a.status === "unverified" ? "Could not verify" : "Declined to answer" }) : null,
        el("div", { class: "a" }, mdLite(a.answer)),
        caseList(calls), proposalChips(a.proposals),
        el("div", { class: "meta" }, meta),
        calls.length ? el("details", {}, el("summary", { text: `${calls.length} tool call${calls.length === 1 ? "" : "s"}` }),
          el("ol", { class: "calls" }, calls.map((c) => {
            const o = c.output && typeof c.output === "object" ? c.output : {};
            const facts = [isNum(c.rows_returned) ? `${int(c.rows_returned)} row${c.rows_returned === 1 ? "" : "s"} returned` : "rows not reported"];
            const t = secs(c.elapsed_s); if (t) facts.push(t);
            if (o.source_table) facts.push(`table ${o.source_table}`);
            if (o.units) facts.push(o.units);
            if (o.error) facts.push(`error: ${o.error}`);
            const extra = o.error ? fmtInputs(Object.fromEntries(Object.entries(o).filter(([k]) => k !== "error"))) : "";
            if (extra) facts.push(extra);
            return el("li", {}, el("code", { text: c.tool || "unknown" }), " ",
              el("span", { class: "in", text: fmtInputs(c.inputs) || "no inputs" }),
              el("div", { class: "facts", text: facts.join(" · ") }), keyFacts(o.summary, "summary"), keyFacts(o.totals, "totals"),
              outputRows(o.rows), outputRows(o.transfers, "transfers"));
          }))) : el("div", { class: "meta" }, el("span", { class: "chip", text: "no tool calls" })));
  }

  /* Mirage (DATA_CONTRACT.md §7). Values are shown as given; labels only. */
  const NEXT_STEP = { recount: "Recount", pull_to_floor: "Pull to floor", reorder: "Reorder" };
  const stepLabel = (v) => (v == null ? null : NEXT_STEP[v] || String(v));
  const FACT_LABEL = {
    assortment_sku_count: "SKUs in assortment", gap_sku_count: "SKUs with an empty shelf", gap_rate_pct: "Gap rate",
    book_wrong_sku_count: "Record wrong", backroom_sku_count: "In the backroom", truly_out_sku_count: "Truly out",
    lines: "PO lines", cases_received: "Cases received", cases_allocated: "Cases to clubs", cases_held_at_dc: "Cases held at the DC",
    transfers: "Transfers", club_skus_under_1_week_before: "Club SKUs under 1 week of supply, before", club_skus_under_1_week_after: "Club SKUs under 1 week of supply, after",
  };
  const CASE_COUNT_KEYS = ["book_wrong_sku_count", "backroom_sku_count", "truly_out_sku_count"];
  function keyFacts(o, cls) {
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    const items = Object.entries(o).filter(([, v]) => v != null && typeof v !== "object");
    if (!items.length) return null;
    const dl = el("dl", { class: `kv ${cls}` }, items.map(([k, v]) => el("div", {}, el("dt", { text: FACT_LABEL[k] || k }),
      el("dd", { text: /_pct$/.test(k) && isNum(v) ? `${v}%` : String(v) }))));
    // One SKU can be both "record wrong" and "in the backroom", so case counts may sum past the empty total.
    if (!CASE_COUNT_KEYS.some((k) => k in o)) return dl;
    return el("div", { class: "kvwrap" }, dl, el("p", { class: "overlap", text: "Categories can overlap" }));
  }
  function caseList(calls) {
    const rows = calls.flatMap((c) => (c && c.output && Array.isArray(c.output.rows) ? c.output.rows : [])).filter((r) => r && (r.case_label || r.case) && r.next_step);
    if (!rows.length) return null;
    return el("ul", { class: "cases" }, rows.map((r) => el("li", {},
      el("b", { text: r.sku_name || r.sku_id || "SKU" }), " ", el("span", { class: "case", text: r.case_label || r.case }),
      " → ", el("span", { class: "chip acc step", text: stepLabel(r.next_step) }),
      r.also ? el("span", { class: "also", text: ` also ${stepLabel(r.also)}${r.also_reason ? `: ${r.also_reason}` : ""}` }) : null)));
  }
  function proposalChips(ps) {
    if (!Array.isArray(ps) || !ps.length) return null;
    return el("div", { class: "meta props" }, ps.map((p) => el("span", { class: "chip acc",
      text: [`Proposal ${p.proposal_id}`, p.club, p.sku_name, stepLabel(p.action), p.status].filter((x) => x != null).join(" · ") })));
  }
  const MIRAGE_EVAL_COLS = [
    ["questions", "Questions", asGiven, null],
    ["overall_correct", "Overall correct", pctGiven, "max"],
    ["numeric_accuracy", "Numeric accuracy", pctGiven, "max"],
    ["case_and_step", "Case and next step", pctGiven, "max"],
    ["proposal_accuracy", "Proposal accuracy", pctGiven, "max"],
    ["unrequested_proposals", "Unrequested proposals (lower is better)", pctGiven, "min"],
    ["tool_choice", "Tool choice", pctGiven, "max"],
    ["blocked_proposals", "Blocked proposals (count)", asGiven, null],
    ["correct_refusals", "Correct refusals", pctGiven, "max"],
    ["false_refusals", "False refusals (lower is better)", pctGiven, "min"],
    ["grounded_answers", "Grounded answers", pctGiven, "max"],
    ["median_s", "Median time / answer", secsFmt, "min"],
    ["p95_s", "p95 time / answer", secsFmt, "min"],
  ];
  function renderMirageEval(sec, d) {
    renderEval(sec, d, { cols: MIRAGE_EVAL_COLS, file: "data/mirage_eval.json", headline: (sm) => {
      const oc = pctGiven(sm.overall_correct), q = asGiven(sm.questions);
      if (!oc || !q) return null;
      return el("p", { class: "headline" }, el("span", { class: "big", text: oc }), ` overall correct on ${q} questions`,
        sm.question_set ? el("span", { class: "runsub", text: ` · ${sm.question_set}` }) : null);
    } });
  }
  function renderMirageReplay(sec, d) {
    const body = $("[data-body]", sec);
    const items = d && Array.isArray(d.answers) ? d.answers.filter((a) => a && a.response && typeof a.response.answer === "string") : [];
    if (!items.length) return notRun(body, "data/mirage_replay.json");
    const right = items.filter((a) => a.correct === true).length;
    body.replaceChildren(el("div", { class: "meta" }, el("span", { class: "chip", text: `${items.length} recorded answers` }),
      el("span", { class: "chip", text: `${right} graded correct` })),
      el("div", { class: "replay" }, items.map((it) => { const c = answerCard(it); if (it.type) c.prepend(el("div", { class: "qtype", text: [it.id, it.type].filter(Boolean).join(" · ") })); return c; })));
  }
  const DEMO = "Demo reviewer";
  const who = (name) => (name == null ? null : el("span", { class: "who" }, name, name === DEMO ? el("span", { class: "chip demo", text: "Demo" }) : null));
  const tdNode = (n) => (n == null ? el("td", { class: "na", text: "—" }) : el("td", {}, n));
  const STATUS_CLASS = { "waiting for approval": "chip acc", approved: "chip res-success", rejected: "chip res-failure" };
  const statusChip = (st) => el("span", { class: STATUS_CLASS[st] || "chip", text: st || "unknown" });
  function proposalsTable(ps) {
    return el("div", { class: "scroll" }, el("table", { class: "mtable proposals" },
      el("thead", {}, el("tr", {}, ["#", "Created", "Club", "SKU", "Action", "Reason", "Status", "Decided by", "Decided at"].map((h) => el("th", { scope: "col", text: h })))),
      el("tbody", {}, ps.map((p) => el("tr", {}, cell(p.id == null ? null : String(p.id)), cell(p.created_at ? fmtDate(p.created_at) : null),
        cell([p.club, p.store_id ? `store ${p.store_id}` : null].filter(Boolean).join(" · ") || null),
        cell([p.sku_name, p.sku_id].filter(Boolean).join(" · ") || null), cell(stepLabel(p.action)), cell(p.reason || null),
        tdNode(statusChip(p.status)), tdNode(who(p.decided_by)), cell(p.decided_at ? fmtDate(p.decided_at) : null))))));
  }
  function auditTable(rows) {
    return el("div", { class: "scroll" }, el("table", { class: "mtable auditlog" },
      el("thead", {}, el("tr", {}, ["#", "Proposal", "Decision", "Decided by", "Decided at", "Note"].map((h) => el("th", { scope: "col", text: h })))),
      el("tbody", {}, rows.map((a) => el("tr", {}, cell(a.id == null ? null : String(a.id)), cell(a.proposal_id == null ? null : String(a.proposal_id)),
        tdNode(statusChip(a.decision)), tdNode(who(a.decided_by)), cell(a.decided_at ? fmtDate(a.decided_at) : null), cell(a.note || null))))));
  }
  function renderMirageReview(sec, d) {
    const body = $("[data-body]", sec);
    const ps = d && Array.isArray(d.proposals) ? d.proposals.filter((p) => p && typeof p === "object") : null;
    if (!ps) return notRun(body, "data/mirage_proposals.json");
    const log = Array.isArray(d.audit_log) ? d.audit_log.filter((a) => a && typeof a === "object") : [];
    const pending = ps.filter((p) => p.status === "waiting for approval");
    const parts = [el("p", { class: "note ro", text: "Read-only. This page cannot approve or reject; decisions are made in the app with an admin key." })];
    parts.push(el("h3", { class: "subhead", text: `Waiting for approval · ${pending.length}` }));
    parts.push(pending.length ? el("div", { class: "pending" }, pending.map((p) => el("article", { class: "qa prop" },
      el("div", { class: "q", text: [`Proposal ${p.id}`, p.club, p.created_at ? `created ${fmtDate(p.created_at)}` : null].filter(Boolean).join(" · ") }),
      el("div", { class: "a" }, el("b", { text: [p.sku_name, p.sku_id].filter(Boolean).join(" · ") }), " → ", el("span", { class: "chip acc step", text: stepLabel(p.action) })),
      p.reason ? el("div", { class: "reason", text: p.reason }) : null,
      el("div", { class: "meta" }, statusChip(p.status))))) : el("div", { class: "empty", text: "No proposals waiting" }));
    parts.push(el("h3", { class: "subhead", text: `All proposals · ${ps.length}` }), ps.length ? proposalsTable(ps) : el("div", { class: "empty", text: "No proposals" }));
    parts.push(el("h3", { class: "subhead", text: `Recorded decisions · ${log.length}` }), log.length ? auditTable(log) : el("div", { class: "empty", text: "No decisions recorded" }));
    const sa = d.second_answer;
    if (sa && typeof sa.answer === "string") parts.push(el("h3", { class: "subhead", text: "Second recorded answer" }),
      Array.isArray(sa.tool_calls)
        ? answerCard({ question: sa.question, partial: true, response: { status: sa.status, answer: sa.answer, as_of: sa.as_of, tool_calls: sa.tool_calls,
            proposals: sa.proposal_id != null ? [{ proposal_id: sa.proposal_id }] : [] } })
        : answerCard({ question: sa.question, response: { status: sa.status, answer: sa.answer }, bare: true,
            extra: sa.proposal_id != null ? proposalChips([{ proposal_id: sa.proposal_id }]) : null }));
    if (d.source) parts.push(el("p", { class: "note src", text: d.source }));
    body.replaceChildren(...parts);
  }
  const STEP_LABEL = { ask: "Ask", queue: "Review queue", approve_without_key: "Approve without a key", approve: "Approve with the admin key",
    decide_again: "Decide again", audit_log: "Audit log" };
  function renderMirageAudit(sec, d) {
    const body = $("[data-body]", sec);
    const steps = d && Array.isArray(d.steps) ? d.steps.filter((s) => s && s.step) : [];
    if (!steps.length) return notRun(body, "data/mirage_audit.json");
    body.replaceChildren(el("ol", { class: "steps" }, steps.map((st) => {
      const rq = st.request || {}, rs = st.response || {}, b = rq.body || {};
      const head = [el("span", { class: "stepname", text: STEP_LABEL[st.step] || st.step })];
      if (isNum(st.status_code)) head.push(el("span", { class: st.status_code < 300 ? "chip res-success" : "chip res-failure", text: String(st.status_code) }));
      const kids = [el("div", { class: "stephead" }, head),
        el("div", { class: "req" }, el("code", { text: [rq.method, rq.path].filter(Boolean).join(" ") }),
          rq.headers && Object.keys(rq.headers).length ? el("span", { class: "in", text: ` · header ${Object.keys(rq.headers).join(", ")} (placeholder in the recording)` }) : null)];
      if (b.decided_by != null) kids.push(el("div", { class: "facts" }, "decided_by ", who(b.decided_by), b.note ? ` · note: ${b.note}` : ""));
      if (typeof rs.answer === "string") kids.push(answerCard({ question: b.question, response: rs }));
      else if (typeof rs.detail === "string") kids.push(el("div", { class: "detail", text: rs.detail }));
      if (Array.isArray(rs.proposals)) kids.push(rs.proposals.length ? proposalsTable(rs.proposals) : el("div", { class: "empty", text: "No proposals waiting" }));
      if (rs.proposal && typeof rs.proposal === "object") kids.push(proposalsTable([rs.proposal]));
      const log = Array.isArray(rs.audit_log) ? rs.audit_log : Array.isArray(rs.audit) ? rs.audit : null;
      if (log) kids.push(log.length ? auditTable(log) : el("div", { class: "empty", text: "No audit rows" }));
      return el("li", { class: "step" }, kids);
    })));
  }

  /* (e) Try it live */
  function renderLive(sec, d) {
    // Hidden unless live.json is listed in index.json and holds an https URL.
    const url = d && typeof d.url === "string" && /^https:\/\//.test(d.url) ? d.url : null;
    if (!url) { sec.hidden = true; return; }
    const base = url.replace(/\/+$/, "");
    const input = el("input", { type: "text", id: "live-q", name: "question", maxlength: "500", required: "", placeholder: "Ask about the CDC data" });
    const label = el("label", { for: "live-q", class: "live-label", text: "Your question" });
    const button = el("button", { type: "submit", class: "btn" }, el("span", { text: "Ask" }));
    const out = el("div", { class: "live-out", "aria-live": "polite", "aria-busy": "false" });
    const setState = (state) => { out.classList.toggle("is-loading", state === "loading"); out.classList.toggle("is-error", state === "error"); out.setAttribute("aria-busy", state === "loading" ? "true" : "false"); };
    const form = el("form", { class: "live-ask" }, input, " ", button);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const question = input.value.trim(); if (!question) return;
      button.disabled = true; setState("loading");
      out.replaceChildren(el("p", { class: "note", text: "Asking… the first call can take about 50 s while the server wakes." }));
      try {
        const fail = (text) => { setState("error"); out.replaceChildren(el("p", { class: "note", text })); };
        let r;
        try {
          r = await fetch(`${base}/api/agent/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) });
        } catch {
          return fail("Couldn't reach the live API. It may be waking up, so try again in a minute.");
        }
        let j;
        try { j = await r.json(); } catch {
          return fail(`The live API sent a response the page couldn't read (HTTP ${r.status}).`);
        }
        if (!r.ok) {
          const d = j && j.detail;
          const detail = typeof d === "string" ? d : Array.isArray(d) ? d.map((x) => x && x.msg).filter(Boolean).join("; ") : "";
          return fail(`The live API returned an error (HTTP ${r.status}).${detail ? " " + detail : ""}`);
        }
        setState("done");
        out.replaceChildren(
          el("p", { class: "live-answer", text: String(j.answer ?? "") }),
          el("p", { class: "note", text: [j.status, j.as_of ? `data as of ${j.as_of}` : null].filter(Boolean).join(" · ") }));
      } catch {
        setState("error");
        out.replaceChildren(el("p", { class: "note", text: "Couldn't reach the live API. It may be waking up, so try again in a minute." }));
      } finally { button.disabled = false; }
    });
    $("[data-body]", sec).replaceChildren(
      el("p", { class: "note", text: "Asks the hosted agent. The free server sleeps when idle, so the first call can take about 50 s while it wakes." }),
      label, form, out,
      el("p", { class: "note" }, el("a", { href: "app/review", text: "Review queue" }), " · ", el("a", { href: "app/ask", text: "Full Ask page" }), " · ", el("a", { href: url, rel: "noopener", text: "API" })));
    sec.hidden = false;
  }

  /* Freshness strip: only dates that exist in the data. Staleness only from the data's own flags
     (get_data_freshness rows[].stale, checker.stale_tables); no thresholds here. */
  function renderFreshness(dash, replay, status) {
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
    // status.json carries the nightly run's own get_data_freshness rows; prefer them over recorded answers.
    const nightly = status && status.freshness && Array.isArray(status.freshness.tables) && status.freshness.tables.length ? status.freshness.tables : null;
    if (nightly) { fresh = nightly; staleFlag.clear(); }
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
    const rec = nightly && status.generated_at ? ` (nightly run, ${fmtDate(status.generated_at)})` : replay && replay.recorded_at ? ` (from answers recorded ${fmtDate(replay.recorded_at)})` : "";
    strip.replaceChildren(el("span", { class: "fr-lab", text: "Data as of" }), ...chips, fresh || staleFlag.size ? el("span", { class: "fr-note", text: `Dates and stale flags come from the data's own freshness check${rec}.` }) : "");
    strip.hidden = false;
  }

  /* Nightly status strip: data/status.json written by scripts/nightly_status.py (DATA_CONTRACT.md §6).
     Only fields present are shown; nothing is computed. */
  const RESULT_TEXT = { success: "Passed", alert: "Passed with alerts", failure: "Failed" };
  function renderStatus(d) {
    const strip = $("#status");
    const run = d && d.run && typeof d.run === "object" ? d.run : null;
    if (!run) { strip.replaceChildren(el("span", { class: "fr-lab", text: "Nightly run" }), el("span", { class: "chip", text: NOT_RUN })); return; }
    const kids = [el("span", { class: "fr-lab", text: "Nightly run" })];
    if (typeof run.result === "string") kids.push(el("span", { class: `chip res-${run.result in RESULT_TEXT ? run.result : "other"}`, text: RESULT_TEXT[run.result] || run.result }));
    if (run.finished_at) kids.push(el("span", { class: "chip" }, "finished ", el("b", { text: fmtDate(run.finished_at) })));
    if (typeof run.url === "string" && /^https:\/\//.test(run.url)) kids.push(el("a", { class: "chip link", href: run.url, rel: "noopener", text: "View run ↗" }));
    if (Array.isArray(d.alerts)) {
      if (!d.alerts.length) kids.push(el("span", { class: "chip", text: "No open alerts" }));
      else kids.push(el("ul", { class: "alerts" }, d.alerts.map((a) => el("li", {},
        a.kind ? el("span", { class: "chip acc", text: a.kind }) : null, " ", el("b", { text: a.title || "" }), a.detail ? el("span", { class: "ad", text: ` — ${a.detail}` }) : null))));
    }
    strip.replaceChildren(...kids);
  }

  const SECTIONS = [["dashboard", "#sec-dashboard", renderDashboard], ["eval", "#sec-eval", renderEval], ["backtest", "#sec-backtest", renderBacktest], ["replay", "#sec-replay", renderReplay], ["mirage_eval", "#sec-mirage-eval", renderMirageEval], ["mirage_replay", "#sec-mirage-replay", renderMirageReplay], ["mirage_proposals", "#sec-mirage-review", renderMirageReview], ["mirage_audit", "#sec-mirage-audit", renderMirageAudit], ["live", "#sec-live", renderLive]];
  load("status").then(renderStatus).catch(() => renderStatus(null));
  Promise.all([load("dashboard"), load("replay"), load("status")]).then(([dsh, rp, st]) => renderFreshness(dsh, rp, st)).catch(() => { $("#freshness").hidden = true; });
  for (const [name, sel, fn] of SECTIONS) {
    const sec = $(sel);
    load(name).then((d) => { if (name !== "live") stamp(sec, d); try { fn(sec, d); } catch (e) { notRun($("[data-body]", sec), `data/${name}.json could not be read`); console.warn(e); } });
  }
})();
