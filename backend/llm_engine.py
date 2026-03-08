"""
LLM + RAG Engine — Local AI insights using Ollama + Mistral.
Queries DuckDB for context, injects into LLM prompt, generates natural language insights.
"""

import duckdb
import os
from pathlib import Path
from datetime import datetime
import json

DB_PATH = os.path.join(Path(__file__).parent.parent, "data", "cdc_surveillance.duckdb")

# Try importing ollama — graceful fallback if not running
try:
    import ollama
    OLLAMA_AVAILABLE = True
except ImportError:
    OLLAMA_AVAILABLE = False

# Default model — Mistral 7B is fast and accurate
LLM_MODEL = "mistral"


def get_data_context() -> str:
    """Build a data context string from DuckDB for RAG injection."""
    conn = duckdb.connect(DB_PATH, read_only=True)
    try:
        # Latest ARI activity
        ari = conn.execute("""
            SELECT geography, label FROM ari_activity
            WHERE week_end = (SELECT MAX(week_end) FROM ari_activity)
            ORDER BY geography
        """).fetchdf()

        # Latest positivity
        positivity = conn.execute("""
            SELECT pathogen, percent_test_positivity FROM test_positivity
            WHERE week_end = (SELECT MAX(week_end) FROM test_positivity)
        """).fetchdf()

        # Recent hospitalization trends
        hosp = conn.execute("""
            SELECT surveillance_network, AVG(weekly_rate) as avg_rate
            FROM hospitalization_rates
            WHERE age_group='Overall' AND sex='Overall' AND race_ethnicity='Overall'
              AND rate_type='Observed'
              AND week_ending_date >= (SELECT MAX(week_ending_date) - INTERVAL 28 DAY FROM hospitalization_rates)
            GROUP BY surveillance_network
        """).fetchdf()

        # High risk states
        high_risk = ari[ari["label"].isin(["High", "Very High"])]

        # Wastewater summary
        ww_summary = ""
        try:
            ww = conn.execute("""
                SELECT COUNT(DISTINCT county_fips) as counties,
                       AVG(percentile) as avg_percentile,
                       COUNT(*) as sites
                FROM wastewater_sites
                WHERE date_end = (SELECT MAX(date_end) FROM wastewater_sites)
            """).fetchdf()
            if len(ww) > 0:
                ww_summary = f"\nWastewater: Monitoring {int(ww.iloc[0]['sites'])} sites across {int(ww.iloc[0]['counties'])} counties. Average viral percentile: {ww.iloc[0]['avg_percentile']:.0f}th."
        except Exception:
            pass

        context = f"""CDC Surveillance Data — {datetime.now().strftime('%B %d, %Y')}

RESPIRATORY ILLNESS ACTIVITY:
{chr(10).join(f'- {row["geography"]}: {row["label"]}' for _, row in ari.iterrows() if row["label"] not in ["Data Unavailable"])}

HIGH RISK STATES: {', '.join(high_risk['geography'].tolist()) if len(high_risk) > 0 else 'None currently'}

TEST POSITIVITY (latest):
{chr(10).join(f'- {row["pathogen"]}: {row["percent_test_positivity"]:.1f}%' for _, row in positivity.iterrows())}

HOSPITALIZATION RATES (4-week average, per 100k):
{chr(10).join(f'- {row["surveillance_network"]}: {row["avg_rate"]:.1f}' for _, row in hosp.iterrows())}
{ww_summary}"""

        return context
    finally:
        conn.close()


def generate_weekly_brief() -> dict:
    """Generate an auto-generated weekly health brief using data analysis."""
    conn = duckdb.connect(DB_PATH, read_only=True)
    try:
        # Gather key metrics
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
        """).fetchdf()

        latest_date = conn.execute("SELECT MAX(week_end) FROM ari_activity").fetchone()[0]
        date_str = latest_date.isoformat()[:10] if hasattr(latest_date, "isoformat") else str(latest_date)[:10]

        # Build structured brief
        risk_dist = {row["label"]: int(row["cnt"]) for _, row in ari.iterrows()}
        pos_dict = {row["pathogen"]: float(row["percent_test_positivity"]) for _, row in positivity.iterrows()}

        high_risk_list = high_risk["geography"].tolist()

        # Generate plain-English summary
        total_states = sum(risk_dist.values())
        high_count = risk_dist.get("High", 0) + risk_dist.get("Very High", 0)

        summary_lines = [
            f"📋 **Weekly Respiratory Virus Brief** — Week ending {date_str}",
            "",
            f"**Overall Status**: {'⚠️ Elevated activity' if high_count > 3 else '✅ Generally low activity'} across {total_states} monitored jurisdictions.",
            "",
            "**Key Findings:**",
        ]

        if high_risk_list:
            summary_lines.append(f"- 🔴 **{len(high_risk_list)}** state(s) at High/Very High activity: {', '.join(high_risk_list)}")
        else:
            summary_lines.append("- ✅ No states at High or Very High respiratory illness activity")

        if pos_dict:
            dominant = max(pos_dict, key=pos_dict.get)
            summary_lines.append(f"- 🧪 Highest test positivity: **{dominant}** at {pos_dict[dominant]:.1f}%")
            for pathogen, rate in pos_dict.items():
                if pathogen != dominant:
                    summary_lines.append(f"- {pathogen}: {rate:.1f}% positivity")

        summary_lines.append("")
        summary_lines.append("**Risk Distribution:**")
        for label in ["Very High", "High", "Moderate", "Low", "Very Low", "Minimal"]:
            if label in risk_dist:
                emoji = {"Very High": "🔴", "High": "🟠", "Moderate": "🟡", "Low": "🔵", "Very Low": "🟢", "Minimal": "⚪"}.get(label, "")
                summary_lines.append(f"- {emoji} {label}: {risk_dist[label]} states")

        summary_lines.append("")
        summary_lines.append("*Data source: CDC SODA API | Analysis: LSTM + XGBoost ensemble*")

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


async def chat_with_data(question: str) -> dict:
    """RAG-powered chat — query DuckDB for context, then generate response."""
    context = get_data_context()

    # Try Ollama first
    if OLLAMA_AVAILABLE:
        try:
            response = ollama.chat(model=LLM_MODEL, messages=[
                {
                    "role": "system",
                    "content": f"""You are an expert public health data analyst for the CDC Outbreak Dashboard.
