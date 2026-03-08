import { useState, useEffect } from 'react';
import Plot from 'react-plotly.js';
import { Activity, TestTubes, LineChart, BarChart2, TrendingUp, Syringe } from 'lucide-react';
import { getTestPositivity, getHospitalizations, getSites } from '../api';

export default function Analytics() {
  const [positivity, setPositivity] = useState([]);
  const [hospitalizations, setHospitalizations] = useState([]);
  const [sites, setSites] = useState([]);
  const [selectedSite, setSelectedSite] = useState(null);
  const [selectedNetwork, setSelectedNetwork] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [posRes, hospRes, sitesRes] = await Promise.all([
          getTestPositivity('limit=1000'),
          getHospitalizations('limit=500'),
          getSites(),
        ]);
        setPositivity(posRes.data || []);
        setHospitalizations(hospRes.data || []);
        setSites(sitesRes.sites || []);
      } catch (err) {
        console.error('Failed to fetch analytics data:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  useEffect(() => {
    if (!selectedSite && !selectedNetwork) return;
    const params = new URLSearchParams();
    if (selectedNetwork && selectedNetwork !== 'all') params.set('network', selectedNetwork);
    if (selectedSite) params.set('site', selectedSite);
    params.set('limit', '500');

    getHospitalizations(params.toString())
      .then(res => setHospitalizations(res.data || []))
      .catch(console.error);
  }, [selectedSite, selectedNetwork]);

  if (loading) {
    return (
      <div className="loading-page">
        <div className="loading-spinner" />
        <div className="loading-page-text">Loading deep analytics...</div>
      </div>
    );
  }

  const plotLayout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'Inter, sans-serif', color: '#6B7280', size: 11 },
    margin: { l: 50, r: 20, t: 30, b: 50 },
    xaxis: { gridcolor: '#F3F4F6', zeroline: false },
    yaxis: { gridcolor: '#F3F4F6', zeroline: false },
    showlegend: true,
    legend: { orientation: 'h', y: -0.2, font: { size: 11, color: '#4B5563' } },
  };

  const pathogenGroups = {};
  positivity.forEach(d => {
    if (!pathogenGroups[d.pathogen]) pathogenGroups[d.pathogen] = [];
    pathogenGroups[d.pathogen].push(d);
  });

  const pathogenColors = { 'COVID-19': '#4F46E5', 'Influenza': '#D97706', 'RSV': '#059669' };

  const hospByNetwork = {};
  hospitalizations.forEach(d => {
    const key = d.surveillance_network;
    if (!hospByNetwork[key]) hospByNetwork[key] = [];
    hospByNetwork[key].push(d);
  });

  const networkColors = { 'COVID-NET': '#4F46E5', 'FluSurv-NET': '#D97706', 'RSV-NET': '#059669' };

  const getLatestRate = (network) => {
    const items = hospByNetwork[network] || [];
    if (items.length === 0) return { latest: 0, prev: 0 };
    const sorted = [...items].sort((a, b) => b.week_ending_date?.localeCompare(a.week_ending_date));
    return {
      latest: sorted[0]?.weekly_rate || 0,
      prev: sorted[1]?.weekly_rate || 0,
    };
  };

  return (
    <div className="page-container">
      <div className="page-header fade-in">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">Data Core</h1>
            <p className="page-subtitle">
              Comprehensive statistical modeling and cross-network temporal analysis
            </p>
          </div>
        </div>
      </div>

      <div className="stat-cards-grid fade-in" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {['COVID-NET', 'FluSurv-NET', 'RSV-NET'].map((network, i) => {
          const { latest, prev } = getLatestRate(network);
          const change = prev > 0 ? ((latest - prev) / prev * 100).toFixed(1) : 0;
          const colors = ['accent-indigo', 'accent-amber', 'accent-emerald'];
          const iconColors = ['indigo', 'amber', 'emerald'];
          const icons = [<Activity key={0} size={22} />, <Syringe key={1} size={22} />, <Activity key={2} size={22} />];
          return (
            <div key={network} className={`stat-card ${colors[i]}`}>
              <div className={`stat-card-icon ${iconColors[i]}`}>{icons[i]}</div>
              <div className="stat-card-label">{network.replace('-NET', '').replace('Surv', '')} Rate</div>
              <div className="stat-card-value">{latest.toFixed(1)}</div>
              <span className={`card-change ${change >= 0 ? 'negative' : 'positive'}`}>
                {change >= 0 ? '↑' : '↓'} {Math.abs(change)}% vs prev week
              </span>
            </div>
          );
        })}
      </div>

      <div className="filter-bar fade-in">
        <select className="filter-select" value={selectedNetwork} onChange={e => setSelectedNetwork(e.target.value)}>
          <option value="all">All Networks</option>
          <option value="COVID-NET">COVID-NET</option>
          <option value="FluSurv-NET">FluSurv-NET</option>
          <option value="RSV-NET">RSV-NET</option>
        </select>
        <select className="filter-select" value={selectedSite || ''} onChange={e => setSelectedSite(e.target.value || null)}>
          <option value="">All Sites</option>
          {sites.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="charts-grid charts-grid-equal">
        <div className="card fade-in">
          <div className="card-header">
            <span className="card-title"><TestTubes size={18} /> Positivity Rate Comparison</span>
          </div>
          <Plot
            data={Object.entries(pathogenGroups).map(([pathogen, data]) => {
              const sorted = [...data].sort((a, b) => a.week_end?.localeCompare(b.week_end));
              return {
                x: sorted.map(d => d.week_end),
                y: sorted.map(d => d.percent_test_positivity),
                type: 'scatter',
                mode: 'lines',
                name: pathogen,
                line: { color: pathogenColors[pathogen] || '#888', width: 2, shape: 'spline' },
                fill: 'tozeroy',
                fillcolor: (pathogenColors[pathogen] || '#888') + '15',
              };
            })}
            layout={{
              ...plotLayout,
              height: 350,
              yaxis: { ...plotLayout.yaxis, title: { text: '% Positive', font: { size: 11 } } },
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
          />
        </div>

        <div className="card fade-in">
          <div className="card-header">
            <span className="card-title"><TrendingUp size={18} /> Hospitalization Rates by Network</span>
          </div>
          <Plot
            data={Object.entries(hospByNetwork).map(([network, data]) => {
              const sorted = [...data].sort((a, b) => a.week_ending_date?.localeCompare(b.week_ending_date));
              return {
                x: sorted.map(d => d.week_ending_date),
                y: sorted.map(d => d.weekly_rate),
                type: 'scatter',
                mode: 'lines',
                name: network,
                line: { color: networkColors[network] || '#888', width: 2, shape: 'spline' },
              };
            })}
            layout={{
              ...plotLayout,
              height: 350,
              yaxis: { ...plotLayout.yaxis, title: { text: 'Rate per 100k', font: { size: 11 } } },
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
          />
        </div>
      </div>

      <div className="card fade-in" style={{ marginTop: '0' }}>
        <div className="card-header">
          <span className="card-title"><BarChart2 size={18} /> Season-over-Season Comparison</span>
        </div>
        <Plot
          data={Object.entries(hospByNetwork).map(([network, data]) => {
            const seasons = {};
            data.forEach(d => {
              if (!seasons[d.season]) seasons[d.season] = [];
              seasons[d.season].push(d);
            });

            const seasonKeys = Object.keys(seasons).sort();
            const lastTwoSeasons = seasonKeys.slice(-2);

            return lastTwoSeasons.map((season, si) => {
              const sorted = [...(seasons[season] || [])].sort((a, b) =>
                (a.mmwr_week || 0) - (b.mmwr_week || 0)
              );
              return {
                x: sorted.map(d => `Week ${d.mmwr_week}`),
                y: sorted.map(d => d.weekly_rate),
                type: 'bar',
                name: `${network} (${season})`,
                marker: {
                  color: si === 0
                    ? (networkColors[network] || '#888') + '50'
                    : networkColors[network] || '#888',
                },
                opacity: si === 0 ? 0.5 : 1,
              };
            });
          }).flat()}
          layout={{
            ...plotLayout,
            height: 350,
            barmode: 'group',
            yaxis: { ...plotLayout.yaxis, title: { text: 'Rate per 100k', font: { size: 11 } } },
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: '100%' }}
        />
      </div>

      <div className="card fade-in" style={{ marginTop: '20px' }}>
        <div className="card-header">
          <span className="card-title"><LineChart size={18} /> Recent Hospitalization Data</span>
          <span className="badge badge-updated">{hospitalizations.length} records</span>
        </div>
        <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Network</th>
                <th>Site</th>
                <th>Week Ending</th>
                <th>Weekly Rate</th>
                <th>Cumulative Rate</th>
              </tr>
            </thead>
            <tbody>
              {hospitalizations.slice(0, 50).map((d, i) => (
                <tr key={i}>
                  <td>
                    <span style={{ color: networkColors[d.surveillance_network] || '#888', fontWeight: 600 }}>
                      {d.surveillance_network}
                    </span>
                  </td>
                  <td>{d.site}</td>
                  <td>{d.week_ending_date?.slice(0, 10)}</td>
                  <td style={{ fontWeight: 600 }}>{d.weekly_rate?.toFixed(1)}</td>
                  <td>{d.cumulative_rate?.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
