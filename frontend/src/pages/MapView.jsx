import { useState, useEffect, useRef } from 'react';
import Plot from '../components/Plot';
import { Map as MapIcon, MapPin, Activity, Globe as GlobeIcon, Link2 } from 'lucide-react';
import Globe from 'react-globe.gl';
import earthTexture from '../assets/earth-water.png';
import { getAriActivity, getAriHistory } from '../api';
import { STATE_COORDS } from '../lib/states';
import ChartEmpty from '../components/ChartEmpty';
import { getParam, setParams } from '../lib/urlState';

const RISK_LEVELS = { 'Minimal': 0, 'Very Low': 1, 'Low': 2, 'Moderate': 3, 'High': 4, 'Very High': 5 };
// Matte Light Mode Aesthetic Colors for the points
const RISK_COLORS = ['#4f7d6a', '#5a8a8c', '#7a8f86', '#c4924a', '#c47a5a', '#a86850'];
const RISK_LABELS = ['Minimal', 'Very Low', 'Low', 'Moderate', 'High', 'Very High'];

export default function MapView() {
  const globeRef = useRef();
  const globeContainerRef = useRef(null);
  const [ariData, setAriData] = useState([]);
  const [selectedState, setSelectedState] = useState(() => getParam('state', '') || null);
  const [stateHistory, setStateHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [globeWidth, setGlobeWidth] = useState(800);

  const fetchData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await getAriActivity();
      setAriData(res.data || []);
    } catch (err) {
      console.error('Failed to fetch map data:', err);
      setLoadError(err instanceof Error ? err.message : 'Failed to load map');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    const container = globeContainerRef.current;
    if (loading || !container) return;
    const observer = new ResizeObserver(() => setGlobeWidth(container.clientWidth));
    observer.observe(container);
    return () => observer.disconnect();
  }, [loading]);

  useEffect(() => {
    setParams({ state: selectedState || '' });
    if (!selectedState) return;
    getAriHistory(selectedState).then(res => {
      setStateHistory(res.data || []);
    }).catch(console.error);
    
    // Auto-rotate globe to the selected state
    if (globeRef.current && STATE_COORDS[selectedState]) {
      const coords = STATE_COORDS[selectedState];
      globeRef.current.pointOfView({ lat: coords.lat, lng: coords.lng, altitude: 0.8 }, 1000);
    }
  }, [selectedState]);

  // Initial auto-position over US
  useEffect(() => {
    if (globeRef.current && ariData.length > 0) {
      globeRef.current.pointOfView({ lat: 39.8, lng: -98.5, altitude: 1.2 }, 2000);
      globeRef.current.controls().autoRotate = true;
      globeRef.current.controls().autoRotateSpeed = 0.5;
    }
  }, [ariData]);

  if (loading) {
    return (
      <div className="loading-page">
        <div className="loading-spinner" />
        <div className="loading-page-text">Loading the state activity map…</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="page-container">
        <ChartEmpty
          title="Map temporarily unavailable"
          detail={`${loadError} This is a service status note—not a disease alert.`}
          onRetry={fetchData}
        />
      </div>
    );
  }

  if (!ariData.length) {
    return (
      <div className="page-container">
        <ChartEmpty
          title="No ARI activity rows for this week"
          detail="The API returned an empty activity table. That is a data gap—not proof that activity is zero."
          onRetry={fetchData}
        />
      </div>
    );
  }

  // Map Data to Globe Points
  const globePoints = ariData
    .filter(d => STATE_COORDS[d.geography])
    .map(d => {
      const coords = STATE_COORDS[d.geography];
      const level = RISK_LEVELS[d.label] ?? 1;
      return {
        lat: coords.lat,
        lng: coords.lng,
        size: level === 0 ? 0.3 : 0.4 + (level * 0.15),
        color: RISK_COLORS[level],
        name: d.geography,
        label: d.label,
        level: level
      };
    });

  const historyData = stateHistory
    .sort((a, b) => a.week_end?.localeCompare(b.week_end))
    .map(d => ({
      date: d.week_end?.slice(0, 10),
      level: RISK_LEVELS[d.label] ?? 1,
      label: d.label,
    }));

  const plotLayout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'Space Grotesk, sans-serif', color: '#6b6b6b', size: 11 },
    margin: { l: 0, r: 0, t: 0, b: 0 },
  };

  return (
    <div className="page-container">
      <div className="page-header fade-in">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">Map</h1>
            <p className="page-subtitle">
              ARI activity by state (shareable <code>?state=</code>). Use the list below if you prefer keyboard navigation over the globe.
            </p>
          </div>
          <button
            type="button"
            className="filter-btn"
            onClick={() => navigator.clipboard?.writeText(window.location.href).catch(() => {})}
          >
            <Link2 size={14} /> Share view
          </button>
        </div>
      </div>

      <div className="filter-bar fade-in">
        <label htmlFor="map-state-select" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          State
        </label>
        <select
          id="map-state-select"
          className="filter-select"
          value={selectedState || ''}
          onChange={(e) => setSelectedState(e.target.value || null)}
          aria-label="Select a state for ARI history"
        >
          <option value="">All states (globe)</option>
          {ariData
            .map((d) => d.geography)
            .filter(Boolean)
            .sort()
            .map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
        </select>
      </div>

      <div className="charts-grid fade-in">
        <div className="card" style={{ padding: 0, overflow: 'hidden' }} id="globe-container" ref={globeContainerRef}>
          <div className="card-header" style={{ padding: '24px 24px 0', borderBottom: 'none' }}>
            <span className="card-title"><GlobeIcon size={18} /> United States</span>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', zIndex: 10 }}>
              {RISK_LABELS.map((label, i) => (
                <span key={label} style={{
                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                  fontSize: '11px', color: RISK_COLORS[i], fontWeight: 600,
                }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: RISK_COLORS[i] }} />
                  {label}
                </span>
              ))}
            </div>
          </div>
          <div style={{ position: 'relative', width: '100%', height: '520px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <Globe
              ref={globeRef}
              width={globeWidth}
              height={520}
              globeImageUrl={earthTexture}
              // Light transparent styling for pure light mode
              backgroundColor="rgba(0,0,0,0)"
              atmosphereColor="#E0E7FF"
              atmosphereAltitude={0.15}
              pointsData={globePoints}
              pointLat="lat"
              pointLng="lng"
              pointColor="color"
              pointAltitude={d => d.size * 0.15}
              pointRadius="size"
              pointsMerge={false}
              pointResolution={32}
              onPointClick={(point) => {
                setSelectedState(point.name);
                if (globeRef.current) {
                  globeRef.current.controls().autoRotate = false; // Stop rotating on click
                }
              }}
              onPointHover={(point) => {
                if (typeof window !== 'undefined') {
                  document.body.style.cursor = point ? 'pointer' : 'default';
                }
              }}
              pointLabel={d => `
                <div style="background: rgba(255,255,255,0.95); padding: 8px 12px; border-radius: 4px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); border: 1px solid #e8e8e8;">
                  <strong style="color: #121212; font-family: Space Grotesk, sans-serif; font-size: 14px;">${d.name}</strong><br/>
                  <span style="color: ${d.color}; font-family: Space Grotesk, sans-serif; font-size: 12px; font-weight: 600;">${d.label}</span>
                </div>
              `}
              ringsData={globePoints.filter(d => d.level >= 4).map(d => ({ lat: d.lat, lng: d.lng, color: d.color }))}
              ringColor="color"
              ringMaxRadius={d => d.level * 1.5}
              ringPropagationSpeed={1}
              ringRepeatPeriod={1000}
            />
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title"><MapPin size={18} /> Node Analytics</span>
          </div>
          {selectedState ? (
            <>
              <h3 style={{ fontSize: '24px', fontWeight: 800, marginBottom: '8px', color: 'var(--text-primary)' }}>
                {selectedState}
              </h3>
              {(() => {
                const stateData = ariData.find(d => d.geography === selectedState);
                const pointColor = globePoints.find(p => p.name === selectedState)?.color || '#9CA3AF';
                return (
                  <div style={{ marginBottom: '24px' }}>
                    <span style={{ 
                      fontSize: '13px', 
                      padding: '6px 14px',
                      background: `${pointColor}20`,
                      color: pointColor,
                      border: `1px solid ${pointColor}40`,
                      borderRadius: '16px',
                      fontWeight: 700
                    }}>
                      {stateData?.label || 'Unknown'}
                    </span>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px', fontWeight: 500 }}>
                      Week ending: {stateData?.week_end?.slice(0, 10)}
                    </p>
                  </div>
                );
              })()}
              {historyData.length > 0 && (
                <>
                  <div className="card-title" style={{ marginBottom: '16px' }}><Activity size={16} /> Chronological Activity Trace</div>
                  <Plot divId="map-history"
                    data={[{
                      x: historyData.map(d => d.date),
                      y: historyData.map(d => d.level),
                      type: 'scatter',
                      mode: 'lines+markers',
                      line: { color: '#0000d9', width: 2, shape: 'spline' },
                      marker: {
                        size: 6,
                        color: historyData.map(d => RISK_COLORS[d.level]),
                        line: { color: '#FFF', width: 1 }
                      },
                      fill: 'tozeroy',
                      fillcolor: 'rgba(79, 70, 229, 0.08)',
                      hovertemplate: '%{x}<br>%{text}<extra></extra>',
                      text: historyData.map(d => d.label),
                    }]}
                    layout={{
                      ...plotLayout,
                      height: 220,
                      margin: { l: 30, r: 10, t: 10, b: 30 },
                      yaxis: {
                        ticktext: RISK_LABELS,
                        tickvals: [0, 1, 2, 3, 4, 5],
                        tickfont: { size: 9, color: '#6B7280' },
                        gridcolor: '#e8e8e8',
                      },
                      xaxis: { gridcolor: '#e8e8e8', tickfont: { color: '#6B7280' } },
                    }}
                    config={{ displayModeBar: false, responsive: true }}
                    style={{ width: '100%' }}
                  />
                </>
              )}

              <div style={{ marginTop: '24px', borderTop: '1px solid var(--border-subtle)', paddingTop: '20px' }}>
                <div className="card-title" style={{ marginBottom: '16px' }}>Node Integrity Stats</div>
                {(() => {
                  const highWeeks = historyData.filter(d => d.level >= 4).length;
                  const avgLevel = historyData.length > 0
                    ? (historyData.reduce((s, d) => s + d.level, 0) / historyData.length).toFixed(1)
                    : 'N/A';
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                      <div style={{ padding: '16px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', transition: 'transform 0.2s', cursor: 'default' }} onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'} onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>High/V.High Weeks</div>
                        <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--color-high)', marginTop: '4px' }}>{highWeeks}</div>
                      </div>
                      <div style={{ padding: '16px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', transition: 'transform 0.2s', cursor: 'default' }} onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'} onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>Avg Activity</div>
                        <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)', marginTop: '4px' }}>{avgLevel}</div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </>
          ) : (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              height: '350px', color: 'var(--text-muted)', textAlign: 'center',
            }}>
              <GlobeIcon size={48} strokeWidth={1} style={{ marginBottom: '16px', color: '#D1D5DB' }} />
              <p style={{ fontSize: '15px', fontWeight: 500 }}>Select a state on the map to see its latest data.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
