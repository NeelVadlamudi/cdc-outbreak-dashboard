"""
Hospital Capacity Monte Carlo Simulator.
Models surge scenarios and estimates resource impact.
"""

import numpy as np
from dataclasses import dataclass
import duckdb
import os
from pathlib import Path

DB_PATH = os.path.join(Path(__file__).parent.parent, "data", "cdc_surveillance.duckdb")


@dataclass
class SimulationParams:
    """Parameters for hospital capacity simulation."""
    population: int = 1_000_000
    current_rate_per_100k: float = 5.0
    surge_multiplier: float = 2.0
    hospitalization_pct: float = 10.0  # % of cases that need hospitalization
    icu_pct: float = 20.0  # % of hospitalizations needing ICU
    avg_los_days: float = 5.0  # average length of stay
    icu_los_days: float = 10.0
    beds_available: int = 500
    icu_beds_available: int = 50
    cost_per_bed_day: float = 3000.0
    cost_per_icu_day: float = 8000.0
    num_simulations: int = 1000
    weeks_to_simulate: int = 8


def run_simulation(params: SimulationParams) -> dict:
    """Run Monte Carlo hospital capacity simulation."""
    results = {
        "weeks": [],
        "bed_demand_mean": [],
        "bed_demand_p5": [],
        "bed_demand_p95": [],
        "icu_demand_mean": [],
        "icu_demand_p5": [],
        "icu_demand_p95": [],
        "overflow_probability": [],
        "icu_overflow_probability": [],
    }

    total_costs = []

    for week in range(params.weeks_to_simulate):
        # Simulate rate trajectory with uncertainty
        week_multiplier = 1.0 + (params.surge_multiplier - 1.0) * min(1.0, week / 4)

        # Random variation per simulation
        bed_demands = []
        icu_demands = []
        week_costs = []

        for _ in range(params.num_simulations):
            # Stochastic rate with noise
            noise_factor = np.random.lognormal(0, 0.15)
            rate = params.current_rate_per_100k * week_multiplier * noise_factor

            # New weekly cases
            weekly_cases = rate * (params.population / 100_000)

            # Hospitalizations (stochastic)
            hosp_rate = params.hospitalization_pct / 100 * np.random.normal(1, 0.1)
            new_hosp = max(0, weekly_cases * hosp_rate)

            # ICU admissions
            icu_rate = params.icu_pct / 100 * np.random.normal(1, 0.15)
            new_icu = max(0, new_hosp * icu_rate)

            # Census (accounting for length of stay overlap)
            occupied_beds = new_hosp * min(params.avg_los_days / 7, 1.5)
            occupied_icu = new_icu * min(params.icu_los_days / 7, 2.0)

            bed_demands.append(occupied_beds)
            icu_demands.append(occupied_icu)

            # Cost
            cost = (occupied_beds * params.cost_per_bed_day * 7 +
                    occupied_icu * params.cost_per_icu_day * 7)
            week_costs.append(cost)

        bed_arr = np.array(bed_demands)
        icu_arr = np.array(icu_demands)

        results["weeks"].append(week + 1)
        results["bed_demand_mean"].append(round(float(np.mean(bed_arr)), 1))
        results["bed_demand_p5"].append(round(float(np.percentile(bed_arr, 5)), 1))
        results["bed_demand_p95"].append(round(float(np.percentile(bed_arr, 95)), 1))
        results["icu_demand_mean"].append(round(float(np.mean(icu_arr)), 1))
        results["icu_demand_p5"].append(round(float(np.percentile(icu_arr, 5)), 1))
        results["icu_demand_p95"].append(round(float(np.percentile(icu_arr, 95)), 1))
        results["overflow_probability"].append(round(float(np.mean(bed_arr > params.beds_available) * 100), 1))
        results["icu_overflow_probability"].append(round(float(np.mean(icu_arr > params.icu_beds_available) * 100), 1))
        total_costs.extend(week_costs)

    results["total_cost_mean"] = round(float(np.mean(total_costs)) * params.weeks_to_simulate, 0)
    results["total_cost_p95"] = round(float(np.percentile(total_costs, 95)) * params.weeks_to_simulate, 0)
    results["params"] = {
        "population": params.population,
        "current_rate": params.current_rate_per_100k,
        "surge_multiplier": params.surge_multiplier,
        "beds_available": params.beds_available,
        "icu_beds_available": params.icu_beds_available,
    }

    return results


def get_current_rates() -> dict:
    """Get current hospitalization rates for simulation defaults."""
    conn = duckdb.connect(DB_PATH, read_only=True)
    try:
        df = conn.execute("""
            SELECT surveillance_network, AVG(weekly_rate) as rate
            FROM hospitalization_rates
            WHERE age_group='Overall' AND sex='Overall' AND race_ethnicity='Overall'
              AND rate_type='Observed'
              AND week_ending_date = (SELECT MAX(week_ending_date) FROM hospitalization_rates)
            GROUP BY surveillance_network
        """).fetchdf()
        return {row["surveillance_network"]: round(float(row["rate"]), 2) for _, row in df.iterrows()}
    finally:
        conn.close()
