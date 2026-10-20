# Evals

Scores the agent behind `POST /api/agent/ask` against answers computed by SQL
from a frozen copy of the CDC data.

- `build_snapshot.py` writes `snapshot.duckdb` for a fixed window (weeks ending
  2026-07-25 to 2026-10-10; wastewater to 2025-09-07, where the CDC feed stops).
  The file is committed (about 3 MB) so expected answers never move. Rebuild with
  `python evals/build_snapshot.py --force`.
- `questions.yaml` has 20 questions: 12 single-number, 4 that need more than one
  tool, and 4 the data cannot answer.
- `run_evals.py` asks each question, scores it and writes
  `results/<model>_<date>.json` and `.md`. Use `--from-file` to score saved
  responses without calling the API. Set `EVAL_API_KEY` if the endpoint needs one.

Scores: numeric accuracy, tool choice, correct refusals, false refusals,
grounded answers (every number in the answer appears in a tool result), and
median and p95 time.

Tests: `pytest evals/tests`
