import json

from evals import run_evals as ev

Q_NUM = {"id": "n1", "type": "number", "question": "What was COVID-19 test positivity for the latest week?",
         "tolerance": 0.05, "expected_tools": ["get_test_positivity"]}
Q_MULTI = {"id": "m1", "type": "multi", "question": "Latest wastewater week and site count?",
           "tolerance": 0, "expected_tools": ["get_data_freshness", "get_wastewater"]}
Q_REF = {"id": "r1", "type": "refusal", "question": "How many ICU beds are free in Texas?",
         "expected_tools": []}


def call(tool, output):
    return {"tool": tool, "inputs": {}, "output": output}


def test_numbers_ignore_dates_and_commas():
    assert ev.numbers_in("On 2026-10-10, 1,162 sites; positivity 3.6%.") == [1162.0, 3.6]
    assert ev.dates_in("as of September 7, 2025") == {"2025-09-07"}


def test_correct_grounded_number():
    resp = {"answer": "COVID-19 test positivity was 3.6% for the week ending 2026-10-10.",
            "tool_calls": [call("get_test_positivity", {"week_end": "2026-10-10", "value": 3.6})],
            "elapsed_s": 2.0}
    r = ev.score_one(Q_NUM, [3.6], resp)
    assert r["correct"] and r["tool_choice_ok"] and r["grounded"] and not r["false_refusal"]


def test_wrong_and_ungrounded_number():
    resp = {"answer": "It was 4.9%.",
            "tool_calls": [call("get_test_positivity", {"value": 3.6})]}
    r = ev.score_one(Q_NUM, [3.6], resp)
    assert not r["correct"] and r["grounded"] is False


def test_wrong_tool_and_false_refusal():
    resp = {"answer": "I can't find that in the data.", "tool_calls": [call("get_wastewater", {})]}
    r = ev.score_one(Q_NUM, [3.6], resp)
    assert r["false_refusal"] and not r["correct"] and not r["tool_choice_ok"]
    assert r["grounded"] is None


def test_multi_needs_every_value_and_tool():
    calls = [call("get_data_freshness", {"wastewater": "2025-09-07"}),
             call("get_wastewater", {"sites": 1162})]
    good = {"answer": "The latest wastewater week ends September 7, 2025, with 1,162 sites.", "tool_calls": calls}
    half = {"answer": "1,162 sites reported.", "tool_calls": calls[1:]}
    assert ev.score_one(Q_MULTI, ["2025-09-07", 1162], good)["correct"]
    r = ev.score_one(Q_MULTI, ["2025-09-07", 1162], half)
    assert not r["correct"] and not r["tool_choice_ok"]


def test_refusals():
    ok = {"answer": "The data does not cover ICU bed availability.", "tool_calls": []}
    bad = {"answer": "Texas has about 300 free ICU beds.", "tool_calls": []}
    assert ev.score_one(Q_REF, None, ok)["correct_refusal"]
    assert not ev.score_one(Q_REF, None, bad)["correct_refusal"]


def test_summary_and_from_file(tmp_path):
    qfile = tmp_path / "q.yaml"
    qfile.write_text(json.dumps({"questions": [
        {**Q_NUM, "expected_sql": "SELECT 3.6"}, Q_REF]}))
    import duckdb
    snap = tmp_path / "s.duckdb"
    duckdb.connect(str(snap)).close()
    resp = tmp_path / "resp.json"
    resp.write_text(json.dumps({
        "n1": {"answer": "3.6%", "tool_calls": [call("get_test_positivity", {"v": 3.6})], "elapsed_s": 1.0},
        "r1": {"answer": "That is not available in the data.", "tool_calls": [], "elapsed_s": 3.0},
    }))
    out = tmp_path / "out"
    assert ev.main(["--model", "fake", "--from-file", str(resp), "--questions", str(qfile),
                    "--snapshot", str(snap), "--out-dir", str(out)]) == 0
    saved = json.loads(next(out.glob("fake_*.json")).read_text())
    s = saved["summary"]
    assert s["numeric_accuracy"] == 100.0 and s["correct_refusals"] == 100.0
    assert s["false_refusals"] == 0.0 and s["grounded_answers"] == 100.0
    assert s["median_s"] == 2.0
    assert next(out.glob("fake_*.md")).read_text().startswith("# Eval results: fake")


def test_results_filename_keeps_dotted_model_name_and_never_overwrites(tmp_path):
    first = ev.result_base(tmp_path, "gemini-3.5-flash-lite", "2026-10-20")
    assert first.name == "gemini-3.5-flash-lite_2026-10-20"
    first.with_name(first.name + ".json").write_text("{}")
    second = ev.result_base(tmp_path, "gemini-3.5-flash-lite", "2026-10-20")
    assert second.name == "gemini-3.5-flash-lite_2026-10-20_2"


def test_refusal_ignores_pathogen_names_and_question_dates():
    q = {"id": "r", "type": "refusal", "question": "What was COVID-19 test positivity for the week ending March 6, 2027?",
         "expected_tools": []}
    resp = {"answer": "The data does not cover COVID-19 or SARS-CoV-2 for March 6, 2027.", "tool_calls": []}
    assert ev.score_one(q, None, resp)["correct"]
    resp = {"answer": "The data does not cover that; national positivity was 5%.", "tool_calls": []}
    assert not ev.score_one(q, None, resp)["correct"]


def test_names_are_not_numbers():
    assert ev.numbers_in("H5N1 and SARS-CoV-2 on gemini-3.5-flash-lite: 3.6%") == [3.6]


def test_grounding_accepts_difference_of_two_tool_values():
    calls = [call("get_test_positivity", {"rows": [{"v": 4.7}, {"v": 3.6}]})]
    assert ev.grounded("It fell by 1.1 points.", "q", calls)
    assert not ev.grounded("It fell by 2.3 points.", "q", calls)


def test_summary_carries_question_set():
    resp = {"answer": "3.6%", "tool_calls": [call("get_test_positivity", {"v": 3.6})], "elapsed_s": 1.0}
    rows = [ev.score_one(Q_NUM, [3.6], resp)]
    assert ev.summarize(rows, "cdc-q60-v1")["question_set"] == "cdc-q60-v1"
