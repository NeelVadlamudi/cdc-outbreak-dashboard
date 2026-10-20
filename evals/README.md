# Evals

Scores the agent behind `POST /api/agent/ask` against answers computed by SQL
from a frozen copy of the CDC data.

- `build_snapshot.py` writes `snapshot.duckdb` for a fixed window (weeks ending
  2026-07-25 to 2026-10-10; the legacy wastewater metrics to 2025-09-07, where
  that CDC file stops). `--add-wastewater-activity` adds only the current NWSS
  viral activity table for the same weeks, leaving the other tables untouched.
  The file is committed (about 3 MB) so expected answers never move. Rebuild with
  `python evals/build_snapshot.py --force`.
- `questions.yaml` has 60 questions: 36 single-number, 12 that need more than
  one tool, and 12 the data cannot answer. Every expected value comes from its
  `expected_sql` run against the snapshot.
- `run_evals.py` asks each question, scores it and writes
  `results/<model>_<date>.json` and `.md`. Use `--from-file` to score saved
  responses without calling the API. Set `EVAL_API_KEY` if the endpoint needs one.

Scores: numeric accuracy, tool choice, correct refusals, false refusals,
grounded answers (every number in the answer appears in a tool result), and
median and p95 time.

Tests: `pytest evals/tests`
