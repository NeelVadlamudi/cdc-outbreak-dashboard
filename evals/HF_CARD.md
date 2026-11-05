---
pretty_name: CDC Outbreak Ask Eval (cdc-q60-v1)
license: mit
task_categories:
  - question-answering
  - text-generation
language:
  - en
tags:
  - epidemiology
  - public-health
  - CDC
  - tool-calling
  - evaluation
  - grounded-generation
size_categories:
  - n<1K
---

# CDC Outbreak Ask Eval — `cdc-q60-v1`

Frozen, SQL-backed evaluation set for the grounded Ask agent in
[NeelVadlamudi/cdc-outbreak-dashboard](https://github.com/NeelVadlamudi/cdc-outbreak-dashboard).

## Intended use

- Measure whether an agent’s **numbers appear in tool results** (grounding) and match
  SQL gold answers on a **frozen** DuckDB snapshot.
- Research / education / hiring-signal artifact — **not** clinical decision support.

## Dataset contents (in this repo)

| File | Role |
|------|------|
| [`questions.yaml`](questions.yaml) | 60 questions (`cdc-q60-v1`): 36 numeric, 12 multi-tool, 12 refusal |
| [`snapshot.duckdb`](snapshot.duckdb) | Frozen CDC window for reproducible gold SQL |
| [`baseline.json`](baseline.json) | Nightly score floor for CI grounding gate |
| Nightly `results/*.json` | Model-dated scorecards (Pages publishes a subset) |

## Scoring (functional, not vibe)

- **numeric_accuracy** — answer within tolerance of `expected_sql`
- **tool_choice** — expected tools used
- **correct_refusals / false_refusals** — out-of-coverage questions
- **grounded_answers** — every figure in the answer must appear in tool output

## Limitations

- Snapshot weeks are fixed; live API weeks move — do not mix them in one score run.
- Does **not** measure FluSight WIS or forecast skill.
- Optional LLM providers (Gemini) need the caller’s own key; Ollama is the free local path.
- Live product may also show **supplemental** open series (OWID / CDC burden) outside this frozen snapshot; those are provenance-tagged via `/api/sources` and are **not** part of `cdc-q60-v1` gold SQL.

## Citation

```bibtex
@misc{cdc_outbreak_q60_v1,
  author = {Vadlamudi, Neel},
  title = {CDC Outbreak Ask Eval (cdc-q60-v1)},
  year = {2026},
  howpublished = {GitHub},
  url = {https://github.com/NeelVadlamudi/cdc-outbreak-dashboard/tree/main/evals}
}
```

## License

MIT (same as the parent repository). Underlying CDC open data remains subject to
CDC/public-domain terms; this card covers the eval packaging only.
