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
- Durations: **integer milliseconds** (`elapsed_ms`, `ms`, `ms_per_answer`). The site formats them (two largest units).
- `null` or omitted = not measured. Never write `0` for "unknown".

## 1. `data/dashboard.json` — section (a)
```json
{
  "generated_at": "ISO-8601",
  "as_of_week": "string, e.g. CDC MMWR week label",
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
Each answer is exactly the `POST /api/agent/ask` response, plus `question` and optional grading:
```json
{
  "recorded_at": "ISO-8601",
  "answers": [
    {
      "question": "string",
      "answer": "string",
      "status": "answered | refused | unverified",
      "tool_calls": [ { "tool": "string", "inputs": {}, "rows": 0, "ms": 0 } ],
      "as_of_week": "string",
      "elapsed_ms": 0,
      "correct": true
    }
  ]
}
```
Record real eval answers only. `rows` and `ms` per call are optional.

## 5. `data/live.json` — section (e)
```json
{ "url": "https://<render-app>.onrender.com/ask" }
```
Must be `https://`. If `live` is not listed in `index.json` (or the URL is missing or not https), the whole "Try it live" section is **hidden**, not disabled. When shown, the button reads "Try it live · may take a minute to wake".

## API contract used by the React Ask page
`POST /api/agent/ask` body `{ "question": "..." }` →
`{ answer, status, tool_calls: [ {tool, inputs, rows?, ms?} ], as_of_week, elapsed_ms }`.

`status` (top-level) drives the UI state:
| value | UI |
|---|---|
| `"answered"` | normal answer |
| `"refused"` | flagged "Agent declined to answer" |
| `"unverified"` | flagged "Could not verify" |
| missing / anything else | treated as `"answered"` |

The UI does not inspect the answer text to decide this; only `status` counts.
Field names live in one place: `frontend/src/agent/contract.js` (`FIELDS`). Non-2xx → error state; a JSON `detail` is shown.

Example shapes for tests live in `tests/site-fixtures/` and are labelled EXAMPLE. Never copy them into `site/data/`.
