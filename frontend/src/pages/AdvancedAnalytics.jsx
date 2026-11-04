import { useState, useEffect } from "react";
import Plot from "react-plotly.js";
import { Microscope, BrainCircuit, Trees, AlertOctagon, Users, Calendar, AlertTriangle, AlertCircle } from "lucide-react";
import { compareModels, getAnomalies, getAgeHeatmap, getSeasonComparison } from "../api";

const VIRUS_MAP = {
  "COVID-19": "COVID-NET",
  "Influenza": "FluSurv-NET",
  "RSV": "RSV-NET",
};

export default function AdvancedAnalytics() {
  const [selectedVirus, setSelectedVirus] = useState("COVID-19");
  const [comparison, setComparison] = useState(null);
  const [anomalies, setAnomalies] = useState([]);
  const [heatmapData, setHeatmapData] = useState([]);
  const [seasonData, setSeasonData] = useState([]);
  // Loading is derived: true until data for the selected virus has arrived (or failed).
  const [loadedFor, setLoadedFor] = useState(null);
  const loading = loadedFor !== selectedVirus;

  useEffect(() => {
    const virus = VIRUS_MAP[selectedVirus];
    Promise.all([
      compareModels(virus),
      getAnomalies(),
      getAgeHeatmap(virus),
      getSeasonComparison(),
    ])
      .then(([cmp, anom, heat, season]) => {
        setComparison(cmp);
        setAnomalies(anom.anomalies || []);
        setHeatmapData(heat.data || []);
        setSeasonData(season.data || []);
        setLoadedFor(selectedVirus);
      })
      .catch(() => setLoadedFor(selectedVirus));
  }, [selectedVirus]);

  const ageGroups = [...new Set(heatmapData.map((d) => d.age_group))];
  const weeks = [...new Set(heatmapData.map((d) => d.week_ending_date))].sort();
  const heatZ = ageGroups.map((ag) =>
    weeks.map((w) => {
      const match = heatmapData.find((d) => d.age_group === ag && d.week_ending_date === w);
      return match ? match.rate : 0;
    })
  );

  const seasons = [...new Set(seasonData.filter((d) => d.surveillance_network === VIRUS_MAP[selectedVirus]).map((d) => d.season))];
  const seasonTraces = seasons.map((s, i) => {
    const sData = seasonData.filter((d) => d.surveillance_network === VIRUS_MAP[selectedVirus] && d.season === s);
    const colors = ["#0000d9", "#B45309", "#1A7A5C", "#C2410C", "#CA8A04"];
    return {
      x: sData.map((d) => d.mmwr_week),
      y: sData.map((d) => d.avg_rate),
      type: "scatter", mode: "lines",
      name: s,
      line: { color: colors[i % colors.length], width: 2, shape: "spline" },
    };
  });

  const plotLayout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'Space Grotesk, sans-serif', color: '#6b6b6b', size: 11 },
    xaxis: { gridcolor: '#e8e8e8', zeroline: false },
    yaxis: { gridcolor: '#e8e8e8', zeroline: false },
  };

  if (loading) {
    return (
      <div className="page-container">
        <div style={{ textAlign: "center", padding: "4rem" }}>
          <div className="loading-spinner" />
          <p style={{ color: "var(--text-muted)", marginTop: "1rem" }}>Loading technical comparisons…</p>
        </div>
      </div>
    );
  }

  const lastValue = comparison?.last_value || {};
  const lstm = comparison?.lstm || {};
  const xgb = comparison?.xgboost || {};
  const lstmUnder = lstm.underperforms_baseline || comparison?.backtest?.lstm?.underperforms_baseline
    || (comparison?.backtest?.lstm && comparison.backtest.lstm.beats_last_value === false);
  const xgbUnder = xgb.underperforms_baseline || comparison?.backtest?.xgboost?.underperforms_baseline
    || (comparison?.backtest?.xgboost && comparison.backtest.xgboost.beats_last_value === false);
  const backtestNotes = [comparison?.backtest?.lstm?.note, comparison?.backtest?.xgboost?.note]
    .filter(Boolean)
    .filter((note, i, arr) => arr.indexOf(note) === i);

  return (
    <div className="page-container">
      <div className="page-header fade-in">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">Technical details</h1>
            <p className="page-subtitle">
              Model comparisons, unusual spikes, age patterns, and season-to-season charts for readers who want the deeper view.
            </p>
          </div>
        </div>
      </div>

      <div className="filter-bar fade-in" style={{ marginBottom: "24px" }}>
        {Object.keys(VIRUS_MAP).map((v) => (
          <button
            key={v}
            onClick={() => setSelectedVirus(v)}
            className={`filter-btn ${selectedVirus === v ? "active" : ""}`}
            style={{ padding: '8px 24px', fontSize: '14px' }}
          >
            {v}
          </button>
        ))}
      </div>

      {backtestNotes.length > 0 && (
        <div className="alert-banner warning fade-in" role="note" style={{ marginBottom: "24px" }}>
          <AlertTriangle size={18} />
          <span>{backtestNotes.join(" ")}</span>
        </div>
      )}

      <div className="stat-cards-grid fade-in" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: "24px", gap: "16px" }}>
        <div className="stat-card accent-emerald">
          <div className="stat-card-icon emerald"><Microscope size={22} /></div>
          <div className="stat-card-label">Primary outlook rate</div>
          <div className="stat-card-value">{lastValue.last_observed_rate ?? "N/A"}</div>
          <div style={{ marginTop: "12px", fontSize: "13px", fontWeight: 600, color: "var(--color-safe)" }}>Last-week method</div>
        </div>
        <div className="stat-card accent-indigo">
          <div className="stat-card-icon indigo"><BrainCircuit size={22} /></div>
          <div className="stat-card-label">Neural model error {lstmUnder ? "· weaker" : ""}</div>
          <div className="stat-card-value">{lstm.mae || "N/A"}</div>
          <div style={{ marginTop: "12px", fontSize: "13px", fontWeight: 600, color: "var(--accent-primary)" }}>Experimental</div>
        </div>
        <div className="stat-card accent-emerald">
          <div className="stat-card-icon emerald"><Trees size={22} /></div>
          <div className="stat-card-label">Tree model error {xgbUnder ? "· weaker" : ""}</div>
          <div className="stat-card-value">{xgb.mae || "N/A"}</div>
          <div style={{ marginTop: "12px", fontSize: "13px", fontWeight: 600, color: "var(--color-safe)" }}>Experimental</div>
        </div>
        <div className="stat-card accent-amber">
          <div className="stat-card-icon amber"><AlertOctagon size={22} /></div>
          <div className="stat-card-label">Unusual spikes</div>
          <div className="stat-card-value">{anomalies.length}</div>
          <div style={{ marginTop: "12px", fontSize: "13px", fontWeight: 600, color: "var(--color-moderate)" }}>Statistical outliers</div>
        </div>
      </div>

      <div className="charts-grid charts-grid-equal fade-in">
        <div className="card">
          <div className="card-header">
            <span className="card-title"><Microscope size={18} /> Primary outlook vs experimental models</span>
          </div>
          <Plot
            data={[
              ...((lastValue.historical_recent || lstm.historical_recent) ? [{
                x: (lastValue.historical_recent || lstm.historical_recent).map((_, i, arr) => `Week -${arr.length - i}`),
                y: lastValue.historical_recent || lstm.historical_recent,
                type: "scatter", mode: "lines+markers",
                name: "Actual", line: { color: "#9CA3AF", width: 2 },
              }] : []),
              ...(lastValue.forecasts ? [{
                x: lastValue.forecasts.map((f) => f.date),
                y: lastValue.forecasts.map((f) => f.predicted_rate),
                type: "scatter", mode: "lines+markers",
                name: "Last-week (primary)", line: { color: "#0000d9", width: 3 },
              }] : []),
              ...(lstm.forecasts ? [{
                x: lstm.forecasts.map((f) => f.date),
                y: lstm.forecasts.map((f) => f.predicted_rate),
                type: "scatter", mode: "lines+markers",
                name: lstmUnder ? "Neural model (weaker than baseline)" : "Neural model (experimental)",
                line: { color: "#0E7490", width: 2, dash: "dash" },
                marker: { size: 7, symbol: "diamond", line: { color: 'white', width: 1 } },
              }] : []),
              ...(xgb.forecasts ? [{
                x: xgb.forecasts.map((f) => f.date),
                y: xgb.forecasts.map((f) => f.predicted_rate),
                type: "scatter", mode: "lines+markers",
                name: xgbUnder ? "Tree model (weaker than baseline)" : "Tree model (experimental)",
                line: { color: "#B45309", width: 2, dash: "dot" },
                marker: { size: 7, symbol: "square", line: { color: 'white', width: 1 } },
              }] : []),
            ]}
            layout={{
              ...plotLayout,
              xaxis: { ...plotLayout.xaxis, title: "Week", tickangle: -45 },
              yaxis: { ...plotLayout.yaxis, title: "Rate per 100k" },
              margin: { t: 20, b: 80, l: 60, r: 20 },
              legend: { orientation: "h", y: -0.3, font: { color: '#3a3a3a' } },
              height: 380,
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%" }}
          />
          <p className="page-footnote">
            Chart labels use plain language; underlying methods include neural and gradient-boosted models evaluated against the last-week baseline.
          </p>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title"><Trees size={18} /> What the tree model weighs most</span>
          </div>
          {xgb.feature_importance && (
            <Plot
              data={[{
                y: Object.keys(xgb.feature_importance),
                x: Object.values(xgb.feature_importance),
                type: "bar", orientation: "h",
                marker: {
                  color: Object.values(xgb.feature_importance).map((v, i) =>
                    `rgba(15, 92, 85, ${0.4 + (i / Object.values(xgb.feature_importance).length) * 0.6})`
                  ),
                },
              }]}
              layout={{
                ...plotLayout,
                xaxis: { ...plotLayout.xaxis, title: "Importance Score" },
                yaxis: { automargin: true, tickfont: { size: 10, color: "#4B5563" } },
                margin: { t: 10, b: 50, l: 120, r: 20 },
                height: 380,
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: "100%" }}
            />
          )}
        </div>
      </div>

      {ageGroups.length > 0 && (
        <div className="card fade-in" style={{ marginTop: "24px" }}>
          <div className="card-header">
            <span className="card-title"><Users size={18} /> Age-Stratified Hospitalization Heatmap</span>
          </div>
          <Plot
            data={[{
              z: heatZ,
              x: weeks.slice(-26),
              y: ageGroups,
              type: "heatmap",
              colorscale: [[0, "#F7F9F8"], [0.25, "#D8E8E5"], [0.5, "#6BA8A1"], [0.75, "#0000d9"], [1, "#0A3D39"]],
              colorbar: { 
                title: { text: "Rate/100k", font: { color: "#6B7280" } },
                len: 0.8,
                tickfont: { color: "#6B7280" }
              },
              hovertemplate: "Age: %{y}<br>Week: %{x}<br>Rate: %{z:.1f}/100k<extra></extra>",
            }]}
            layout={{
              ...plotLayout,
              xaxis: { ...plotLayout.xaxis, title: "Week Ending", nticks: 13 },
              yaxis: { automargin: true, tickfont: { color: "#4B5563" } },
              margin: { t: 10, b: 60, l: 140, r: 20 },
              height: 380,
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%" }}
          />
        </div>
      )}

      {seasonTraces.length > 0 && (
        <div className="card fade-in" style={{ marginTop: "24px" }}>
          <div className="card-header">
            <span className="card-title"><Calendar size={18} /> Season-over-Season Comparison</span>
          </div>
          <Plot
            data={seasonTraces}
            layout={{
              ...plotLayout,
              xaxis: { ...plotLayout.xaxis, title: "MMWR Week" },
              yaxis: { ...plotLayout.yaxis, title: "Rate per 100k" },
              margin: { t: 20, b: 60, l: 60, r: 20 },
              legend: { orientation: "h", y: -0.25, font: { color: "#4B5563" } },
              height: 380,
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%" }}
          />
        </div>
      )}

      <div className="card fade-in" style={{ marginTop: "24px" }}>
        <div className="card-header">
          <span className="card-title"><AlertTriangle size={18} /> Anomaly Detection — Statistical Outliers</span>
          <span className="badge badge-updated">z-score &gt; 2σ</span>
        </div>
        <p style={{ color: "var(--text-secondary)", marginBottom: "20px", fontSize: "14px" }}>
          Surveillance sites where current rates deviate significantly from the recent mean (|z| &gt; 2).
        </p>
        {anomalies.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 20px" }}>
            <span style={{ fontSize: "48px" }}>✅</span>
            <p style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: "16px", marginTop: "16px" }}>
              No significant anomalies detected in the current data
            </p>
          </div>
        ) : (
          <div style={{ maxHeight: "400px", overflow: "auto" }}>
            {anomalies.map((a, i) => (
              <div key={i} style={{
                padding: "20px",
                borderRadius: "var(--radius-md)",
                marginBottom: "12px",
                background: a.severity === "Critical" ? "rgba(220, 38, 38, 0.05)" : "rgba(217, 119, 6, 0.05)",
                border: `1px solid ${a.severity === "Critical" ? "rgba(220, 38, 38, 0.2)" : "rgba(217, 119, 6, 0.2)"}`,
                borderLeft: `4px solid ${a.severity === "Critical" ? "var(--color-high)" : "var(--color-moderate)"}`,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    {a.severity === "Critical" ? <AlertCircle size={20} color="var(--color-high)" /> : <AlertTriangle size={20} color="var(--color-moderate)" />}
                    <div>
                      <span style={{ fontWeight: 800, fontSize: "16px", color: "var(--text-primary)" }}>{a.geography}</span>
                      <span style={{ fontSize: "12px", color: "var(--text-secondary)", marginLeft: "12px", background: "var(--bg-card)", padding: "4px 8px", borderRadius: "12px", border: "1px solid var(--border-light)" }}>{a.metric}</span>
                    </div>
                  </div>
                  <span style={{
                    padding: "4px 12px", borderRadius: "12px", fontWeight: 800, fontSize: "13px",
                    background: a.severity === "Critical" ? "rgba(220, 38, 38, 0.1)" : "rgba(217, 119, 6, 0.1)",
                    color: a.severity === "Critical" ? "var(--color-high)" : "var(--color-moderate)",
                  }}>
                    {a.z_score}σ
                  </span>
                </div>
                <p style={{ fontSize: "14px", color: "var(--text-secondary)", marginTop: "12px", lineHeight: 1.5 }}>{a.description}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
