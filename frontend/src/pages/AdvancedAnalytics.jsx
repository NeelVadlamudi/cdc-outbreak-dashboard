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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
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
        setLoading(false);
      })
      .catch(() => setLoading(false));
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
    const colors = ["#4F46E5", "#D97706", "#059669", "#DC2626", "#EAB308"];
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
    font: { family: 'Inter, sans-serif', color: '#6B7280', size: 11 },
    xaxis: { gridcolor: '#F3F4F6', zeroline: false },
    yaxis: { gridcolor: '#F3F4F6', zeroline: false },
  };

  if (loading) {
    return (
      <div className="page-container">
        <div style={{ textAlign: "center", padding: "4rem" }}>
          <div className="loading-spinner" />
          <p style={{ color: "var(--text-muted)", marginTop: "1rem" }}>Running ensemble models and anomaly detection...</p>
        </div>
      </div>
    );
  }

  const lstm = comparison?.lstm || {};
  const xgb = comparison?.xgboost || {};

  return (
    <div className="page-container">
      <div className="page-header fade-in">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">Quantum Insights</h1>
            <p className="page-subtitle">
              Ensemble AI models, anomaly detection, age-stratified analysis, and season comparisons
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

      <div className="stat-cards-grid fade-in" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: "24px", gap: "16px" }}>
        <div className="stat-card accent-indigo">
          <div className="stat-card-icon indigo"><BrainCircuit size={22} /></div>
          <div className="stat-card-label">LSTM MAE</div>
          <div className="stat-card-value">{lstm.mae || "N/A"}</div>
          <div style={{ marginTop: "12px", fontSize: "13px", fontWeight: 600, color: "var(--accent-primary)" }}>PyTorch LSTM (2×64)</div>
        </div>
        <div className="stat-card accent-emerald">
          <div className="stat-card-icon emerald"><Trees size={22} /></div>
          <div className="stat-card-label">XGBOOST MAE</div>
          <div className="stat-card-value">{xgb.mae || "N/A"}</div>
          <div style={{ marginTop: "12px", fontSize: "13px", fontWeight: 600, color: "var(--color-safe)" }}>XGBoost (200 trees)</div>
        </div>
        <div className="stat-card accent-amber">
          <div className="stat-card-icon amber"><AlertOctagon size={22} /></div>
          <div className="stat-card-label">ANOMALIES DETECTED</div>
          <div className="stat-card-value">{anomalies.length}</div>
          <div style={{ marginTop: "12px", fontSize: "13px", fontWeight: 600, color: "var(--color-moderate)" }}>z-score &gt; 2σ</div>
        </div>
      </div>

      <div className="charts-grid charts-grid-equal fade-in">
        <div className="card">
          <div className="card-header">
            <span className="card-title"><BrainCircuit size={18} /> LSTM Forecast vs XGBoost</span>
          </div>
          <Plot
            data={[
              ...(lstm.historical_recent ? [{
                x: lstm.historical_recent.map((_, i) => `Week -${lstm.historical_recent.length - i}`),
                y: lstm.historical_recent,
                type: "scatter", mode: "lines+markers",
                name: "Actual", line: { color: "#9CA3AF", width: 2 },
              }] : []),
              ...(lstm.forecasts ? [{
                x: lstm.forecasts.map((f) => f.date),
                y: lstm.forecasts.map((f) => f.predicted_rate),
                type: "scatter", mode: "lines+markers",
                name: "LSTM", line: { color: "#4F46E5", width: 2.5 },
                marker: { size: 7, symbol: "diamond", line: { color: 'white', width: 1 } },
              }] : []),
              ...(xgb.forecasts ? [{
                x: xgb.forecasts.map((f) => f.date),
                y: xgb.forecasts.map((f) => f.predicted_rate),
                type: "scatter", mode: "lines+markers",
                name: "XGBoost", line: { color: "#059669", width: 2.5, dash: "dash" },
                marker: { size: 7, symbol: "square", line: { color: 'white', width: 1 } },
              }] : []),
            ]}
            layout={{
              ...plotLayout,
              xaxis: { ...plotLayout.xaxis, title: "Week", tickangle: -45 },
              yaxis: { ...plotLayout.yaxis, title: "Rate per 100k" },
              margin: { t: 20, b: 80, l: 60, r: 20 },
              legend: { orientation: "h", y: -0.3, font: { color: "#4B5563" } },
              height: 380,
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%" }}
          />
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title"><Trees size={18} /> XGBoost Feature Importance</span>
          </div>
          {xgb.feature_importance && (
            <Plot
              data={[{
                y: Object.keys(xgb.feature_importance),
                x: Object.values(xgb.feature_importance),
                type: "bar", orientation: "h",
                marker: {
                  color: Object.values(xgb.feature_importance).map((v, i) =>
                    `rgba(79, 70, 229, ${0.4 + (i / Object.values(xgb.feature_importance).length) * 0.6})`
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
              colorscale: [[0, "#F9FAFB"], [0.25, "#E0E7FF"], [0.5, "#818CF8"], [0.75, "#4F46E5"], [1, "#312E81"]],
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
          Surveillance sites where current rates deviate significantly from historical average (Isolation Forest + z-score methodology)
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
