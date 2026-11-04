"""Plain-language dual-layer metrics for CDC weekly surveillance figures.

Every helper is pure and fail-closed: missing, zero, or non-finite inputs return
None rather than inventing a number or week-over-week story.
"""

from __future__ import annotations

from typing import Any


def _finite(value: Any) -> float | None:
    if value is None:
        return None
    try:
        x = float(value)
    except (TypeError, ValueError):
        return None
    if x != x or x in (float("inf"), float("-inf")):  # NaN / inf
        return None
    return x


def _nonneg_int(value: Any) -> int | None:
    x = _finite(value)
    if x is None or x < 0 or x != int(x):
        return None
    return int(x)


def positivity_one_in_n(percent: Any) -> int | None:
    """Map a 0–100 positivity percent to N for “about 1 in N tests positive”.

    Returns None when the percent is missing, non-positive, or above 100
    (cannot form a meaningful reciprocal without inventing a figure).
    """
    p = _finite(percent)
    if p is None or p <= 0 or p > 100:
        return None
    return max(1, round(100.0 / p))


def positivity_plain(percent: Any) -> str | None:
    n = positivity_one_in_n(percent)
    if n is None:
        return None
    return f"about 1 in {n} tests positive"


def hosp_per_100k_plain(rate: Any) -> str | None:
    """RESP-NET weekly rate is already hospitalizations per 100,000 population."""
    r = _finite(rate)
    if r is None or r < 0:
        return None
    shown = f"{r:.1f}".rstrip("0").rstrip(".")
    return f"{shown} hospitalizations per 100,000 people this week"


def high_risk_plain(count: Any, total: Any) -> str | None:
    n = _nonneg_int(count)
    m = _nonneg_int(total)
    if n is None or m is None or m <= 0 or n > m:
        return None
    return f"{n} of {m} states/territories at High or Very High activity"


def wow_plain(current: Any, prior: Any, *, as_percent: bool = False) -> str | None:
    """Week-over-week caption when both weeks are present. Omits on ties of missing data."""
    cur = _finite(current)
    prev = _finite(prior)
    if cur is None or prev is None:
        return None
    if as_percent:
        prior_txt = f"{prev:g}%"
    else:
        prior_txt = f"{prev:g}"
    if cur > prev:
        return f"up from {prior_txt} last week"
    if cur < prev:
        return f"down from {prior_txt} last week"
    return "unchanged from last week"


def combine_insight(*parts: str | None) -> str | None:
    bits = [p for p in parts if p]
    return " · ".join(bits) if bits else None


def metric_card(
    *,
    headline: str,
    value: Any,
    unit: str | None = None,
    plain: str | None = None,
    insight: str | None = None,
    week_ending: str | None = None,
    source_table: str | None = None,
) -> dict:
    """Dual-layer metric payload. Callers must pass only values already in the DB."""
    return {
        "headline": headline,
        "value": value,
        "unit": unit,
        "plain": plain,
        "insight": insight if insight is not None else plain,
        "week_ending": week_ending,
        "source_table": source_table,
    }


def build_briefing(
    *,
    week_ending: str | None,
    high_risk: int | None,
    total_states: int | None,
    positivity: list[dict] | None = None,
) -> dict:
    """MMWR-shaped three beats from known CDC signals + this week's DB figures only."""
    known = (
        "CDC weekly respiratory surveillance covers outpatient acute respiratory illness (ARI) "
        "activity by jurisdiction, clinical test positivity, RESP-NET hospitalization rates, "
        "and NWSS wastewater viral activity—published on an epidemiology-week cadence, not as "
        "second-by-second case counts."
    )

    week = week_ending or "the latest available CDC week"
    facts: list[str] = []
    hr_plain = high_risk_plain(high_risk, total_states)
    if hr_plain:
        facts.append(hr_plain)
    for row in positivity or []:
        pathogen = row.get("pathogen")
        pct = row.get("percent_test_positivity")
        plain = positivity_plain(pct)
        if pathogen and pct is not None and plain:
            facts.append(f"{pathogen} test positivity {pct:g}% ({plain})")
    if facts:
        this_week = f"For the CDC week ending {week}: " + "; ".join(facts) + "."
    else:
        this_week = (
            f"For the CDC week ending {week}: summary figures were not available from the "
            "loaded DuckDB tables."
        )

    if high_risk is None or total_states is None or total_states <= 0:
        implication = (
            "Use the precise table figures and week stamps below for situational awareness; "
            "this product is not clinical decision support or official CDC guidance."
        )
    elif high_risk >= 5:
        implication = (
            f"{high_risk} of {total_states} tracked jurisdictions reported High or Very High "
            "ARI activity this CDC week—useful context for hospital ops and infection-prevention "
            "planning. Research and education use only—not clinical decision-making or official "
            "CDC guidance."
        )
    elif high_risk == 0:
        implication = (
            "No tracked jurisdictions are at High or Very High ARI activity in this week's "
            "data; keep watching positivity and hospitalization trends. Research and "
            "education use only—not clinical decision-making or official CDC guidance."
        )
    else:
        implication = (
            f"{high_risk} of {total_states} tracked jurisdictions at High or Very High activity "
            "is a focused watch list for ops and coordinators this week. Research and "
            "education use only—not clinical decision-making or official CDC guidance."
        )

    return {
        "known": known,
        "this_week": this_week,
        "implication": implication,
        "week_ending": week_ending,
    }
