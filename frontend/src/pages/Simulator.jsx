import { useState, useEffect } from "react";
import Plot from "react-plotly.js";
import { Hospital, AlertTriangle, TrendingUp, Settings, Activity, Play } from "lucide-react";
import { runSimulator, getSimDefaults } from "../api";

export default function Simulator() {
  const [params, setParams] = useState({
    population: 1000000,
    current_rate: 5.0,
    surge_multiplier: 2.0,
    hospitalization_pct: 10.0,
    icu_pct: 20.0,
    avg_los_days: 5.0,
    icu_los_days: 10.0,
    beds_available: 500,
    icu_beds_available: 50,
    cost_per_bed_day: 3000,
    cost_per_icu_day: 8000,
    weeks: 8,
  });
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [defaults, setDefaults] = useState(null);

  useEffect(() => {
    getSimDefaults().then(setDefaults).catch(() => {});
  }, []);

  const runSim = async () => {
    setLoading(true);
    try {
      const res = await runSimulator(params);
      setResults(res);
    } catch {
      console.error("Simulation failed");
    }
    setLoading(false);
  };

  useEffect(() => {
    runSim();
  }, []);

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
    { key: "surge_multiplier", label: "Surge Multiplier", min: 1, max: 5, step: 0.1, unit: "x" },
    { key: "population", label: "Population", min: 100000, max: 10000000, step: 100000, unit: "", format: (v) => v.toLocaleString() },
    { key: "current_rate", label: "Current Rate (per 100k)", min: 0.5, max: 30, step: 0.5, unit: "" },
    { key: "hospitalization_pct", label: "Hospitalization %", min: 1, max: 30, step: 1, unit: "%" },
    { key: "icu_pct", label: "ICU % of Hospitalizations", min: 5, max: 50, step: 5, unit: "%" },
    { key: "beds_available", label: "Hospital Beds Available", min: 50, max: 2000, step: 50, unit: "" },
    { key: "icu_beds_available", label: "ICU Beds Available", min: 10, max: 500, step: 10, unit: "" },
  ];

  const plotLayout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'Inter, sans-serif', color: '#6B7280', size: 11 },
    margin: { t: 20, b: 60, l: 60, r: 20 },
    xaxis: { gridcolor: '#F3F4F6', zeroline: false },
    yaxis: { gridcolor: '#F3F4F6', zeroline: false },
    showlegend: true,
    legend: { orientation: "h", y: -0.25, font: { color: "#4B5563" } },
  };

  return (
    <div className="page-container">
      <div className="page-header fade-in">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">Surge Matrix</h1>
            <p className="page-subtitle">
              Interactive Monte Carlo capacity modeling based on emerging viral trends
            </p>
          </div>
          <button onClick={runSim} className="filter-btn active" disabled={loading} style={{ padding: '10px 24px', fontSize: '14px' }}>
            {loading ? <><Activity className="animate-pulse" size={16} /> Running 1k sims...</> : <><Play size={16} fill="currentColor" /> Run Simulation</>}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: "24px" }} className="fade-in">
        <div className="card" style={{ position: "sticky", top: "24px", alignSelf: "start", padding: "24px" }}>
          <div className="card-header" style={{ marginBottom: "20px" }}>
            <span className="card-title"><Settings size={18} /> Parameters</span>
          </div>

          {defaults?.current_rates && (
            <div style={{
              padding: "16px", borderRadius: "var(--radius-md)", marginBottom: "24px",
              background: "var(--accent-primary-glow)", border: "1px solid var(--border-accent)",
            }}>
              <strong style={{ color: "var(--accent-primary)", fontSize: "13px" }}>Current CDC Rates:</strong>
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
              <div className="stat-cards-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)", marginBottom: "24px", gap: "16px" }}>
                <div className="stat-card accent-indigo">
                  <div className="stat-card-icon indigo"><Hospital size={22} /></div>
                  <div className="stat-card-label">Peak Bed Demand</div>
                  <div className="stat-card-value">
                    {Math.max(...results.bed_demand_mean).toFixed(0)}
                  </div>
                  <div style={{ marginTop: "12px", fontSize: "13px", fontWeight: 600, color: Math.max(...results.bed_demand_mean) > params.beds_available ? "var(--color-high)" : "var(--color-safe)" }}>
                    {Math.max(...results.bed_demand_mean) > params.beds_available ? "⚠️ Exceeds capacity" : "✅ Within capacity"}
                  </div>
                </div>
                <div className="stat-card accent-rose">
                  <div className="stat-card-icon rose"><AlertTriangle size={22} /></div>
                  <div className="stat-card-label">Peak ICU Demand</div>
                  <div className="stat-card-value">
                    {Math.max(...results.icu_demand_mean).toFixed(0)}
                  </div>
                  <div style={{ marginTop: "12px", fontSize: "13px", fontWeight: 600, color: Math.max(...results.icu_demand_mean) > params.icu_beds_available ? "var(--color-high)" : "var(--color-safe)" }}>
                    {Math.max(...results.icu_demand_mean) > params.icu_beds_available ? "⚠️ ICU overflow risk" : "✅ ICU OK"}
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
                <Plot
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
                      name: "Mean bed demand", line: { color: "#4F46E5", width: 2.5 },
                      marker: { size: 7, line: { color: 'white', width: 1 } },
                    },
                    {
                      x: results.weeks, y: results.weeks.map(() => params.beds_available),
                      type: "scatter", mode: "lines",
                      name: "Capacity", line: { color: "#DC2626", width: 2, dash: "dash" },
                    },
                  ]}
                  layout={{
                    ...plotLayout,
                    xaxis: { ...plotLayout.xaxis, title: "Week" },
                    yaxis: { ...plotLayout.yaxis, title: "Beds Needed" },
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
                <Plot
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
                      x: results.weeks, y: results.weeks.map(() => params.icu_beds_available),
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
                    xaxis: { ...plotLayout.xaxis, title: "Week" },
                    yaxis: { ...plotLayout.yaxis, title: "ICU Beds Needed" },
                    yaxis2: { title: "Overflow %", overlaying: "y", side: "right", range: [0, 100], gridcolor: 'transparent' },
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
