"""Unit tests for dual-layer metric helpers — fail closed, never invent figures."""

from backend.insights import (
    build_briefing,
    combine_insight,
    high_risk_plain,
    hosp_per_100k_plain,
    metric_card,
    positivity_one_in_n,
    positivity_plain,
    wow_plain,
)


def test_positivity_one_in_n_known_values():
    assert positivity_one_in_n(3.6) == 28
    assert positivity_one_in_n(50) == 2
    assert positivity_one_in_n(100) == 1
    assert positivity_plain(3.6) == "about 1 in 28 tests positive"


def test_positivity_omits_on_bad_input():
    for bad in (None, 0, -1, 100.1, "x", float("nan"), float("inf")):
        assert positivity_one_in_n(bad) is None
        assert positivity_plain(bad) is None


def test_hosp_and_high_risk_plain():
    assert hosp_per_100k_plain(0.8) == "0.8 hospitalizations per 100,000 people this week"
    assert hosp_per_100k_plain(None) is None
    assert high_risk_plain(2, 3) == "2 of 3 states/territories at High or Very High activity"
    assert high_risk_plain(4, 3) is None  # impossible count
    assert high_risk_plain(0, 0) is None


def test_wow_omits_without_prior():
    assert wow_plain(3.6, None, as_percent=True) is None
    assert wow_plain(3.6, 4.1, as_percent=True) == "down from 4.1% last week"
    assert wow_plain(4.1, 3.6, as_percent=True) == "up from 3.6% last week"
    assert wow_plain(3.6, 3.6, as_percent=True) == "unchanged from last week"
    assert combine_insight("about 1 in 28 tests positive", "down from 4.1% last week") == (
        "about 1 in 28 tests positive · down from 4.1% last week"
    )
    assert combine_insight(None, None) is None


def test_metric_card_and_briefing_use_only_passed_numbers():
    card = metric_card(
        headline="COVID positivity",
        value=3.6,
        unit="%",
        plain="about 1 in 28 tests positive",
        week_ending="2026-10-10",
        source_table="test_positivity",
    )
    assert card["insight"] == "about 1 in 28 tests positive"
    assert card["week_ending"] == "2026-10-10"
    briefing = build_briefing(
        week_ending="2026-10-10",
        high_risk=2,
        total_states=3,
        positivity=[{"pathogen": "COVID-19", "percent_test_positivity": 3.6}],
    )
    assert briefing["week_ending"] == "2026-10-10"
    assert "2026-10-10" in briefing["this_week"]
    assert "2 of 3" in briefing["this_week"]
    assert "3.6%" in briefing["this_week"]
    assert "1 in 28" in briefing["this_week"]
    assert "not clinical" in briefing["implication"].lower() or "official CDC" in briefing["implication"]
