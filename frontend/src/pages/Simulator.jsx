import { useState } from "react";
import Plot from "../components/Plot";
import { Hospital, AlertTriangle, TrendingUp, Settings, Activity, Play } from "lucide-react";
import { runSimulator, getSimDefaults } from "../api";

import defaultScenario from "../data/simulator-default.json";

const INITIAL_PARAMS = defaultScenario.params;

export default function Simulator() {
  const [params, setParams] = useState(INITIAL_PARAMS);
  const [results, setResults] = useState(defaultScenario.result);
  const [resultParams, setResultParams] = useState(INITIAL_PARAMS);
  const [showingDefault, setShowingDefault] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [defaults, setDefaults] = useState(null);

  const [ratesError, setRatesError] = useState("");

  const loadPublishedRates = async () => {
    try {
      setDefaults(await getSimDefaults());
      setRatesError("");
    } catch {
      setRatesError("Published CDC rates are unavailable. The example scenario is still available.");
    }
  };

  const runSim = async () => {
    const requested = { ...params };
    setLoading(true);
    setError("");
    try {
      const res = await runSimulator(requested);
      setResults(res);
      setResultParams(requested);
      setShowingDefault(false);
    } catch {
      setError(`Could not run the scenario: the simulation service is unavailable. Showing the ${showingDefault ? "pre-built default" : "last completed"} result. Please retry later.`);
    } finally {
      setLoading(false);
    }
  };

  const updateParam = (key, value) => {
    setParams((prev) => ({ ...prev, [key]: Number(value) }));
  };

  const formatCurrency = (val) => {
    if (val >= 1e9) return `$${(val / 1e9).toFixed(1)}B`;
    if (val >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
    if (val >= 1e3) return `$${(val / 1e3).toFixed(0)}K`;
    return `$${val.toFixed(0)}`;
  };

  const sliders = [
    { key: "surge_multiplier", label: "How strong is the surge?", min: 1, max: 5, step: 0.1, unit: "x" },
    { key: "population", label: "Population covered", min: 100000, max: 10000000, step: 100000, unit: "", format: (v) => v.toLocaleString() },
    { key: "current_rate", label: "Current rate (per 100k)", min: 0.5, max: 30, step: 0.5, unit: "" },
    { key: "hospitalization_pct", label: "Share needing hospital care", min: 1, max: 30, step: 1, unit: "%" },
    { key: "icu_pct", label: "Share of hospital patients in ICU", min: 5, max: 50, step: 5, unit: "%" },
    { key: "beds_available", label: "Hospital beds available", min: 50, max: 2000, step: 50, unit: "" },
    { key: "icu_beds_available", label: "ICU beds available", min: 10, max: 500, step: 10, unit: "" },
  ];

  const plotLayout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'Space Grotesk, sans-serif', color: '#6b6b6b', size: 11 },
    margin: { t: 20, b: 60, l: 60, r: 20 },
    xaxis: { gridcolor: '#e8e8e8', zeroline: false },
    yaxis: { gridcolor: '#e8e8e8', zeroline: false },
    showlegend: true,
    legend: { orientation: "h", y: -0.25, font: { color: '#3a3a3a' } },
  };

  return (
    <div className="page-container">
      <div className="page-header fade-in">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">Surge planning</h1>
            <p className="page-subtitle">
              Explore how hospital capacity might look under different surge assumptions. Adjust the knobs, then run a scenario.
            </p>
          </div>
          <button onClick={runSim} className="filter-btn active" disabled={loading} style={{ padding: '10px 24px', fontSize: '14px' }}>
            {loading ? <><Activity className="animate-pulse" size={16} /> Running scenarios…</> : <><Play size={16} fill="currentColor" /> Run scenario</>}
          </button>
        </div>
      </div>

      <p role="status" id="simulation-source" className="alert-banner info">
        {showingDefault ? "Showing a pre-built default result: an illustrative example, not a forecast. Press Run to calculate a new scenario." : "Showing the last completed scenario."}
      </p>
      {error && <div role="alert" className="alert-banner danger">{error}</div>}

      <div className="simulator-layout fade-in" style={{ display: "grid", gridTemplateColumns: "minmax(260px, 320px) 1fr", gap: "20px" }}>
        <div className="card" style={{ position: "sticky", top: "24px", alignSelf: "start", padding: "22px" }}>
          <div className="card-header" style={{ marginBottom: "20px" }}>
            <span className="card-title"><Settings size={18} /> Scenario settings</span>
          </div>

          {!defaults && <button className="filter-btn" onClick={loadPublishedRates}>Load published CDC rates</button>}
          {ratesError && <p role="alert">{ratesError}</p>}
          {defaults?.current_rates && (
            <div style={{
              padding: "16px", borderRadius: "var(--radius-md)", marginBottom: "24px",
              background: "var(--accent-primary-glow)", border: "1px solid var(--border-accent)",
            }}>
              <strong style={{ color: "var(--accent-primary)", fontSize: "13px" }}>Published CDC rates</strong>
              <div style={{ display: "grid", gap: "8px", marginTop: "12px" }}>
                {Object.entries(defaults.current_rates).map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "13px" }}>
                    <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>{k}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <strong style={{ color: "var(--text-primary)" }}>{v}/100k</strong>
                      <button
                        onClick={() => updateParam("current_rate", v)}
                        style={{
                          padding: "4px 8px", borderRadius: "12px", border: "1px solid var(--border-accent)",
                          background: "var(--bg-card)", color: "var(--accent-primary)", cursor: "pointer",
                          fontSize: "11px", fontWeight: 600, transition: "all 0.2s"
                        }}
                      >
                        Use
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "grid", gap: "24px" }}>
            {sliders.map((s) => (
              <div key={s.key}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                  <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 600 }}>{s.label}</label>
                  <span style={{ fontSize: "14px", fontWeight: 800, color: "var(--text-primary)" }}>
                    {s.format ? s.format(params[s.key]) : params[s.key]}{s.unit}
                  </span>
                </div>
                <input
                  type="range"
                  min={s.min}
                  max={s.max}
                  step={s.step}
                  value={params[s.key]}
                  onChange={(e) => updateParam(s.key, e.target.value)}
                  className="range-slider"
                />
              </div>
            ))}
          </div>

          <button 
            onClick={runSim} 
            className="filter-btn active" 
            style={{ width: "100%", marginTop: "32px", padding: "12px 0", justifyContent: "center" }}
            disabled={loading}
          >
            {loading ? "⏳ Running..." : "▶ Run Simulation"}
          </button>
        </div>

        <div>
          {results && (
            <>
              <div className="stat-cards-grid" style={{ '--stat-columns': 2, marginBottom: "24px", gap: "16px" }}>
                <div className="stat-card accent-indigo">
                  <div className="stat-card-icon indigo"><Hospital size={22} /></div>
                  <div className="stat-card-label">Peak Bed Demand</div>
                  <div className="stat-card-value">
                    {Math.max(...results.bed_demand_mean).toFixed(0)}
                  </div>
                  <div style={{ marginTop: "12px", fontSize: "13px", fontWeight: 600, color: Math.max(...results.bed_demand_mean) > resultParams.beds_available ? "var(--color-high)" : "var(--color-safe)" }}>
                    {Math.max(...results.bed_demand_mean) > resultParams.beds_available ? "⚠️ Exceeds capacity" : "✅ Within capacity"}
                  </div>
                </div>
                <div className="stat-card accent-rose">
                  <div className="stat-card-icon rose"><AlertTriangle size={22} /></div>
                  <div className="stat-card-label">Peak ICU Demand</div>
                  <div className="stat-card-value">
                    {Math.max(...results.icu_demand_mean).toFixed(0)}
                  </div>
                  <div style={{ marginTop: "12px", fontSize: "13px", fontWeight: 600, color: Math.max(...results.icu_demand_mean) > resultParams.icu_beds_available ? "var(--color-high)" : "var(--color-safe)" }}>
                    {Math.max(...results.icu_demand_mean) > resultParams.icu_beds_available ? "⚠️ ICU overflow risk" : "✅ ICU OK"}
                  </div>
                </div>
                <div className="stat-card accent-amber">
                  <div className="stat-card-icon amber"><TrendingUp size={22} /></div>
                  <div className="stat-card-label">Overflow Risk (Max)</div>
                  <div className="stat-card-value">
                    {Math.max(...results.overflow_probability).toFixed(0)}%
                  </div>
                  <div style={{ marginTop: "12px", fontSize: "13px", fontWeight: 600, color: "var(--color-moderate)" }}>Probability peak</div>
                </div>
                <div className="stat-card accent-emerald">
                  <div className="stat-card-icon emerald"><Activity size={22} /></div>
                  <div className="stat-card-label">Est. Total Cost</div>
                  <div className="stat-card-value">
                    {formatCurrency(results.total_cost_mean || 0)}
                  </div>
                  <div style={{ marginTop: "12px", fontSize: "13px", fontWeight: 600, color: "var(--color-safe)" }}>
                    P95: {formatCurrency(results.total_cost_p95 || 0)}
                  </div>
                </div>
              </div>

              <div className="card" style={{ marginBottom: "24px" }}>
                <div className="card-header">
                  <span className="card-title"><Hospital size={18} /> Hospital Bed Demand Projection</span>
                </div>
                <Plot divId="simulator-beds"
                  data={[
                    {
                      x: results.weeks, y: results.bed_demand_p95,
                      type: "scatter", mode: "lines", name: "95th percentile",
                      line: { color: "rgba(79, 70, 229, 0.2)", width: 0 },
                      fill: "none", showlegend: false,
                    },
                    {
                      x: results.weeks, y: results.bed_demand_p5,
                      type: "scatter", mode: "lines", name: "Confidence interval",
                      line: { color: "rgba(79, 70, 229, 0.2)", width: 0 },
                      fill: "tonexty", fillcolor: "rgba(79, 70, 229, 0.1)",
                    },
                    {
                      x: results.weeks, y: results.bed_demand_mean,
                      type: "scatter", mode: "lines+markers",
                      name: "Mean bed demand", line: { color: "#0000d9", width: 2.5 },
                      marker: { size: 7, line: { color: 'white', width: 1 } },
                    },
                    {
                      x: results.weeks, y: results.weeks.map(() => resultParams.beds_available),
                      type: "scatter", mode: "lines",
                      name: "Capacity", line: { color: "#DC2626", width: 2, dash: "dash" },
                    },
                  ]}
                  layout={{
                    ...plotLayout,
                    xaxis: { ...plotLayout.xaxis, title: { text: "Week" } },
                    yaxis: { ...plotLayout.yaxis, title: { text: "Beds Needed" } },
                    height: 350,
                  }}
                  config={{ displayModeBar: false, responsive: true }}
                  style={{ width: "100%" }}
                />
              </div>

              <div className="card" style={{ marginBottom: "24px" }}>
                <div className="card-header">
                  <span className="card-title"><AlertTriangle size={18} /> ICU Demand & Overflow Probability</span>
                </div>
                <Plot divId="simulator-icu"
                  data={[
                    {
                      x: results.weeks, y: results.icu_demand_p95,
                      type: "scatter", mode: "lines",
                      line: { color: "rgba(220, 38, 38, 0.2)", width: 0 },
                      fill: "none", showlegend: false,
                    },
                    {
                      x: results.weeks, y: results.icu_demand_p5,
                      type: "scatter", mode: "lines", name: "ICU confidence",
                      line: { color: "rgba(220, 38, 38, 0.2)", width: 0 },
                      fill: "tonexty", fillcolor: "rgba(220, 38, 38, 0.1)",
                    },
                    {
                      x: results.weeks, y: results.icu_demand_mean,
                      type: "scatter", mode: "lines+markers",
                      name: "ICU demand", line: { color: "#DC2626", width: 2.5 },
                      marker: { size: 7, line: { color: 'white', width: 1 } },
                    },
                    {
                      x: results.weeks, y: results.weeks.map(() => resultParams.icu_beds_available),
                      type: "scatter", mode: "lines",
                      name: "ICU capacity", line: { color: "#D97706", width: 2, dash: "dash" },
                    },
                    {
                      x: results.weeks, y: results.icu_overflow_probability,
                      type: "bar", name: "Overflow probability %",
                      yaxis: "y2",
                      marker: { color: results.icu_overflow_probability.map((p) => p > 50 ? "rgba(220,38,38,0.7)" : "rgba(217,119,6,0.6)") },
                    },
                  ]}
                  layout={{
                    ...plotLayout,
                    xaxis: { ...plotLayout.xaxis, title: { text: "Week" } },
                    yaxis: { ...plotLayout.yaxis, title: { text: "ICU Beds Needed" } },
                    yaxis2: { title: { text: "Overflow %" }, overlaying: "y", side: "right", range: [0, 100], gridcolor: 'transparent' },
                    margin: { t: 20, b: 60, l: 60, r: 60 },
                    height: 350,
                    barmode: "overlay",
                  }}
                  config={{ displayModeBar: false, responsive: true }}
                  style={{ width: "100%" }}
                />
              </div>

              <div className="card">
                <div className="card-header">
                  <span className="card-title"><Activity size={18} /> Weekly Breakdown</span>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Week</th>
                        <th>Bed Demand (mean)</th>
                        <th>Bed Range (P5–P95)</th>
                        <th>ICU Demand</th>
                        <th>Overflow Risk</th>
                        <th>ICU Risk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.weeks.map((w, i) => (
                        <tr key={w}>
                          <td style={{ fontWeight: 600 }}>Week {w}</td>
                          <td style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{results.bed_demand_mean[i]}</td>
                          <td style={{ color: "var(--text-muted)" }}>
                            {results.bed_demand_p5[i]} – {results.bed_demand_p95[i]}
                          </td>
                          <td style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{results.icu_demand_mean[i]}</td>
                          <td style={{
                            color: results.overflow_probability[i] > 50 ? "var(--color-high)" : results.overflow_probability[i] > 20 ? "var(--color-moderate)" : "var(--color-safe)",
                            fontWeight: 700,
                          }}>
                            {results.overflow_probability[i]}%
                          </td>
                          <td style={{
                            color: results.icu_overflow_probability[i] > 50 ? "var(--color-high)" : results.icu_overflow_probability[i] > 20 ? "var(--color-moderate)" : "var(--color-safe)",
                            fontWeight: 700,
                          }}>
                            {results.icu_overflow_probability[i]}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