Answer questions using ONLY the data provided below. Be specific with numbers.
Keep answers concise (2-4 sentences). Use plain language anyone can understand.

CURRENT DATA:
{context}"""
                },
                {"role": "user", "content": question}
            ])
            return {
                "status": "success",
                "answer": response["message"]["content"],
                "model": LLM_MODEL,
                "engine": "ollama",
            }
        except Exception as e:
            # Ollama not running — fall back to rule-based
            pass

    # Fallback: rule-based response using data context
    return generate_rule_based_response(question, context)


def generate_rule_based_response(question: str, context: str) -> dict:
    """Intelligent rule-based response when LLM is not available."""
    q = question.lower()

    conn = duckdb.connect(DB_PATH, read_only=True)
    try:
        # State-specific questions
        states = conn.execute("SELECT DISTINCT geography FROM ari_activity").fetchdf()["geography"].tolist()
        matched_state = None
        for state in states:
            if state.lower() in q:
                matched_state = state
                break

        if matched_state:
            ari = conn.execute(
                "SELECT label FROM ari_activity WHERE geography=? AND week_end=(SELECT MAX(week_end) FROM ari_activity)",
                [matched_state]
            ).fetchone()
            label = ari[0] if ari else "Unknown"
            return {
                "status": "success",
                "answer": f"{matched_state} currently has **{label}** respiratory illness activity according to the latest CDC data. "
                          f"This is based on the Acute Respiratory Illness (ARI) surveillance system which monitors outpatient visits for respiratory symptoms.",
                "model": "rule-based",
                "engine": "fallback",
            }

        # COVID/Flu/RSV questions
        if any(w in q for w in ["covid", "positivity", "test", "flu", "rsv", "influenza"]):
            pos = conn.execute("""
                SELECT pathogen, percent_test_positivity FROM test_positivity
                WHERE week_end = (SELECT MAX(week_end) FROM test_positivity)
            """).fetchdf()
            lines = [f"**{row['pathogen']}**: {row['percent_test_positivity']:.1f}%" for _, row in pos.iterrows()]
            return {
                "status": "success",
                "answer": f"Current test positivity rates:\n" + "\n".join(f"- {l}" for l in lines) +
                          "\n\nThese represent the percentage of respiratory virus tests coming back positive nationwide.",
                "model": "rule-based",
                "engine": "fallback",
            }

        # Risk/outbreak questions
        if any(w in q for w in ["risk", "high", "outbreak", "danger", "worst", "concern"]):
            high = conn.execute("""
                SELECT geography, label FROM ari_activity
                WHERE week_end = (SELECT MAX(week_end) FROM ari_activity)
                  AND label IN ('High', 'Very High')
            """).fetchdf()
            if len(high) > 0:
                states_list = ", ".join(high["geography"].tolist())
                return {
                    "status": "success",
                    "answer": f"Currently, **{len(high)} state(s)** are at High or Very High respiratory illness activity: {states_list}. "
                              f"These states are experiencing elevated levels of outpatient visits for respiratory symptoms.",
                    "model": "rule-based",
                    "engine": "fallback",
                }
            else:
                return {
                    "status": "success",
                    "answer": "Currently, **no states** are at High or Very High respiratory illness activity. "
                              "Activity levels are generally low across the country.",
                    "model": "rule-based",
                    "engine": "fallback",
                }

        # General/summary questions
        brief = generate_weekly_brief()
        return {
            "status": "success",
            "answer": brief["brief"],
            "model": "rule-based",
            "engine": "fallback",
        }
    finally:
        conn.close()
