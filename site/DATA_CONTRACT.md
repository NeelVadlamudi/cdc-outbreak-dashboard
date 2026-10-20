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
- Rates/percentages: **fractions 0–1** (`0.873`, not `87.3`).
- Durations: agent responses use **seconds** (`elapsed_s`), as the API does. `eval.json` `ms_per_answer` is milliseconds. The site formats both (two largest units).
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
```json
{
  "run_at": "ISO-8601",
  "n_questions": 0,
  "dataset_version": "string?",
  "rows": [
    {
      "model": "string",
      "numeric_accuracy": 0.0,
      "tool_choice": 0.0,
      "correct_refusals": 0.0,
      "false_refusals": 0.0,
      "grounded": 0.0,
      "checker_catches": 0,
      "ms_per_answer": 0,
      "tokens_per_answer": 0
    }
  ]
}
```
All rate fields are 0–1. `checker_catches` is a count. With 2+ rows the best value per column is highlighted (max for rates, min for false refusals / time / tokens).

## 3. `data/backtest.json` — section (c)
```json
{
  "run_at": "ISO-8601",
  "target": "string?, what was forecast",
  "mae_unit": "string?, unit of MAE",
  "n_origins": 0,
  "models": [
    { "model": "string", "horizons": [ { "h": 1, "mae": 0.0, "wmape": 0.0 } ] }
  ]
}
```
`h` is 1–4 (weeks ahead). `wmape` is a 0–1 fraction. Omit or null a horizon you didn't score.

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
