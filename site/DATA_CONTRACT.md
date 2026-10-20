# site/data contract (for the nightly job)

The static site at `site/` reads only `site/data/*.json`. It never estimates or fills in a number:
a missing file, a missing field, or a non-numeric value shows **"Not run yet"** (whole section) or **"—"** (single cell).

## 0. `data/index.json` — required manifest
```json
{ "available": ["dashboard", "eval", "backtest", "replay", "live"] }
```
List only files you actually wrote this run. The site fetches nothing that isn't listed (keeps the console free of 404s).
Committed default: `{ "available": [] }`.

Conventions for every file:
- Timestamps: ISO 8601 with zone (`2026-10-21T06:00:00Z`). Shown in America/New_York.
- Rates/percentages: **fractions 0–1** (`0.873`) everywhere except `eval.json`, which keeps run_evals.py percentages 0–100.
- Durations: agent responses use **seconds** (`elapsed_s`), as the API does. `eval.json` uses seconds (`median_s`, `p95_s`). The site formats both (two largest units).
- `null` or omitted = not measured. Never write `0` for "unknown".

## 1. `data/dashboard.json` — section (a)
```json
{
  "generated_at": "ISO-8601",
  "as_of": "YYYY-MM-DD, latest data week (same meaning as the API as_of)",
  "metrics": [
    { "id": "string", "label": "string", "value": 0, "unit": "string?", "format": "pct?", "decimals": 1, "change_text": "string?" }
  ]
}
```
`format: "pct"` means `value` is a 0–1 fraction. Integers are shown with separators; others with `decimals` (default 1).

## 2. `data/eval.json` — section (b)
One entry per model run. Each entry is the top of the file `evals/run_evals.py` already writes
(`{model, date, summary, ...}`); `rows`/`responses` may be included and are ignored.
```json
{
  "run_at": "ISO-8601",
  "runs": [
    {
      "model": "string",
      "date": "YYYY-MM-DD",
      "note": "string?, shown above the table for the latest run",
      "scoring_changed": "boolean?, true on the first run scored with a changed scorer",
      "summary": {
        "question_set": "string?, e.g. cdc-q60-v1",
        "questions": 0,
        "numeric_accuracy": 0.0,
        "tool_choice": 0.0,
        "correct_refusals": 0.0,
        "false_refusals": 0.0,
        "grounded_answers": 0.0,
        "median_s": 0.0,
        "p95_s": 0.0,
        "median_input_tokens": 0,
        "median_output_tokens": 0
      }
    }
  ]
}
```
`summary` keys are exactly `summarize()` in `evals/run_evals.py`:
- Rates (`numeric_accuracy`, `tool_choice`, `correct_refusals`, `false_refusals`, `grounded_answers`) are **percentages 0–100, 1 decimal**,
  `null` when there were no questions to count. Shown as given with a `%` sign.
- `median_s`, `p95_s` are **seconds**; shown with the duration formatter (e.g. "1.9 s").
- `questions`, `median_input_tokens`, `median_output_tokens` are shown as given.
- Any `null` cell shows **"Not run yet"**. The site never computes or estimates a value.
- There is no checker-catches column (no summary key for it).
- **History:** `runs[]` is appended on each rerun, oldest first. The **last** entry is the headline table;
  earlier runs are listed underneath ("History", newest first), values only.
- **Computed change:** the headline gets a "Change · computed" column only against the most recent earlier run that
  (a) has the same question set: equal `summary.question_set` when either run has one (`QSET_ID_KEYS` in site.js);
  the `questions` count is used only when neither has an id; and
  (b) is not before a scoring change. A run marks a scoring change with `scoring_changed: true`
  (`scripts/publish_eval.py --scoring-changed` writes it; older entries may only have a `note` that starts "Scoring changed"). Runs before the latest such run are never compared.
  Shown only when both values are numbers, else "—". Rates in percentage points (pp), times via the duration formatter,
  counts as-is. Nothing else is computed.
- **Notes:** the latest run's `note` is shown above the headline; earlier runs' notes are numbered footnotes under the
  history table, and the scoring-change run gets a divider below it.

