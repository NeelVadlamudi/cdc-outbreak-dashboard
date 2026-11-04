import { useState, useEffect } from 'react';
import Plot from 'react-plotly.js';
import { Bot, Crosshair, Calendar, BrainCircuit, Activity, LineChart, AlertTriangle } from 'lucide-react';
import { getForecast } from '../api';

const VIRUSES = [
  { key: 'COVID-NET', label: 'COVID-19', color: '#4F46E5', icon: <Activity size={16} /> },
  { key: 'FluSurv-NET', label: 'Influenza', color: '#D97706', icon: <Activity size={16} /> },
  { key: 'RSV-NET', label: 'RSV', color: '#059669', icon: <Activity size={16} /> },
];

function underperforms(model) {
  return Boolean(model?.underperforms_baseline || (model?.backtest?.lstm?.underperforms_baseline));
}

export default function Forecasts() {
  const [selectedVirus, setSelectedVirus] = useState('COVID-NET');
  const [forecast, setForecast] = useState(null);
  const [loading, setLoading] = useState(true);

  const selectVirus = (key) => {
    setLoading(true);
    setSelectedVirus(key);
  };

  useEffect(() => {
    getForecast(selectedVirus)
      .then(res => setForecast(res))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [selectedVirus]);

  const virusInfo = VIRUSES.find(v => v.key === selectedVirus);
  const lstm = forecast?.experimental_models?.lstm;
  const showLstm = lstm?.status === 'success';
  const lstmUnder = underperforms(lstm) || forecast?.backtest?.lstm?.underperforms_baseline
    || (forecast?.backtest?.lstm && forecast.backtest.lstm.beats_last_value === false);

  const plotLayout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'Inter, sans-serif', color: '#6B7280', size: 11 },
    margin: { l: 50, r: 20, t: 30, b: 50 },
    xaxis: { gridcolor: '#F3F4F6', zeroline: false, title: { text: 'Week', font: { size: 11 } } },
    yaxis: { gridcolor: '#F3F4F6', zeroline: false, title: { text: 'Rate per 100k', font: { size: 11 } } },
    showlegend: true,
    legend: { orientation: 'h', y: -0.2, font: { size: 11, color: '#4B5563' } },
  };

  return (
    <div className="page-container">
      <div className="page-header fade-in">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">Outlook</h1>
            <p className="page-subtitle">
              Primary view is last-week persistence. LSTM is experimental and scored against that baseline in published backtests.
            </p>
          </div>
        </div>
      </div>

      <div className="filter-bar fade-in">
        {VIRUSES.map(v => (
          <button
            key={v.key}
            className={`filter-btn ${selectedVirus === v.key ? 'active' : ''}`}
            onClick={() => selectVirus(v.key)}
          >
            {v.icon} {v.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading-page" style={{ minHeight: '40vh' }}>
          <div className="loading-spinner" />
          <div className="loading-page-text">Loading {virusInfo?.label} outlook...</div>
        </div>
      ) : forecast?.status === 'success' ? (
        <>
          {(forecast.note || forecast.backtest?.lstm?.note) && (
            <div className="alert-banner warning fade-in" role="note">
              <AlertTriangle size={18} />
              <span>{forecast.note || forecast.backtest?.lstm?.note}</span>
            </div>
          )}
          <div className="stat-cards-grid fade-in" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="stat-card accent-indigo">
              <div className="stat-card-icon indigo"><Crosshair size={22} /></div>
              <div className="stat-card-label">Last observed</div>
              <div className="stat-card-value">{forecast.last_observed_rate ?? '—'}</div>
            </div>
            <div className="stat-card accent-emerald">
              <div className="stat-card-icon emerald"><Calendar size={22} /></div>
              <div className="stat-card-label">Last Data Point</div>
              <div className="stat-card-value" style={{ fontSize: '24px' }}>{forecast.last_data_date}</div>
            </div>
            <div className="stat-card accent-amber">
              <div className="stat-card-icon amber"><LineChart size={22} /></div>
              <div className="stat-card-label">Outlook Horizon</div>
              <div className="stat-card-value">4 weeks</div>
            </div>
          </div>

          <div className="card fade-in" style={{ marginBottom: '24px' }}>
            <div className="card-header">
              <span className="card-title">
                <LineChart size={18} /> {virusInfo?.label} — Last-value outlook (primary)
              </span>
              <span className="badge badge-updated">persistence baseline</span>
            </div>
            <Plot
              data={[
                {
                  x: forecast.historical_recent.map((_, i) => `Week -${forecast.historical_recent.length - i}`),
                  y: forecast.historical_recent,
                  type: 'scatter',
                  mode: 'lines+markers',
                  name: 'Actual (Recent)',
                  line: { color: virusInfo?.color, width: 2.5 },
                  marker: { size: 7, color: virusInfo?.color, line: { color: 'white', width: 1 } },
                },
                {
                  x: forecast.forecasts.map(f => f.date),
                  y: forecast.forecasts.map(f => f.predicted_rate),
                  type: 'scatter',
                  mode: 'lines+markers',
                  name: 'Last-value outlook',
                  line: { color: '#0F766E', width: 2.5 },
                  marker: { size: 8, color: '#0F766E', line: { color: 'white', width: 1 } },
                },
              ]}
              layout={{ ...plotLayout, height: 400 }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: '100%' }}
            />
          </div>

          {showLstm && (
            <div className="card fade-in" style={{ marginBottom: '24px' }}>
              <div className="card-header">
                <span className="card-title">
                  <BrainCircuit size={18} /> Experimental — LSTM
                </span>
                {lstmUnder && (
                  <span className="badge" style={{ background: '#FEF3C7', color: '#92400E' }}>
                    underperforms baseline
                  </span>
                )}
              </div>
              <Plot
                data={[
                  {
                    x: forecast.historical_recent.map((_, i) => `Week -${forecast.historical_recent.length - i}`),
                    y: forecast.historical_recent,
                    type: 'scatter',
                    mode: 'lines+markers',
                    name: 'Actual (Recent)',
                    line: { color: '#9CA3AF', width: 2 },
                  },
                  {
                    x: lstm.forecasts.map(f => f.date),
                    y: lstm.forecasts.map(f => f.predicted_rate),
                    type: 'scatter',
                    mode: 'lines+markers',
                    name: 'LSTM (experimental)',
                    line: { color: '#F59E0B', width: 2.5, dash: 'dash' },
                    marker: { size: 8, symbol: 'diamond', color: '#F59E0B', line: { color: 'white', width: 1 } },
                  },
                ]}
                layout={{ ...plotLayout, height: 320 }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: '100%' }}
              />
              <div style={{ marginTop: '12px', fontSize: '13px', color: 'var(--text-muted)' }}>
                Validation MAE: {lstm.mae ?? '—'} · not the product primary outlook
              </div>
            </div>
          )}

          <div className="charts-grid">
            <div className="card fade-in">
              <div className="card-header">
                <span className="card-title"><Calendar size={18} /> Weekly last-value breakdown</span>
              </div>
              <div style={{ display: 'grid', gap: '16px' }}>
                {forecast.forecasts.map((f, i) => (
                  <div key={i} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '16px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)'
                  }}>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>Week {i + 1} — {f.date}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', fontWeight: 500 }}>
                        Persistence of last observed rate
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '24px', fontWeight: 800, color: virusInfo?.color }}>
                        {f.predicted_rate}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>per 100k</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card fade-in">
              <div className="card-header">
                <span className="card-title"><BrainCircuit size={18} /> Why last-value is primary</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '20px' }}>
                <div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', marginBottom: '6px' }}>Backtest</div>
                  <div style={{ fontWeight: 500, fontSize: '14px', color: 'var(--text-secondary)' }}>
                    Rolling-origin evals show LSTM and XGBoost rarely beat repeating last week on these weekly RESP-NET series. The UI therefore leads with persistence.
                  </div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', marginBottom: '6px' }}>Experimental models</div>
                  <div style={{ fontWeight: 700, fontSize: '15px' }}>LSTM (2×64) · XGBoost — shown only with underperforms-baseline when they lose</div>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="card" style={{ padding: '60px', textAlign: 'center', background: 'var(--bg-elevated)' }}>
          <Bot size={56} strokeWidth={1.5} color="#9CA3AF" style={{ margin: '0 auto 20px' }} />
          <h3 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)' }}>Outlook unavailable</h3>
          <p style={{ color: 'var(--text-secondary)', marginTop: '8px', fontSize: '15px', maxWidth: '500px', margin: '8px auto 0' }}>
            {forecast?.detail || 'No hospitalization series is available for this network.'}
          </p>
        </div>
      )}
    </div>
  );
}
