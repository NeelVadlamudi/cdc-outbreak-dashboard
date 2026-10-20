import { useState, useEffect } from "react";
import Plot from "react-plotly.js";
import { TestTubes, Map as MapIcon, AlertTriangle, Calendar } from "lucide-react";
import { getWastewaterLatest, getWastewaterStates } from "../api";

// CDC Wastewater Viral Activity Level categories (dataset atcp-73re)
const CATEGORY_COLORS = {
  "Very High": "#DC2626",
  High: "#D97706",
  Moderate: "#EAB308",
  Low: "#059669",
  "Very Low": "#4F46E5",
};
const PATHOGENS = ["SARS-CoV-2", "Influenza A virus", "RSV"];

const STATE_ABBREVS = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO",
  Connecticut: "CT", Delaware: "DE", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID",
  Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA",
  Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN",
  Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
  "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR",
  Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD",
  Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA", Washington: "WA",
  "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY", "District of Columbia": "DC",
};

export default function Wastewater() {
  const [pathogen, setPathogen] = useState("SARS-CoV-2");
  const [stateData, setStateData] = useState([]);
  const [sites, setSites] = useState([]);
  const [selectedState, setSelectedState] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getWastewaterStates(pathogen), getWastewaterLatest(pathogen)])
      .then(([stRes, siteRes]) => {
        if (cancelled) return;
        setStateData(stRes.data || []);
        setSites(siteRes.data || []);
      })
      .catch(console.error)
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [pathogen]);

  const choosePathogen = (p) => {
    setLoading(true);
    setSelectedState(null);
    setPathogen(p);
  };

  const weekEnd = sites.length ? sites[0].week_end : null;
  const highSites = sites.filter((s) => s.wval_category === "High" || s.wval_category === "Very High").length;
  const stateSites = selectedState ? sites.filter((s) => s.state === selectedState) : [];
  const mapped = stateData.filter((d) => STATE_ABBREVS[d.state]);

  return (
    <div className="page-container">
      <div className="page-header fade-in">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">Wastewater</h1>
            <p className="page-subtitle">
              CDC Wastewater Viral Activity Level by site for the latest week (NWSS dataset atcp-73re)
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            {PATHOGENS.map((p) => (
              <button key={p} className={`filter-btn ${pathogen === p ? "active" : ""}`} onClick={() => choosePathogen(p)}>
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "4rem" }}><div className="loading-spinner" /></div>
      ) : (
        <>
          <div className="stat-cards-grid fade-in" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            <div className="stat-card accent-indigo">
              <div className="stat-card-icon indigo"><TestTubes size={22} /></div>
              <div className="stat-card-label">SITES REPORTING</div>
              <div className="stat-card-value">{sites.length.toLocaleString()}</div>
            </div>
            <div className="stat-card accent-emerald">
              <div className="stat-card-icon emerald"><MapIcon size={22} /></div>
              <div className="stat-card-label">STATES AND TERRITORIES</div>
              <div className="stat-card-value">{stateData.length}</div>
            </div>
            <div className="stat-card accent-rose">
              <div className="stat-card-icon rose"><AlertTriangle size={22} /></div>
              <div className="stat-card-label">SITES HIGH OR VERY HIGH</div>
              <div className="stat-card-value">{highSites.toLocaleString()}</div>
            </div>
            <div className="stat-card accent-amber">
              <div className="stat-card-icon amber"><Calendar size={22} /></div>
              <div className="stat-card-label">WEEK ENDING</div>
              <div className="stat-card-value" style={{ fontSize: "20px" }}>{weekEnd || "—"}</div>
            </div>
          </div>

          <div className="charts-grid fade-in">
            <div className="card">
              <div className="card-header"><span className="card-title">Median activity level by state</span></div>
              <Plot
                data={[{
                  type: "choropleth", locationmode: "USA-states",
                  locations: mapped.map((d) => STATE_ABBREVS[d.state]),
                  z: mapped.map((d) => d.median_wval),
                  text: mapped.map((d) => `${d.state}<br>${d.sites} sites · ${d.sites_high} High or Very High<br>Median WVAL: ${d.median_wval}`),
                  hoverinfo: "text", colorscale: "YlOrRd", colorbar: { title: "WVAL", thickness: 10 },
                }]}
                layout={{ geo: { scope: "usa", bgcolor: "rgba(0,0,0,0)" }, margin: { t: 0, b: 0, l: 0, r: 0 }, height: 380, paper_bgcolor: "rgba(0,0,0,0)" }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: "100%" }}
                onClick={(e) => {
                  const abbr = e.points?.[0]?.location;
                  const name = Object.keys(STATE_ABBREVS).find((k) => STATE_ABBREVS[k] === abbr);
                  if (name) setSelectedState(name);
                }}
              />
            </div>

            <div className="card">
              <div className="card-header">
                <span className="card-title">{selectedState ? `${selectedState} sites` : "Click a state to list its sites"}</span>
              </div>
              <div style={{ maxHeight: 380, overflowY: "auto" }}>
                <table className="data-table" style={{ width: "100%" }}>
                  <thead><tr><th>Site</th><th>Counties</th><th>WVAL</th><th>Level</th></tr></thead>
                  <tbody>
                    {stateSites.map((s) => (
                      <tr key={s.wwtp_id}>
                        <td>{s.wwtp_id}</td>
                        <td>{s.county || "—"}</td>
                        <td>{s.wval ?? "—"}</td>
                        <td style={{ color: CATEGORY_COLORS[s.wval_category] || "inherit", fontWeight: 700 }}>{s.wval_category || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