## Data freshness strip (no file of its own)
Built only from dates already in the data:
- `dashboard.json` → `as_of`.
- `status.json` → `freshness.tables[]` (the nightly run's `get_data_freshness` output) when present; it replaces the replay
  source below because it is newer. `stale` comes from that row (the backend's `STALE_AFTER_DAYS` rule).
- `replay.json` → the last recorded `get_data_freshness` tool output: `output.rows[] = {table, latest_week, age_days, stale, dataset?, legacy?}`
  (backend/agent/tools.py `get_data_freshness`). One chip per table **and dataset** (wastewater_sites has one row per source
  dataset), shown as `table · dataset latest_week`; "no data" if `latest_week` is null. Rows with `legacy: true` are shown
  last in a muted style; their own `stale` flag is still shown.
- If no freshness output was recorded: each tool output's `source_table` with its latest `output.as_of`.
- **Stale** = `rows[].stale === true` or the table appears in any `response.checker.stale_tables`. The site applies no threshold
  of its own (the 14-day rule lives in the backend). `age_days` is not shown because it is relative to recording time.
- No data at all → the strip is hidden.

## 3. `data/backtest.json` — section (c)
```json
{
  "run_at": "ISO-8601",
  "target": "string?, what was forecast",
  "mae_unit": "string?, unit of MAE",
  "n_origins": 0,
  "notes": ["string?, plain sentences shown above the tables"],
  "models": [
    { "model": "string", "horizons": [ { "h": 1, "mae": 0.0, "wmape": 0.0 } ] }
  ]
}
```
`h` is 1–4 (weeks ahead). `wmape` is a 0–1 fraction (can exceed 1). Omit or null a horizon you didn't score.
Written by `evals/backtest.py --site-out` (subset of its full output; `coverage` is not shown).
`notes` is optional. backtest.py writes one sentence per model and target saying whether it beats repeating last week's value; the site lists them as written.

Display rules:
- `model` is `"<Model> · <Target>"` as backtest.py writes it; the site groups by the text after the last " · ".
- `"Last value"` is the baseline (`MODELS` in backtest.py). Per target and horizon, a model cell is orange with ▼ when its
  value is lower than the baseline's; grey when equal or higher. This is a comparison only; no difference or ratio is computed.
- MAE is shown exactly as recorded (backtest.py rounds to 3 dp); WMAPE as a percentage with 1 decimal.

## 4. `data/replay.json` — section (d)
Each item wraps one **unmodified** `POST /api/agent/ask` response (same shape as the API section below),
exactly like `/workspace/cdc-agent-samples.json`:
```json
{
  "recorded_at": "ISO-8601",
  "answers": [
    { "question": "string", "response": { "status": "answered", "answer": "...", "tool_calls": [], "as_of": "2026-10-10", "elapsed_s": 1.887, "model": "...", "prompt_version": "...", "checker": {} }, "correct": true }
  ]
}
```
`correct` (optional boolean) is the eval grade. Record real eval answers only.
Shown per answer: status flag, answer, `as_of`, `elapsed_s`, `model`, stale tables; per tool call: `tool`, `inputs`,
`rows_returned`, `elapsed_s`, `output.source_table`, `output.units`, `output.error`; `output.rows` behind a collapsed toggle.

## 5. `data/live.json` — section (e)
```json
{ "url": "https://<render-app>.onrender.com/ask" }
```
Must be `https://`. If `live` is not listed in `index.json` (or the URL is missing or not https), the whole "Try it live" section is **hidden**, not disabled. When shown, the button reads "Try it live · may take a minute to wake".

## 6. `data/status.json` — nightly run status strip
Written by `scripts/nightly_status.py` at the end of every nightly run (`.github/workflows/nightly.yml`).
Listed in `index.json` as `"status"` (`scripts/publish_eval.py` and `scripts/nightly_status.py` add the entry if missing; the nightly writes the file every run). Rendered as the "Nightly run" strip under the header.
```json
{
  "generated_at": "ISO-8601",
  "run": {
    "result": "success | alert | failure",
    "started_at": "ISO-8601?",
    "finished_at": "ISO-8601",
    "url": "string?, link to the Actions run",
    "commit": "string?, commit the run started from",
    "steps": { "refresh": "success", "backtest": "success", "dashboard": "success", "eval": "success" }
  },
  "eval": {
    "model": "string",
    "date": "YYYY-MM-DD",
    "question_set": "string?, e.g. cdc-q60-v1",
    "summary": { "...": "same keys as eval.json runs[].summary" },
    "baseline": { "model": "string", "date": "YYYY-MM-DD", "summary": {} },
    "drops": [ { "metric": "numeric_accuracy", "baseline": 0.0, "value": 0.0, "change": 0.0 } ]
  },
  "backtest": { "run_at": "ISO-8601", "data_through": "YYYY-MM-DD", "notes": ["string"] },
  "freshness": {
    "stale_after_days": 14,
    "tables": [ { "table": "string", "dataset": "string?", "legacy": false, "latest_week": "YYYY-MM-DD", "age_days": 0, "stale": false } ]
  },
  "alerts": [ { "kind": "score_drop | stale | step_failed", "title": "string", "detail": "string" } ]
}
```
- `run.result`: `failure` if any step did not succeed, otherwise `alert` if `alerts` is non-empty, otherwise `success`.
  Step outcomes are the GitHub Actions values (`success`, `failure`, `skipped`, `cancelled`).
- `eval` is `null` when the eval did not run. `eval.baseline` is `null` when `evals/baseline.json` has a different
  `question_set`; no drop is computed across sets.
- `drops` lists rates more than 5 points worse than the baseline: lower for `numeric_accuracy`, `tool_choice`,
  `correct_refusals` and `grounded_answers`, higher for `false_refusals`. `change` is value minus baseline, in points.
- `freshness.tables` is the `get_data_freshness` output for the refreshed database. `age_days` is relative to the run date.
  Legacy rows are listed but never raise a stale alert.
- **Page display:** only fields that exist are shown: `run.result` (success → "Passed", alert → "Passed with alerts",
  failure → "Failed"), `run.finished_at` in ET, `run.url` as "View run ↗" (https only), and `alerts[]` (kind, title,
  detail; "No open alerts" when the array is empty). Missing file → "Not run yet". The site computes nothing from it.
- `backtest` is `null` if no backtest file exists. Each alert also opens a GitHub issue labelled `nightly-alert`;
  if an open issue with the same title exists, the run comments on it instead.

## API contract used by the React Ask page
`POST /api/agent/ask` body `{ "question": "..." }` → (PR #2, `backend/agent/graph.py::run_agent`)
```json
{
  "status": "answered | refused | unverified",
  "answer": "string",
  "tool_calls": [
    {
      "tool": "get_test_positivity",
      "inputs": { "pathogen": "COVID-19" },
      "rows_returned": 1,
      "elapsed_s": 0.012,
      "output": { "as_of": "2026-10-10", "source_table": "test_positivity", "rows": [ { } ], "units": "optional string" }
    }
  ],
  "as_of": "2026-10-10 or null",
  "elapsed_s": 1.887,
  "model": "string",
  "prompt_version": "string",
  "checker": { "passed": true, "unverified": [], "stale_tables": [] }
}
```
Notes: times are **seconds** (`elapsed_s`); the UI converts to ms and formats with two largest units.
`output` may instead be `{ "error": "..." }` (e.g. no data loaded); then `rows_returned` is 0 and rows are absent.
`units` is only present on some tools. The rule-based fallback returns the same top-level keys with `tool_calls: []`.

`status` (top-level) drives the UI state:
| value | UI |
|---|---|
| `"answered"` | normal answer |
| `"refused"` | flagged "Agent declined to answer" |
| `"unverified"` | flagged "Could not verify" |
| missing / anything else | treated as `"answered"` |

The UI does not inspect the answer text; only `status` counts.
Field names live in one place: `frontend/src/agent/contract.js` (`FIELDS`). Non-2xx → error state; a JSON `detail` is shown.

Example shapes for tests live in `tests/site-fixtures/` and are labelled EXAMPLE. Never copy them into `site/data/`.
