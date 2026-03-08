import { useState, useEffect } from "react";
import Plot from "react-plotly.js";
import { TestTubes, Map as MapIcon, MapPin, TrendingUp, AlertTriangle, AlertCircle, Activity } from "lucide-react";
import { getWastewaterLatest, getWastewaterStates, getWastewaterCounty } from "../api";

const PERCENTILE_COLORS = {
  high: "#DC2626",      // red-600
  elevated: "#D97706",  // amber-600
  moderate: "#EAB308",  // yellow-500
  low: "#059669",       // emerald-600
  minimal: "#4F46E5",   // indigo-600
};

function getColor(pct) {
  if (pct >= 80) return PERCENTILE_COLORS.high;
  if (pct >= 60) return PERCENTILE_COLORS.elevated;
  if (pct >= 40) return PERCENTILE_COLORS.moderate;
  if (pct >= 20) return PERCENTILE_COLORS.low;
  return PERCENTILE_COLORS.minimal;
}

function getLabel(pct) {
  if (pct >= 80) return "Very High";
  if (pct >= 60) return "High";
  if (pct >= 40) return "Moderate";
  if (pct >= 20) return "Low";
  return "Minimal";
}

export default function Wastewater() {
  const [stateData, setStateData] = useState([]);
  const [sites, setSites] = useState([]);
  const [selectedState, setSelectedState] = useState(null);
  const [selectedCounty, setSelectedCounty] = useState(null);
  const [countyTrend, setCountyTrend] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getWastewaterStates(), getWastewaterLatest()])
      .then(([stRes, siteRes]) => {
        setStateData(stRes.data || []);
        setSites(siteRes.data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleStateClick = (state) => {
    setSelectedState(state);
    setSelectedCounty(null);
    setCountyTrend([]);
  };

  const handleCountyClick = async (site) => {
    setSelectedCounty(site);
    if (site.fips) {
      const res = await getWastewaterCounty(site.fips);
      setCountyTrend(res.data || []);
    }
  };

  const stateSites = selectedState
    ? sites.filter((s) => s.state === selectedState)
    : [];

  const stateAbbrevs = {
    Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR",
    California: "CA", Colorado: "CO", Connecticut: "CT", Delaware: "DE",
    Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID",
    Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS",
    Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
    Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS",
    Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV",
    "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
    "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK",
    Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC",
    "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT",
    Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV",
    Wisconsin: "WI", Wyoming: "WY", "District of Columbia": "DC",
  };

  if (loading) {
    return (
      <div className="page-container">
        <div style={{ textAlign: "center", padding: "4rem" }}>
          <div className="loading-spinner" />
          <p style={{ color: "var(--text-muted)", marginTop: "1rem" }}>Loading wastewater data from 1,500+ sites...</p>
        </div>
      </div>
    );
  }

  const plotLayout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'Inter, sans-serif', color: '#6B7280', size: 11 },
    xaxis: { gridcolor: '#F3F4F6', zeroline: false },
    yaxis: { gridcolor: '#F3F4F6', zeroline: false },
  };

  return (
    <div className="page-container">
      <div className="page-header fade-in">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">Bio-Surveillance</h1>
            <p className="page-subtitle">
              County-level SARS-CoV-2 signals from ~{sites.length.toLocaleString()} treatment plants nationwide — leads clinical data by 1–2 weeks
            </p>
          </div>
        </div>
      </div>

      <div className="stat-cards-grid fade-in" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div className="stat-card accent-indigo">
          <div className="stat-card-icon indigo"><TestTubes size={22} /></div>
          <div className="stat-card-label">MONITORING SITES</div>
          <div className="stat-card-value">{sites.length.toLocaleString()}</div>
        </div>
        <div className="stat-card accent-emerald">
          <div className="stat-card-icon emerald"><MapIcon size={22} /></div>
          <div className="stat-card-label">STATES COVERED</div>
          <div className="stat-card-value">{stateData.length}</div>
        </div>
        <div className="stat-card accent-rose">
          <div className="stat-card-icon rose"><AlertTriangle size={22} /></div>
          <div className="stat-card-label">HIGH SIGNAL SITES</div>
          <div className="stat-card-value">{sites.filter((s) => s.percentile >= 80).length}</div>
        </div>
        <div className="stat-card accent-amber">
          <div className="stat-card-icon amber"><Activity size={22} /></div>
          <div className="stat-card-label">AVG DETECTION</div>
          <div className="stat-card-value">
            {sites.length > 0 ? (sites.reduce((a, s) => a + (s.detection_rate || 0), 0) / sites.length).toFixed(0) : 0}%
          </div>
        </div>
      </div>

      <div className="charts-grid fade-in">
        <div className="card">
          <div className="card-header">
            <span className="card-title"><MapPin size={18} /> Viral Activity by State</span>
          </div>
          <Plot
            data={[{
              type: "choropleth",
              locationmode: "USA-states",
              locations: stateData.map((d) => stateAbbrevs[d.state] || d.state),
              z: stateData.map((d) => d.avg_percentile || 0),
              text: stateData.map((d) =>
                `${d.state}<br>${d.sites} sites · ${d.counties} counties<br>Avg percentile: ${(d.avg_percentile || 0).toFixed(0)}th`
              ),
              colorscale: [
                [0, "#4F46E5"], [0.25, "#059669"], [0.5, "#EAB308"],
                [0.75, "#D97706"], [1, "#DC2626"],
              ],
              colorbar: { 
                title: { text: "Percentile", font: { color: "#6B7280" } },
                ticksuffix: "th", 
                len: 0.6,
                tickfont: { color: "#6B7280" }
              },
              hoverinfo: "text",
              marker: { line: { color: "#FFFFFF", width: 0.8 } }
            }]}
            layout={{
              ...plotLayout,
              geo: {
                scope: "usa",
                bgcolor: "rgba(0,0,0,0)",
                lakecolor: "#E5E7EB",
                landcolor: "#F3F4F6",
                subunitcolor: "#D1D5DB",
                showlakes: true,
              },
              margin: { t: 0, b: 0, l: 0, r: 0 },
              height: 480,
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%" }}
            onClick={(e) => {
              if (e.points && e.points[0]) {
                const abbrev = e.points[0].location;
                const state = Object.keys(stateAbbrevs).find((k) => stateAbbrevs[k] === abbrev);
                if (state) handleStateClick(state);
              }
            }}
          />
          <p style={{ color: "var(--text-muted)", fontSize: "13px", marginTop: "16px", textAlign: "center", fontWeight: 500 }}>
            Click any state to see county-level breakdown →
          </p>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title"><MapIcon size={18} /> {selectedState || "Select a State"}</span>
          </div>
          {!selectedState ? (
            <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-muted)" }}>
              <MapPin size={48} strokeWidth={1.5} color="#D1D5DB" style={{ margin: "0 auto 16px" }} />
              <p style={{ fontSize: "15px", fontWeight: 500 }}>Click a state on the map to see county-level wastewater data</p>
            </div>
          ) : (
            <div style={{ maxHeight: "450px", overflow: "auto", paddingRight: "8px" }}>
              <div style={{ fontSize: "13px", marginBottom: "16px", color: "var(--text-secondary)", fontWeight: 600 }}>
                {stateSites.length} sites in {selectedState}
              </div>
              {stateSites.sort((a, b) => (b.percentile || 0) - (a.percentile || 0)).map((site, i) => (
                <div
                  key={i}
                  onClick={() => handleCountyClick(site)}
                  style={{
                    padding: "16px",
                    borderRadius: "var(--radius-md)",
                    marginBottom: "12px",
                    cursor: "pointer",
                    background: selectedCounty?.fips === site.fips
                      ? "var(--accent-primary-glow)"
                      : "var(--bg-elevated)",
                    border: `1px solid ${selectedCounty?.fips === site.fips ? "var(--border-accent)" : "transparent"}`,
                    transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                    boxShadow: selectedCounty?.fips === site.fips ? "var(--shadow-sm)" : "none",
                  }}
                  onMouseEnter={(e) => { if (selectedCounty?.fips !== site.fips) e.currentTarget.style.background = "var(--bg-card)"; }}
                  onMouseLeave={(e) => { if (selectedCounty?.fips !== site.fips) e.currentTarget.style.background = "var(--bg-elevated)"; }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "15px", color: "var(--text-primary)" }}>{site.county || "Unknown County"}</div>
                      <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px", fontWeight: 500 }}>
                        Pop: {(site.population_served || 0).toLocaleString()} · FIPS: {site.fips}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{
                        display: "inline-block",
                        padding: "4px 10px",
                        borderRadius: "12px",
                        fontSize: "12px",
                        fontWeight: 700,
                        background: `${getColor(site.percentile || 0)}15`,
                        color: getColor(site.percentile || 0),
                        border: `1px solid ${getColor(site.percentile || 0)}30`
                      }}>
                        {(site.percentile || 0).toFixed(0)}th %ile
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "6px", fontWeight: 600, textTransform: "uppercase" }}>
                        {getLabel(site.percentile || 0)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedCounty && countyTrend.length > 0 && (
        <div className="card fade-in" style={{ marginTop: "24px" }}>
          <div className="card-header">
            <span className="card-title"><TrendingUp size={18} /> Trend — {selectedCounty.county}, {selectedState}</span>
          </div>
          <Plot
            data={[
              {
                x: countyTrend.map((d) => d.date_end),
                y: countyTrend.map((d) => d.percentile),
                type: "scatter", mode: "lines+markers",
                name: "Viral Percentile",
                line: { color: "#4F46E5", width: 2.5 },
                marker: { size: 6, line: { color: "white", width: 1 } },
                fill: "tozeroy",
                fillcolor: "rgba(79, 70, 229, 0.08)",
              },
              {
                x: countyTrend.map((d) => d.date_end),
                y: countyTrend.map((d) => d.ptc_15d),
                type: "scatter", mode: "lines",
                name: "15-Day % Change",
                yaxis: "y2",
                line: { color: "#D97706", width: 2, dash: "dash" },
              },
            ]}
            layout={{
              ...plotLayout,
              xaxis: { ...plotLayout.xaxis, title: "Date" },
              yaxis: { ...plotLayout.yaxis, title: "Percentile" },
              yaxis2: { title: "% Change", overlaying: "y", side: "right", gridcolor: "transparent", font: { color: "#6B7280" } },
              margin: { t: 20, b: 60, l: 60, r: 60 },
              legend: { orientation: "h", y: -0.2, font: { color: "#4B5563" } },
              height: 350,
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%" }}
          />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginTop: "24px" }}>
            <div style={{ textAlign: "center", padding: "16px", background: "var(--bg-elevated)", borderRadius: "var(--radius-md)" }}>
              <div style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: 600 }}>CURRENT PERCENTILE</div>
              <div style={{ fontSize: "24px", fontWeight: 800, color: getColor(selectedCounty.percentile || 0), marginTop: "4px" }}>
                {(selectedCounty.percentile || 0).toFixed(0)}th
              </div>
            </div>
            <div style={{ textAlign: "center", padding: "16px", background: "var(--bg-elevated)", borderRadius: "var(--radius-md)" }}>
              <div style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: 600 }}>15-DAY CHANGE</div>
              <div style={{ fontSize: "24px", fontWeight: 800, color: (selectedCounty.pct_change || 0) > 0 ? "var(--color-high)" : "var(--color-safe)", marginTop: "4px" }}>
                {(selectedCounty.pct_change || 0) > 0 ? "↑" : "↓"} {Math.abs(selectedCounty.pct_change || 0).toFixed(0)}%
              </div>
            </div>
            <div style={{ textAlign: "center", padding: "16px", background: "var(--bg-elevated)", borderRadius: "var(--radius-md)" }}>
              <div style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: 600 }}>DETECTION RATE</div>
              <div style={{ fontSize: "24px", fontWeight: 800, color: "var(--color-safe)", marginTop: "4px" }}>
                {(selectedCounty.detection_rate || 0).toFixed(0)}%
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="card fade-in" style={{ marginTop: "24px" }}>
        <div className="card-header">
          <span className="card-title"><AlertCircle size={18} /> Highest Viral Signal Sites (Top 20)</span>
          <span className="badge badge-updated">Sort: %ile Desc</span>
        </div>
        <div style={{ overflowX: "auto", maxHeight: "400px" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>County</th>
                <th>State</th>
                <th>Percentile</th>
                <th>Risk</th>
                <th>% Change (15d)</th>
                <th>Detection</th>
                <th>Pop Served</th>
              </tr>
            </thead>
            <tbody>
              {sites.slice(0, 20).map((s, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>{s.county || "—"}</td>
                  <td>{s.state}</td>
                  <td style={{ color: getColor(s.percentile || 0), fontWeight: 700 }}>
                    {(s.percentile || 0).toFixed(0)}th
                  </td>
                  <td>
                    <span style={{
                      padding: "4px 10px", borderRadius: "12px", fontSize: "11px", fontWeight: 700,
                      background: `${getColor(s.percentile || 0)}15`, color: getColor(s.percentile || 0),
                      border: `1px solid ${getColor(s.percentile || 0)}30`
                    }}>
                      {getLabel(s.percentile || 0)}
                    </span>
                  </td>
                  <td style={{ color: (s.pct_change || 0) > 0 ? "var(--color-high)" : "var(--color-safe)", fontWeight: 600 }}>
                    {(s.pct_change || 0) > 0 ? "↑" : "↓"} {Math.abs(s.pct_change || 0).toFixed(0)}%
                  </td>
                  <td>{(s.detection_rate || 0).toFixed(0)}%</td>
                  <td>{(s.population_served || 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
