import { useState, useEffect } from 'react';
import Plot from 'react-plotly.js';
import { Bot, Crosshair, Calendar, BrainCircuit, Activity, LineChart } from 'lucide-react';
import { getForecast, trainModel } from '../api';

const VIRUSES = [
  { key: 'COVID-NET', label: 'COVID-19', color: '#4F46E5', icon: <Activity size={16} /> },
  { key: 'FluSurv-NET', label: 'Influenza', color: '#D97706', icon: <Activity size={16} /> },
  { key: 'RSV-NET', label: 'RSV', color: '#059669', icon: <Activity size={16} /> },
];

export default function Forecasts() {
  const [selectedVirus, setSelectedVirus] = useState('COVID-NET');
  const [forecast, setForecast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [training, setTraining] = useState(false);

  useEffect(() => {
    setLoading(true);
    getForecast(selectedVirus)
      .then(res => setForecast(res))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [selectedVirus]);

  const handleTrain = async () => {
    setTraining(true);
    try {
      await trainModel(selectedVirus);
      const res = await getForecast(selectedVirus);
      setForecast(res);
    } catch (err) {
      console.error('Training failed:', err);
    } finally {
      setTraining(false);
    }
  };

  const virusInfo = VIRUSES.find(v => v.key === selectedVirus);

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
            <h1 className="page-title">Predictive Engine</h1>
            <p className="page-subtitle">
              LSTM deep learning forecasts predicting hospitalization rates 4 weeks ahead
            </p>
          </div>
          <button
            className="filter-btn active"
            onClick={handleTrain}
            disabled={training}
            style={{ padding: '8px 20px', fontSize: '13px' }}
          >
            {training ? <><Bot className="animate-pulse" size={16} /> Training...</> : <><BrainCircuit size={16} /> Retrain Model</>}
          </button>
        </div>
      </div>

      <div className="filter-bar fade-in">
        {VIRUSES.map(v => (
          <button
            key={v.key}
            className={`filter-btn ${selectedVirus === v.key ? 'active' : ''}`}
            onClick={() => setSelectedVirus(v.key)}
          >
            {v.icon} {v.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading-page" style={{ minHeight: '40vh' }}>
          <div className="loading-spinner" />
          <div className="loading-page-text">Generating {virusInfo?.label} forecast...</div>
        </div>
      ) : forecast?.status === 'success' ? (
        <>
          <div className="stat-cards-grid fade-in" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="stat-card accent-indigo">
              <div className="stat-card-icon indigo"><Crosshair size={22} /></div>
              <div className="stat-card-label">Model MAE</div>
              <div className="stat-card-value">{forecast.mae}</div>
            </div>
            <div className="stat-card accent-emerald">
              <div className="stat-card-icon emerald"><Calendar size={22} /></div>
              <div className="stat-card-label">Last Data Point</div>
              <div className="stat-card-value" style={{ fontSize: '24px' }}>{forecast.last_data_date}</div>
            </div>
            <div className="stat-card accent-amber">
              <div className="stat-card-icon amber"><LineChart size={22} /></div>
              <div className="stat-card-label">Forecast Horizon</div>
              <div className="stat-card-value">4 weeks</div>
            </div>
          </div>

          <div className="card fade-in" style={{ marginBottom: '24px' }}>
            <div className="card-header">
              <span className="card-title">
                <LineChart size={18} /> {virusInfo?.label} — Actual vs Predicted
              </span>
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
                  name: 'LSTM Forecast',
                  line: { color: '#F59E0B', width: 2.5, dash: 'dash' },
                  marker: { size: 8, symbol: 'diamond', color: '#F59E0B', line: { color: 'white', width: 1 } },
                },
                {
                  x: forecast.forecasts.map(f => f.date),
                  y: forecast.forecasts.map(f => f.upper_bound),
                  type: 'scatter',
                  mode: 'lines',
                  name: 'Upper CI',
                  line: { color: 'rgba(245, 158, 11, 0.3)', width: 0 },
                  showlegend: false,
                },
                {
                  x: forecast.forecasts.map(f => f.date),
                  y: forecast.forecasts.map(f => f.lower_bound),
                  type: 'scatter',
                  mode: 'lines',
                  name: 'Confidence Interval',
                  line: { color: 'rgba(245, 158, 11, 0.3)', width: 0 },
                  fill: 'tonexty',
                  fillcolor: 'rgba(245, 158, 11, 0.15)',
                },
              ]}
              layout={{ ...plotLayout, height: 400 }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: '100%' }}
            />
          </div>

          <div className="charts-grid">
            <div className="card fade-in">
              <div className="card-header">
                <span className="card-title"><Calendar size={18} /> Weekly Forecast Breakdown</span>
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
                        95% CI: {f.lower_bound} – {f.upper_bound} per 100k
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
                <span className="card-title"><BrainCircuit size={18} /> Model Architecture</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '20px' }}>
                <div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', marginBottom: '6px' }}>Topology</div>
                  <div style={{ fontWeight: 700, fontSize: '15px' }}>LSTM (2 layers, 64 hidden units)</div>
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>PyTorch Deep Learning Engine</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', marginBottom: '6px' }}>Features</div>
                  <div style={{ fontWeight: 500, fontSize: '14px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {['Value', 'Lag-1', 'Lag-2', 'Roll Avg (4w)', 'Seasonal (sin/cos)'].map(ft => (
                      <span key={ft} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-light)', padding: '4px 10px', borderRadius: '4px', fontSize: '12px' }}>{ft}</span>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', marginBottom: '6px' }}>Time Horizon</div>
                  <div style={{ fontWeight: 700, fontSize: '15px' }}>Lookback: 12 wks → Forecast: 4 wks</div>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="card" style={{ padding: '60px', textAlign: 'center', background: 'var(--bg-elevated)' }}>
          <Bot size={56} strokeWidth={1.5} color="#9CA3AF" style={{ margin: '0 auto 20px' }} />
          <h3 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)' }}>Model Not Yet Trained</h3>
          <p style={{ color: 'var(--text-secondary)', marginTop: '8px', fontSize: '15px', maxWidth: '500px', margin: '8px auto 0' }}>
            {forecast?.detail || 'Click "Retrain Model" to train the LSTM neural network on the latest historical CDC data to generate 4-week projections.'}
          </p>
        </div>
      )}
    </div>
  );
}
