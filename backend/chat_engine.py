"""Rule-based weekly brief from DuckDB aggregates.

Unverified free-form chat (`chat_with_data` / Ollama RAG) was retired with
`POST /api/chat` (HTTP 410). Ask traffic must use `POST /api/agent/ask`.
"""

from __future__ import annotations

import duckdb

from backend.config import DB_PATH


def generate_weekly_brief() -> dict:
    """Weekly brief from DuckDB aggregates only — no LLM, no forecast models."""
    conn = duckdb.connect(DB_PATH, read_only=True)
    try:
        ari = conn.execute("""
            SELECT label, COUNT(*) as cnt FROM ari_activity
            WHERE week_end = (SELECT MAX(week_end) FROM ari_activity)
            GROUP BY label ORDER BY cnt DESC
        """).fetchdf()

        positivity = conn.execute("""
            SELECT pathogen, percent_test_positivity FROM test_positivity
            WHERE week_end = (SELECT MAX(week_end) FROM test_positivity)
        """).fetchdf()

        high_risk = conn.execute("""
            SELECT geography FROM ari_activity
            WHERE week_end = (SELECT MAX(week_end) FROM ari_activity)
              AND label IN ('High', 'Very High')
            ORDER BY geography
        """).fetchdf()

        latest_date = conn.execute("SELECT MAX(week_end) FROM ari_activity").fetchone()[0]
        date_str = (
            latest_date.isoformat()[:10]
            if hasattr(latest_date, "isoformat")
            else str(latest_date)[:10]
        )

        risk_dist = {row["label"]: int(row["cnt"]) for _, row in ari.iterrows()}
        pos_dict = {
            row["pathogen"]: float(row["percent_test_positivity"])
            for _, row in positivity.iterrows()
        }
        high_risk_list = high_risk["geography"].tolist() if len(high_risk) else []

        total_states = sum(risk_dist.values())
        high_count = risk_dist.get("High", 0) + risk_dist.get("Very High", 0)
        activity = (
            "Elevated activity (High / Very High present)"
            if high_count > 3
            else "Generally low High/Very High counts"
        )

        summary_lines = [
            f"Weekly respiratory virus brief — CDC week ending {date_str}",
            "",
            f"Overall: {activity} across {total_states} monitored jurisdictions "
            "(epidemiology week, not wall-clock).",
            "",
            "Key findings:",
        ]

        if high_risk_list:
            summary_lines.append(
                f"- {len(high_risk_list)} jurisdiction(s) at High/Very High ARI: "
                f"{', '.join(high_risk_list)}"
            )
        else:
            summary_lines.append(
                "- No jurisdictions at High or Very High respiratory illness activity"
            )

        if pos_dict:
            dominant = max(pos_dict, key=pos_dict.get)
            summary_lines.append(
                f"- Highest test positivity: {dominant} at {pos_dict[dominant]:.1f}%"
            )
            for pathogen, rate in pos_dict.items():
                if pathogen != dominant:
                    summary_lines.append(f"- {pathogen}: {rate:.1f}% positivity")

        summary_lines.append("")
        summary_lines.append("Risk distribution:")
        for label in ["Very High", "High", "Moderate", "Low", "Very Low", "Minimal"]:
            if label in risk_dist:
                summary_lines.append(f"- {label}: {risk_dist[label]} jurisdictions")

        summary_lines.append("")
        summary_lines.append(
            "Data source: public CDC SODA tables in DuckDB. "
            "This brief is rule-based aggregation only — not LSTM/XGBoost and not clinical advice."
        )

        return {
            "status": "success",
            "date": date_str,
            "brief": "\n".join(summary_lines),
            "risk_distribution": risk_dist,
            "positivity": pos_dict,
            "high_risk_states": high_risk_list,
        }
    finally:
        conn.close()
