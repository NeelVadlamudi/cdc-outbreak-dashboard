import { useState, useEffect } from 'react';
import Plot from 'react-plotly.js';
import { 
  AlertTriangle, 
  Hospital, 
  AlertCircle, 
  TestTubes, 
  Syringe, 
  Map as MapIcon, 
  BarChart2, 
  TrendingUp, 
  ClipboardList 
} from 'lucide-react';
import { getDashboardSummary, getAriActivity, getTestPositivity, getHospTrends, getHealth } from '../api';
import { STATE_ABBREV } from '../lib/states';

const RISK_LEVELS = { 'Minimal': 0, 'Very Low': 1, 'Low': 2, 'Moderate': 3, 'High': 4, 'Very High': 5 };
// Deepened colors for better contrast on white background
const RISK_COLORS = ['#059669', '#0891b2', '#3b82f6', '#d97706', '#dc2626', '#b91c1c'];

export default function Overview() {
  const [summary, setSummary] = useState(null);
  const [ariData, setAriData] = useState([]);
  const [positivity, setPositivity] = useState([]);
  const [trends, setTrends] = useState([]);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [summaryRes, ariRes, posRes, trendsRes, healthRes] = await Promise.all([
          getDashboardSummary(),
          getAriActivity(),
          getTestPositivity('limit=500'),
          getHospTrends(),
          getHealth().catch(() => null),
        ]);
        setSummary(summaryRes);
        setAriData(ariRes.data || []);
        setPositivity(posRes.data || []);
        setTrends(trendsRes.data || []);
        setHealth(healthRes);
      } catch (err) {
        console.error('Failed to fetch dashboard data:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
    const interval = setInterval(fetchData, 300000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="loading-page">
        <div className="loading-spinner" />
        <div className="loading-page-text">Loading this week’s respiratory virus picture…</div>
      </div>
    );
  }

  const mapStates = ariData
    .filter(d => STATE_ABBREV[d.geography])
    .map(d => ({
      state: STATE_ABBREV[d.geography],
      name: d.geography,
      level: RISK_LEVELS[d.label] ?? 1,
      label: d.label,
    }));

  const covidPos = positivity.filter(d => d.pathogen === 'COVID-19').sort((a, b) => a.week_end?.localeCompare(b.week_end));
  const fluPos = positivity.filter(d => d.pathogen === 'Influenza').sort((a, b) => a.week_end?.localeCompare(b.week_end));
  const rsvPos = positivity.filter(d => d.pathogen === 'RSV').sort((a, b) => a.week_end?.localeCompare(b.week_end));

  const highRiskCount = summary?.high_risk_states || 0;
  const totalStates = summary?.total_states_tracked || 0;
  const latestPositivity = summary?.latest_positivity || [];
  const covidRate = latestPositivity.find(p => p.pathogen === 'COVID-19')?.percent_test_positivity || 0;
  const fluRate = latestPositivity.find(p => p.pathogen === 'Influenza')?.percent_test_positivity || 0;
  const rsvRate = latestPositivity.find(p => p.pathogen === 'RSV')?.percent_test_positivity || 0;

  const plotLayout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'Space Grotesk, sans-serif', color: '#6b6b6b', size: 11 },
    margin: { l: 45, r: 20, t: 30, b: 40 },
    xaxis: { gridcolor: '#e8e8e8', zeroline: false },
    yaxis: { gridcolor: '#e8e8e8', zeroline: false },
    showlegend: true,
    legend: { orientation: 'h', y: -0.15, font: { size: 11, color: '#3a3a3a' } },
  };

  return (
    <div>
      <div className="page-header fade-in">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">Overview</h1>
            <p className="page-subtitle">
              A national snapshot of respiratory illness activity, test positivity, and hospital trends this week.
            </p>
          </div>
          <div className="page-header-badges">
            <div className="status-badge status-live">
              <span className="live-dot" aria-hidden /> Updated regularly
            </div>
            <span className="badge badge-updated">
              as of {health?.as_of || summary?.latest_dates?.ari_activity?.slice(0, 10) || '—'}
            </span>
          </div>
        </div>
      </div>

      {health?.tables?.length > 0 && (
        <div
          className={`alert-banner ${health.status === 'stale' ? 'warning' : 'fade-in'}`}
          role="status"
          style={{ marginBottom: '16px', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}
        >
          <ClipboardList size={16} />
          <span style={{ fontWeight: 600 }}>How current is the data?</span>
          {health.tables.filter((t) => !t.legacy).map((t) => (
            <span
              key={`${t.table}-${t.dataset || ''}`}
              className="badge"
              style={{
                background: t.stale ? '#FEF3C7' : '#ECFDF5',
                color: t.stale ? '#92400E' : '#065F46',
              }}
            >
              {t.table}{t.dataset ? ` (${t.dataset})` : ''}: week of {t.latest_week || '—'}
              {t.stale ? ' · may be behind' : ''}
            </span>
          ))}
        </div>
      )}

      {highRiskCount > 0 && (
        <div className={`alert-banner ${highRiskCount >= 5 ? 'danger' : 'warning'}`}>
          <AlertTriangle size={18} />
          <span>
            <strong>{highRiskCount} state{highRiskCount > 1 ? 's' : ''}</strong> reporting High or Very High
            respiratory illness activity this week
          </span>
        </div>
      )}

      <div className="stat-cards-grid">
        <div className="stat-card accent-indigo fade-in fade-in-delay-1">
          <div className="stat-card-icon indigo"><Hospital size={22} /></div>
          <div className="stat-card-label">States Monitored</div>
          <div className="stat-card-value">{totalStates}</div>
        </div>
        <div className="stat-card accent-rose fade-in fade-in-delay-2">
          <div className="stat-card-icon rose"><AlertCircle size={22} /></div>
          <div className="stat-card-label">High Risk States</div>
          <div className="stat-card-value">{highRiskCount}</div>
        </div>
        <div className="stat-card accent-amber fade-in fade-in-delay-3">
          <div className="stat-card-icon amber"><TestTubes size={22} /></div>
          <div className="stat-card-label">COVID Positivity</div>
          <div className="stat-card-value">{covidRate}%</div>
        </div>
        <div className="stat-card accent-emerald fade-in fade-in-delay-4">
          <div className="stat-card-icon emerald"><Syringe size={22} /></div>
          <div className="stat-card-label">Flu Positivity</div>
          <div className="stat-card-value">{fluRate}%</div>
        </div>
      </div>

      <div className="charts-grid">
        <div className="card fade-in">
          <div className="card-header">
            <span className="card-title"><MapIcon size={18} /> US Respiratory Illness Activity</span>
            <span className="badge badge-updated">Current Week</span>
          </div>
          <Plot
            data={[{
              type: 'choropleth',
              locationmode: 'USA-states',
              locations: mapStates.map(s => s.state),
              z: mapStates.map(s => s.level),
              text: mapStates.map(s => `${s.name}: ${s.label}`),
              hovertemplate: '%{text}<extra></extra>',
              colorscale: RISK_COLORS.map((c, i) => [i / 5, c]),
              showscale: true,
              colorbar: {
                title: { text: 'Risk', font: { size: 11, color: '#6B7280' } },
                ticktext: ['Min', 'V.Low', 'Low', 'Mod', 'High', 'V.High'],
                tickvals: [0, 1, 2, 3, 4, 5],
                tickfont: { size: 10, color: '#6B7280' },
                len: 0.6,
                thickness: 12,
                outlinewidth: 0,
              },
              marker: { line: { color: '#FFFFFF', width: 0.8 } },
            }]}
            layout={{
              ...plotLayout,
              geo: {
                scope: 'usa',
                bgcolor: 'rgba(0,0,0,0)',
                lakecolor: '#E5E7EB',
                landcolor: '#F3F4F6',
                subunitcolor: '#D1D5DB',
                showlakes: true,
                projection: { type: 'albers usa' },
              },
              margin: { l: 0, r: 0, t: 0, b: 0 },
              height: 360,
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
          />
        </div>

        <div className="card fade-in">
          <div className="card-header">
            <span className="card-title"><BarChart2 size={18} /> Risk Distribution</span>
          </div>
          {(summary?.risk_distribution || []).map((item, i) => {
            const riskClass = item.label?.toLowerCase().replace(' ', '-') || 'low';
            return (
              <div key={i} style={{ marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span className={`risk-badge risk-${riskClass === 'data-unavailable' ? 'low' : riskClass}`}>
                    {item.label}
                  </span>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>{item.count}</span>
                </div>
                <div style={{
                  height: '6px',
                  background: 'var(--bg-elevated)',
                  borderRadius: 'var(--radius-full)',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.min(100, (item.count / (totalStates || 1)) * 100)}%`,
                    background: RISK_COLORS[RISK_LEVELS[item.label] || 1],
                    borderRadius: 'var(--radius-full)',
                    transition: 'width 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
                  }} />
                </div>
              </div>
            );
          })}

          <div style={{ marginTop: '28px', borderTop: '1px solid var(--border-subtle)', paddingTop: '20px' }}>
            <div className="card-title" style={{ marginBottom: '16px' }}><TestTubes size={16} /> Test Positivity</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
              {[
                { label: 'COVID', rate: covidRate, color: '#0000d9' },
                { label: 'Flu', rate: fluRate, color: '#D97706' },
                { label: 'RSV', rate: rsvRate, color: '#059669' },
              ].map(v => (
                <div key={v.label} className="gauge-container">
                  <svg width="60" height="60" viewBox="0 0 64 64">
                    <circle cx="32" cy="32" r="28" fill="none" stroke="var(--border-subtle)" strokeWidth="5" />
                    <circle cx="32" cy="32" r="28" fill="none" stroke={v.color} strokeWidth="5"
                      strokeDasharray={`${(v.rate / 100) * 176} 176`}
                      strokeLinecap="round"
                      transform="rotate(-90 32 32)"
                      style={{ transition: 'stroke-dasharray 0.8s cubic-bezier(0.16, 1, 0.3, 1)' }}
                    />
                    <text x="32" y="36" textAnchor="middle" fill="var(--text-primary)"
                      fontSize="14" fontWeight="700" fontFamily="Space Grotesk, sans-serif">{v.rate}%</text>
                  </svg>
                  <span className="gauge-label">{v.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="charts-grid charts-grid-equal">
        <div className="card fade-in">
          <div className="card-header">
            <span className="card-title"><TrendingUp size={18} /> Test Positivity — Trends</span>
          </div>
          <Plot
            data={[
              {
                x: covidPos.map(d => d.week_end),
                y: covidPos.map(d => d.percent_test_positivity),
                type: 'scatter',
                mode: 'lines',
                name: 'COVID-19',
                line: { color: '#0000d9', width: 2, shape: 'spline' },
                fill: 'tozeroy',
                fillcolor: 'rgba(79, 70, 229, 0.08)',
              },
              {
                x: fluPos.map(d => d.week_end),
                y: fluPos.map(d => d.percent_test_positivity),
                type: 'scatter',
                mode: 'lines',
                name: 'Influenza',
                line: { color: '#D97706', width: 2, shape: 'spline' },
              },
              {
                x: rsvPos.map(d => d.week_end),
                y: rsvPos.map(d => d.percent_test_positivity),
                type: 'scatter',
                mode: 'lines',
                name: 'RSV',
                line: { color: '#059669', width: 2, shape: 'spline' },
              },
            ]}
            layout={{
              ...plotLayout,
              height: 300,
              yaxis: { ...plotLayout.yaxis, title: { text: '% Positive', font: { size: 11 } } },
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
          />
        </div>

        <div className="card fade-in">
          <div className="card-header">
            <span className="card-title"><Hospital size={18} /> Hospitalization Rate Trends</span>
          </div>
          <Plot
            data={(() => {
              const viruses = ['COVID-NET', 'FluSurv-NET', 'RSV-NET'];
              const colors = ['#0000d9', '#B45309', '#1A7A5C'];
              return viruses.map((v, i) => {
                const d = trends.filter(t => t.virus === v).sort((a, b) => a.week_ending_date?.localeCompare(b.week_ending_date));
                return {
                  x: d.map(t => t.week_ending_date),
                  y: d.map(t => t.avg_rate),
                  type: 'scatter',
                  mode: 'lines',
                  name: v.replace('-NET', '').replace('Surv', ''),
                  line: { color: colors[i], width: 2, shape: 'spline' },
                };
              });
            })()}
            layout={{
              ...plotLayout,
              height: 300,
              yaxis: { ...plotLayout.yaxis, title: { text: 'Rate per 100k', font: { size: 11 } } },
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
          />
        </div>
      </div>

      <div className="card fade-in" style={{ marginTop: '0' }}>
        <div className="card-header">
          <span className="card-title"><ClipboardList size={18} /> Current State Activity Levels</span>
          <span className="badge badge-updated">{ariData.length} regions tracked</span>
        </div>
        <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>State/Territory</th>
                <th>Activity Level</th>
                <th>Week Ending</th>
              </tr>
            </thead>
            <tbody>
              {ariData
                .filter(d => d.label !== 'Data Unavailable')
                .sort((a, b) => (RISK_LEVELS[b.label] || 0) - (RISK_LEVELS[a.label] || 0))
                .map((d, i) => {
                  const riskClass = d.label?.toLowerCase().replace(' ', '-') || 'low';
                  return (
                    <tr key={i}>
                      <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{d.geography}</td>
                      <td>
                        <span className={`risk-badge risk-${riskClass}`}>{d.label}</span>
                      </td>
                      <td>{d.week_end?.slice(0, 10)}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
