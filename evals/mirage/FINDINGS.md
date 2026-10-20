# Mirage audit eval: findings

## First run (gemini-3.5-flash-lite, 2026-10-20, question set mirage-q30-v1)

Results file: `results/gemini-3.5-flash-lite_2026-10-20.json`.

| Score | Value |
|---|---|
| question_set | mirage-q30-v1 |
| questions | 30 |
| overall_correct | 96.7 |
| numeric_accuracy | 94.4 |
| case_and_step | 100.0 |
| proposal_accuracy | 100.0 |
| unrequested_proposals | 0.0 |
| tool_choice | 100.0 |
| blocked_proposals | 1 |
| correct_refusals | 100.0 |
| false_refusals | 4.0 |
| grounded_answers | 100.0 |
| median_s | 1.71 |
| p95_s | 2.68 |

### Failures

- s03 (weeks of supply for Olive Oil 2L at Waltham): the model first called `get_sku_position` with a date it made up, 2026-03-30. The tool said that date is outside the count range. The model repeated that message ("The data does not cover 2026-03-30"), then gave the correct figures from `get_weeks_of_supply` (11 units, 0.7 weeks). The scorer counts this as a refusal, so the values check fails.

### Proposal guard

The guard rejected one proposal in this run. On x04 (Diapers Size 4, Everett, 2026-09-22), the model first called `propose_action` with `pull_to_floor` and a reason citing counts that are not in the data (backroom 5). The counts support only `recount`, so nothing was written. The model then proposed `recount` with the real counts.

An earlier run on the same day, made before the guard existed, did write two wrong proposals while recording the audit:
- `pull_to_floor` for Paper Towels 12pk, citing a backroom count of 14. The real counts are 0 on the floor, 0 in the backroom and 36 in the system.
- `pull_to_floor` for a truly-out SKU.

In both cases the answer text was correct; only the proposal was wrong. That is why `propose_action` now checks its action and its reason against the read-tool results, in code. The prompt was not changed for any question.

## Scoring

Expected values come from `expected.py`, which reads the raw CSVs with plain Python and does not use the agent's tools. Then, per question:

- **Numbers:** each expected value must appear in the answer, within the question's tolerance, and the answer must not be a refusal.
- **Case and step:** the answer must name the case and the next step:
  - record wrong: "record", "system" or "book", plus "recount";
  - in the backroom: "backroom" plus "pull";
  - truly out: "out of stock", "truly out" or similar, plus "reorder" or "replenish".
- **Proposals:**
  - Propose questions need a proposal row with the right SKU and action and status `waiting for approval`.
  - Other questions count as `unrequested_proposals` if they made one.
- **Refusals:** a refusal question is correct if the answer refuses and makes no proposal.
- **Grounding:** the same check as the CDC eval.
