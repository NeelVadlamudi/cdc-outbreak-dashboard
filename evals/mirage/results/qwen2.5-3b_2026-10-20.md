# Mirage audit eval: qwen2.5:3b, 2026-10-20

| Score | Value |
|---|---|
| question_set | mirage-q30-v1 |
| questions | 30 |
| overall_correct | 56.7 |
| numeric_accuracy | 55.6 |
| case_and_step | 72.7 |
| proposal_accuracy | 50.0 |
| unrequested_proposals | 4.8 |
| tool_choice | 80.0 |
| blocked_proposals | 2 |
| correct_refusals | 80.0 |
| false_refusals | 8.0 |
| grounded_answers | 100.0 |
| median_s | 8.05 |
| p95_s | 18.36 |

| id | type | correct | tools ok | refused | grounded |
|---|---|---|---|---|---|
| g01 | gaps | True | True | False | True |
| g02 | gaps | True | True | False | True |
| g03 | gaps | True | True | False | True |
| g04 | gaps | True | True | False | True |
| w01 | why | False | True | False | True |
| w02 | why | False | True | False | True |
| w03 | why | False | True | False | True |
| w04 | why | True | True | False | True |
| w05 | why | False | False | False | True |
| w06 | why | False | True | False | True |
| w07 | why | True | True | False | True |
| p01 | position | False | False | True | - |
| a01 | po | True | True | False | True |
| a02 | po | True | True | False | True |
| a03 | po | True | True | False | True |
| a04 | po | True | True | False | True |
| a05 | po | False | False | False | True |
| s01 | wos | True | True | False | True |
| s02 | wos | False | True | False | True |
| s03 | wos | False | True | True | - |
| x01 | propose | False | False | False | True |
| x02 | propose | False | True | False | True |
| x03 | propose | True | True | False | True |
| x04 | propose | False | False | False | True |
| r01 | refusal | True | True | True | - |
| r02 | refusal | True | True | True | - |
| r03 | refusal | True | True | True | - |
| r04 | refusal | True | True | True | - |
| r05 | refusal | False | True | False | True |
| m01 | multi | True | True | False | True |
