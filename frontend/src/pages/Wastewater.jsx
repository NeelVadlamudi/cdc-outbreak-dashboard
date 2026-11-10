import { useState, useEffect } from "react";
import Plot from "../components/Plot";
import { TestTubes, Map as MapIcon, AlertTriangle, Calendar, Link2 } from "lucide-react";
import { getWastewaterLatest, getWastewaterStates } from "../api";
import { STATE_ABBREV as STATE_ABBREVS } from "../lib/states";
import ChartEmpty from "../components/ChartEmpty";
import { getParam, setParams } from "../lib/urlState";

// CDC Wastewater Viral Activity Level categories (dataset atcp-73re)
const CATEGORY_COLORS = {
  "Very High": "#a86850",
  High: "#c47a5a",
  Moderate: "#c4924a",
  Low: "#4f7d6a",
  "Very Low": "#5a8a8c",
};
const PATHOGENS = ["SARS-CoV-2", "Influenza A virus", "RSV"];

export default function Wastewater() {
  const [pathogen, setPathogen] = useState(() => getParam("pathogen", "SARS-CoV-2"));
  const [stateData, setStateData] = useState([]);
  const [sites, setSites] = useState([]);
  const [selectedState, setSelectedState] = useState(() => getParam("state", "") || null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const load = (p = pathogen) => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    Promise.all([getWastewaterStates(p), getWastewaterLatest(p)])
      .then(([stRes, siteRes]) => {
        if (cancelled) return;
        setStateData(stRes.data || []);
        setSites(siteRes.data || []);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load wastewater");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  };

  useEffect(() => {
    setParams({ pathogen, state: selectedState || "" });
    return load(pathogen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathogen]);

  const choosePathogen = (p) => {
    setSelectedState(null);
    setPathogen(p);
  };

  const weekEnd = sites.length ? sites[0].week_end?.slice(0, 10) : null;
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
              Early community signal from wastewater (not a clinical diagnosis). Shareable via <code>?pathogen=</code>.
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {PATHOGENS.map((p) => (
              <button key={p} className={`filter-btn ${pathogen === p ? "active" : ""}`} onClick={() => choosePathogen(p)}>
                {p}
              </button>
            ))}
            <button
              type="button"
              className="filter-btn"
              onClick={() => navigator.clipboard?.writeText(window.location.href).catch(() => {})}
            >
              <Link2 size={14} /> Share view
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading-page" style={{ minHeight: "40vh" }}>
          <div className="loading-spinner" />
          <div className="loading-page-text">Loading wastewater activity…</div>
        </div>
      ) : loadError ? (
        <ChartEmpty
          title="Wastewater temporarily unavailable"
          detail={`${loadError} This is a service status note—not a disease alert.`}
          onRetry={() => load(pathogen)}
        />
      ) : !sites.length && !stateData.length ? (
        <ChartEmpty
          title="No wastewater rows for this pathogen"
          detail="Empty response from the API—not proof that viral activity is absent."
          onRetry={() => load(pathogen)}
        />
      ) : (
        <>
          <div className="stat-cards-grid fade-in">
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
                  hoverinfo: "text", colorscale: "YlOrRd", colorbar: { title: { text: "WVAL" }, thickness: 10 },
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
          <p className="page-footnote">
            Source: CDC National Wastewater Surveillance System (NWSS). Activity levels are by sampling site for the latest available week.
          </p>
        </>
      )}
    </div>
  );
}
