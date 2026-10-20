from backend.agent.checker import check_numbers


def test_numbers_found_after_rounding():
    outputs = [{"rows": [{"percent_positive": 3.6123}], "as_of": "2026-10-10"}]
    assert check_numbers("COVID positivity was 3.6% for the week ending 2026-10-10.", outputs)["passed"]


def test_unknown_number_fails():
    result = check_numbers("Positivity was 7.2%.", [{"rows": [{"percent_positive": 3.6}]}])
    assert not result["passed"]
    assert result["unverified"] == ["7.2"]


def test_row_counts_allowed():
    outputs = [{"rows": [{"state": "Texas"}, {"state": "Utah"}]}]
    assert check_numbers("2 states are at High.", outputs)["passed"]


def test_difference_of_two_values_passes():
    outputs = [{"rows": [{"percent_positive": 3.6}, {"percent_positive": 4.7}]}]
    assert check_numbers("Positivity fell by 1.1 points.", outputs)["passed"]
    assert check_numbers("Positivity changed by -1.1 points.", outputs)["passed"]


def test_sum_of_two_values_passes():
    outputs = [{"rows": [{"n": 40}, {"n": 10}]}]
    assert check_numbers("50 states and territories in total.", outputs)["passed"]


def test_unrelated_number_still_fails():
    outputs = [{"rows": [{"n": 40}, {"n": 10}]}]
    assert not check_numbers("There were 77 sites.", outputs)["passed"]
