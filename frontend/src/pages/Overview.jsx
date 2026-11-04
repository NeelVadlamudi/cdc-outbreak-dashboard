import { useState, useEffect, useRef, useCallback } from 'react';
import Plot from 'react-plotly.js';
import {
  Hospital,
  Activity,
  TestTubes,
  Syringe,
  Map as MapIcon,
  BarChart2,
  TrendingUp,
  ClipboardList,
  ChevronDown,
  ChevronRight,
  Info,
} from 'lucide-react';
import { getDashboardSummary, getAriActivity, getTestPositivity, getHospTrends, getHealth } from '../api';
import { STATE_ABBREV } from '../lib/states';

const RISK_LEVELS = { 'Minimal': 0, 'Very Low': 1, 'Low': 2, 'Moderate': 3, 'High': 4, 'Very High': 5 };
const RISK_COLORS = ['#059669', '#0891b2', '#3b82f6', '#d97706', '#dc2626', '#b91c1c'];
const HEALTH_POLL_MS = 60_000;
const DISCLAIMER =
  'For research, education, and situational awareness—not clinical decision-making or official CDC guidance.';

function formatCheckedAt(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function MetricCard({ accent, iconTone, delayClass, icon, metric, fallbackValue, fallbackLabel, asPercent }) {
  const value = metric?.value ?? fallbackValue;
  const hasValue = value !== null && value !== undefined && value !== '';
  const percent = asPercent || metric?.unit === '%';
  const display = !hasValue
    ? '—'
    : percent
      ? `${value}%`
      : value;
  const plain = metric?.plain || metric?.insight || null;
  const week = metric?.week_ending || null;

  return (
    <div className={`stat-card ${accent} fade-in ${delayClass || ''}`.trim()}>
      <div className={`stat-card-icon ${iconTone}`}>{icon}</div>
      <div className="stat-card-label">{metric?.headline || fallbackLabel}</div>
      <div className="stat-card-value">{display}</div>
      {plain ? <div className="stat-card-plain">{plain}</div> : null}
      {week ? <div className="stat-card-week">CDC week ending {week}</div> : null}
      {metric?.source_table ? (
        <details className="stat-card-tech">
          <summary>Technical detail</summary>
          <div>
            Source table: <code>{metric.source_table}</code>
            {metric.unit ? <> · unit: {metric.unit}</> : null}
            {metric.insight && metric.insight !== plain ? <> · {metric.insight}</> : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

export default function Overview() {
  const [summary, setSummary] = useState(null);
  const [ariData, setAriData] = useState([]);
  const [positivity, setPositivity] = useState([]);
  const [trends, setTrends] = useState([]);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [dataStatusOpen, setDataStatusOpen] = useState(false);
  const [lastCheckedLocal, setLastCheckedLocal] = useState(null);
  const asOfRef = useRef(null);

  const loadDashboard = useCallback(async () => {
    try {
      const [summaryRes, ariRes, posRes, trendsRes, healthRes] = await Promise.all([
        getDashboardSummary(),
        getAriActivity(),
        getTestPositivity('limit=500'),
        getHospTrends(),
        getHealth().catch((err) => ({
          status: 'degraded',
          database: 'error',
          as_of: null,
          checked_at: new Date().toISOString(),
          tables: [],
          error: err instanceof Error ? err.message : 'health fetch failed',
        })),
      ]);
      setSummary(summaryRes);
      setAriData(ariRes.data || []);
      setPositivity(posRes.data || []);
      setTrends(trendsRes.data || []);
      setHealth(healthRes);
      setLastCheckedLocal(healthRes?.checked_at || new Date().toISOString());
      asOfRef.current = healthRes?.as_of || summaryRes?.week_ending || null;
      setLoadError(null);
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
      setLoadError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // Live heartbeat: poll /api/health every 60s; reload stats when CDC week (as_of) moves.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const h = await getHealth();
        if (cancelled) return;
        setHealth(h);
        setLastCheckedLocal(h?.checked_at || new Date().toISOString());
        const nextAsOf = h?.as_of ?? null;
        if (nextAsOf && asOfRef.current && nextAsOf !== asOfRef.current) {
          asOfRef.current = nextAsOf;
          await loadDashboard();
        } else if (nextAsOf && !asOfRef.current) {
          asOfRef.current = nextAsOf;
        }
      } catch (err) {
        if (cancelled) return;
        setHealth((prev) => ({
          ...(prev || {}),
          status: 'degraded',
          checked_at: new Date().toISOString(),
          error: err instanceof Error ? err.message : 'health poll failed',
        }));
        setLastCheckedLocal(new Date().toISOString());
      }
    };
    const id = setInterval(poll, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [loadDashboard]);

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

  const metrics = summary?.metrics || {};
  const highRiskCount = summary?.high_risk_states;
  const totalStates = summary?.total_states_tracked;
  const latestPositivity = summary?.latest_positivity || [];
  const covidRaw = latestPositivity.find(p => p.pathogen === 'COVID-19')?.percent_test_positivity;
  const fluRaw = latestPositivity.find(p => p.pathogen === 'Influenza')?.percent_test_positivity;
  const rsvRaw = latestPositivity.find(p => p.pathogen === 'RSV')?.percent_test_positivity;
  const covidRate = metrics.positivity_covid?.value ?? covidRaw ?? null;
  const fluRate = metrics.positivity_flu?.value ?? fluRaw ?? null;
  const rsvRate = metrics.positivity_rsv?.value ?? rsvRaw ?? null;

  const weekEnding =
    health?.as_of ||
    summary?.week_ending ||
    summary?.latest_dates?.ari_activity?.slice(0, 10) ||
    null;
  const checkedLabel = formatCheckedAt(lastCheckedLocal || health?.checked_at);
  const briefing = summary?.briefing;

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
              Built for clinicians, coordinators, and researchers who need this week’s CDC respiratory picture—fast.
            </p>
            <p className="page-disclaimer">{DISCLAIMER}</p>
          </div>
          <div className="page-header-badges">
            <div
              className={`status-badge ${
                health?.status === 'degraded' || health?.status === 'stale'
                  ? 'status-degraded'
                  : 'status-live'
              }`}
              title={health?.error || undefined}
            >
              <span className="live-dot" aria-hidden />
              {weekEnding
                ? `CDC week ending ${weekEnding}`
                : 'CDC week unavailable'}
              {health?.status === 'stale' ? ' · refresh may be delayed' : ''}
              {health?.status === 'degraded' ? ' · service check delayed' : ''}
              {checkedLabel ? ` · last checked ${checkedLabel}` : ''}
            </div>
          </div>
        </div>
      </div>

      {loadError && (
        <div className="alert-banner ops" role="status" style={{ marginBottom: 16 }}>
          <Info size={18} />
          <span>
            Dashboard temporarily unavailable. Could not reach the data service
            {loadError ? ` (${loadError})` : ''}. Try refreshing in a minute—this is a connection
            issue, not a disease alert.
          </span>
        </div>
      )}

      {health?.status === 'degraded' && (
        <div className="alert-banner ops" role="status" style={{ marginBottom: 16 }}>
          <Info size={18} />
          <span>
            Data refresh delayed{health?.error ? ` (${health.error})` : ''}. Showing the last
            figures that loaded successfully. Epidemiology-week surveillance—not live case counts.
          </span>
        </div>
      )}

      {health?.status === 'stale' && !loadError && (
        <div className="alert-banner ops" role="status" style={{ marginBottom: 16 }}>
          <Info size={18} />
          <span>
            Some surveillance tables may be behind the usual CDC publish cadence
            {weekEnding ? ` (latest week ending ${weekEnding})` : ''}. Open Data status for details.
            This is a freshness note—not a clinical alert.
          </span>
        </div>
      )}

      {briefing && (
        <div className="briefing-card fade-in" aria-label="Weekly briefing">
          <div className="briefing-kicker">Weekly briefing · MMWR-style</div>
          <div className="briefing-beat">
            <span className="briefing-label">What is known</span>
            <p>{briefing.known}</p>
          </div>
          <div className="briefing-beat">
            <span className="briefing-label">What this week’s data adds</span>
            <p>{briefing.this_week}</p>
          </div>
          <div className="briefing-beat">
            <span className="briefing-label">Plain implication</span>
            <p>{briefing.implication}</p>
          </div>
        </div>
      )}

      <button
        type="button"
        className="data-status-toggle"
        onClick={() => setDataStatusOpen((o) => !o)}
        aria-expanded={dataStatusOpen}
      >
        {dataStatusOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <ClipboardList size={16} />
        <span>Data status</span>
        <span className="data-status-hint">
          {health?.status === 'stale' ? 'some tables may be behind' : health?.status || '—'}
        </span>
      </button>
      {dataStatusOpen && (
        <div
          className={`alert-banner ${health?.status === 'stale' ? 'warning' : 'info'}`}
          role="status"
          style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}
        >
          <span style={{ fontWeight: 600, width: '100%' }}>
            How current is the data? Tables below are epidemiology weeks from CDC SODA—not tick-by-tick cases.
          </span>
          {(health?.tables || []).length === 0 && (
            <span>No table freshness rows returned{health?.error ? ` (${health.error})` : ''}.</span>
          )}
          {(health?.tables || []).map((t) => (
            <span
              key={`${t.table}-${t.dataset || ''}`}
              className="badge"
              style={{
                background: t.stale ? '#FEF3C7' : '#ECFDF5',
                color: t.stale ? '#92400E' : '#065F46',
              }}
            >
              {t.table}{t.dataset ? ` (${t.dataset})` : ''}
              {t.legacy ? ' · legacy' : ''}: week of {t.latest_week || '—'}
              {t.stale ? ' · may be behind' : ''}
            </span>
          ))}
          {summary?.wastewater_error && (
            <span className="badge" style={{ background: '#FEF3C7', color: '#92400E' }}>
              wastewater summary error: {summary.wastewater_error}
            </span>
          )}
        </div>
      )}

      {typeof highRiskCount === 'number' && typeof totalStates === 'number' && highRiskCount > 0 && (
        <div className="alert-banner situation" role="status">
          <Info size={18} />
          <span>
            {highRiskCount} of {totalStates} states/territories reported High or Very High ARI
            activity
            {weekEnding ? ` · CDC week ending ${weekEnding}` : ' this CDC week'}
            . CDC activity labels for situational awareness—not an emergency declaration.
          </span>
        </div>
      )}

      <div className="stat-cards-grid">
        <MetricCard
          accent="accent-indigo"
          iconTone="indigo"
          delayClass="fade-in-delay-1"
          icon={<Hospital size={22} />}
          metric={metrics.states_monitored}
          fallbackValue={totalStates ?? null}
          fallbackLabel="States Monitored"
        />
        <MetricCard
          accent="accent-amber"
          iconTone="amber"
          delayClass="fade-in-delay-2"
          icon={<Activity size={22} />}
          metric={metrics.high_risk}
          fallbackValue={highRiskCount ?? null}
          fallbackLabel="High / Very High ARI"
        />
        <MetricCard
          accent="accent-amber"
          iconTone="amber"
          delayClass="fade-in-delay-3"
          icon={<TestTubes size={22} />}
          metric={metrics.positivity_covid}
          fallbackValue={covidRate}
          fallbackLabel="COVID Positivity"
          asPercent
        />
        <MetricCard
          accent="accent-emerald"
          iconTone="emerald"
          delayClass="fade-in-delay-4"
          icon={<Syringe size={22} />}
          metric={metrics.positivity_flu}
          fallbackValue={fluRate}
          fallbackLabel="Flu Positivity"
          asPercent
        />
      </div>

      <div className="charts-grid">
        <div className="card fade-in">
          <div className="card-header">
            <span className="card-title"><MapIcon size={18} /> US Respiratory Illness Activity</span>
            <span className="badge badge-updated">
              {weekEnding ? `CDC week ending ${weekEnding}` : 'Current week'}
            </span>
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
                title: { text: 'ARI activity', font: { size: 11, color: '#6B7280' } },
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
            <span className="card-title"><BarChart2 size={18} /> Activity levels</span>
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
                { label: 'COVID', rate: covidRate, color: '#0000d9', plain: metrics.positivity_covid?.plain },
                { label: 'Flu', rate: fluRate, color: '#D97706', plain: metrics.positivity_flu?.plain },
                { label: 'RSV', rate: rsvRate, color: '#059669', plain: metrics.positivity_rsv?.plain },
              ].map(v => (
                <div key={v.label} className="gauge-container">
                  <svg width="60" height="60" viewBox="0 0 64 64">
                    <circle cx="32" cy="32" r="28" fill="none" stroke="var(--border-subtle)" strokeWidth="5" />
                    <circle cx="32" cy="32" r="28" fill="none" stroke={v.color} strokeWidth="5"
                      strokeDasharray={`${((typeof v.rate === 'number' ? v.rate : 0) / 100) * 176} 176`}
                      strokeLinecap="round"
                      transform="rotate(-90 32 32)"
                      style={{ transition: 'stroke-dasharray 0.8s cubic-bezier(0.16, 1, 0.3, 1)' }}
                    />
                    <text x="32" y="36" textAnchor="middle" fill="var(--text-primary)"
                      fontSize="14" fontWeight="700" fontFamily="Space Grotesk, sans-serif">
                      {typeof v.rate === 'number' ? `${v.rate}%` : '—'}
                    </text>
                  </svg>
                  <span className="gauge-label">{v.label}</span>
                  {v.plain ? <span className="gauge-plain">{v.plain}</span> : null}
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

      <div className="card fade-in glossary-card">
        <div className="card-header">
          <span className="card-title">What these numbers mean</span>
        </div>
        <ul className="glossary-list">
          <li><strong>Test positivity</strong> is the share of clinical tests that were positive that CDC week—not “live cases right now.” Plain “1 in N” is the same figure restated.</li>
          <li><strong>Hospitalization rates</strong> from RESP-NET are weekly rates per 100,000 population for the surveillance network, age group, and site shown.</li>
          <li><strong>High / Very High ARI</strong> counts jurisdictions at those CDC activity labels for the latest ARI week in the database.</li>
          <li><strong>Wastewater (NWSS)</strong> is an early community signal, not a diagnosis.</li>
          <li>{DISCLAIMER}</li>
        </ul>
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
