"""Read-only query plans shared by the API and the browser export."""

from itertools import product

PUBLIC_COLUMNS = {
    "ari_activity": ["week_end", "geography", "label", "buildnumber"],
    "hospitalization_rates": ["surveillance_network", "season", "week_ending_date", "mmwr_year",
                              "mmwr_week", "age_group", "sex", "race_ethnicity", "site",
                              "weekly_rate", "cumulative_rate", "rate_type"],
    "test_positivity": ["week_end", "pathogen", "percent_test_positivity"],
    "wastewater_sites": ["wwtp_jurisdiction", "wwtp_id", "county_names", "county_fips",
                         "population_served", "date_end", "ptc_15d", "detect_prop_15d",
                         "percentile", "pathogen", "wval", "wval_category", "source_dataset"],
}

LEGACY_NOTE = "Legacy NWSS SARS-CoV-2 metrics (dataset 2ew6-ywp6); CDC stopped updating them after 2025-09-07."


def ww_meta(dataset):
    return {
        "dataset": dataset,
        "source_dataset": "2ew6-ywp6" if dataset == "legacy" else "atcp-73re",
        "note": LEGACY_NOTE if dataset == "legacy" else
                "CDC Wastewater Viral Activity Level (WVAL) by site, week and pathogen.",
    }


SPECS = {
    "/ari-activity": {
        "defaults": {"week_end": None, "geography": None},
        "optional": ["week_end", "geography"],
    },
    "/ari-activity/history": {"defaults": {"geography": "Alabama"}, "optional": []},
    "/hospitalizations": {
        "defaults": {"network": None, "site": None, "age_group": "Overall", "limit": 200},
        "optional": ["network", "site"], "integers": ["limit"],
    },
    "/test-positivity": {
        "defaults": {"pathogen": None, "limit": 200},
        "optional": ["pathogen"], "integers": ["limit"],
    },
    "/wastewater": {
        "defaults": {"state": None, "pathogen": None, "dataset": "current", "limit": 5000},
        "optional": ["state", "pathogen"], "integers": ["limit"], "max_limit": 50000,
        "datasets": ["current", "legacy"],
    },
    "/wastewater/county/{fips}": {"defaults": {"fips": ""}, "optional": []},
}


def plan_for(path, values):
    """Use stable tie ordering so native and browser engines choose identical limits."""
    bindings = []
    meta = {}
    count = path != "/ari-activity/history" and path != "/wastewater/county/{fips}"

    def bind(name):
        bindings.append(name)
        return "?"

    def optional(name, column):
        return f" AND {column} = {bind(name)}" if values.get(name) else ""

    if path == "/ari-activity":
        sql = "SELECT week_end, geography, label, buildnumber FROM ari_activity WHERE "
        sql += f"week_end = {bind('week_end')}" if values.get("week_end") else \
            "week_end = (SELECT MAX(week_end) FROM ari_activity)"
        sql += optional("geography", "geography") + " ORDER BY geography"
    elif path == "/ari-activity/history":
        sql = f"""SELECT week_end, geography, label FROM ari_activity
            WHERE geography = {bind('geography')} ORDER BY week_end DESC LIMIT 52"""
    elif path == "/hospitalizations":
        sql = f"""SELECT surveillance_network, season, week_ending_date, mmwr_year, mmwr_week,
            age_group, site, weekly_rate, cumulative_rate FROM hospitalization_rates
            WHERE age_group = {bind('age_group')} AND sex IN ('All', 'Overall')
            AND race_ethnicity IN ('All', 'Overall') AND rate_type = 'Observed'"""
        sql += optional("network", "surveillance_network") + optional("site", "site")
        sql += " ORDER BY week_ending_date DESC, surveillance_network, site, season, mmwr_year, mmwr_week, weekly_rate, cumulative_rate"
        sql += f" LIMIT {bind('limit')}"
    elif path == "/test-positivity":
        sql = "SELECT week_end, pathogen, percent_test_positivity FROM test_positivity WHERE 1=1"
        sql += optional("pathogen", "pathogen")
        sql += f" ORDER BY week_end DESC, pathogen LIMIT {bind('limit')}"
    elif path == "/wastewater":
        dataset = values["dataset"]
        if dataset == "legacy":
            sql = """SELECT wwtp_jurisdiction, wwtp_id, county_names, county_fips, population_served,
                date_end, ptc_15d AS legacy_ptc_15d, detect_prop_15d AS legacy_detect_prop_15d,
                percentile AS legacy_percentile FROM wastewater_sites WHERE source_dataset = '2ew6-ywp6'"""
        else:
            sql = """SELECT wwtp_jurisdiction, wwtp_id, county_names, population_served,
                date_end AS week_end, pathogen, wval, wval_category
                FROM wastewater_sites WHERE source_dataset = 'atcp-73re'"""
        sql += optional("state", "wwtp_jurisdiction")
        if dataset == "current":
            sql += optional("pathogen", "pathogen")
        sql += " ORDER BY date_end DESC, wwtp_jurisdiction, wwtp_id, pathogen, county_names, county_fips, population_served, wval, wval_category, ptc_15d, detect_prop_15d, percentile"
        sql += f" LIMIT {bind('limit')}"
        meta = ww_meta(dataset)
    elif path == "/wastewater/county/{fips}":
        sql = f"""SELECT date_end,
            CASE WHEN percentile BETWEEN 0 AND 100 THEN percentile END AS legacy_percentile,
            CASE WHEN ptc_15d NOT IN (-99, 2147483647) THEN ptc_15d END AS legacy_ptc_15d,
            population_served, county_names, wwtp_jurisdiction FROM wastewater_sites
            WHERE source_dataset = '2ew6-ywp6' AND county_fips = {bind('fips')}
            ORDER BY date_end, wwtp_jurisdiction, county_names, population_served, legacy_percentile, legacy_ptc_15d"""
        meta = ww_meta("legacy")
    else:
        raise ValueError(f"Unsupported read query: {path}")
    return {"sql": sql, "bindings": bindings, "meta": meta, "count": count}


def browser_plans():
    """Export SQL, not another hand-maintained copy of the queries."""
    out = {}
    for path, spec in SPECS.items():
        plans = []
        for dataset in spec.get("datasets", [None]):
            for mask in product([False, True], repeat=len(spec["optional"])):
                values = dict(spec["defaults"])
                present = dict(zip(spec["optional"], mask, strict=True))
                values.update({name: "present" if enabled else None for name, enabled in present.items()})
                if dataset:
                    values["dataset"] = dataset
                plans.append({**plan_for(path, values), "present": present, "dataset": dataset})
        out[path] = {**spec, "plans": plans}
    return out


def read_payload(path, values, query):
    plan = plan_for(path, values)
    rows = query(plan["sql"], [values[name] for name in plan["bindings"]])
    result = {**plan["meta"], "data": rows}
    if plan["count"]:
        result["count"] = len(rows)
    if "fips" in values:
        result["county_fips"] = values["fips"]
    return result
