import { useState, useEffect, useRef } from 'react';
import Plot from 'react-plotly.js';
import { Map as MapIcon, MapPin, Activity, Globe as GlobeIcon } from 'lucide-react';
import Globe from 'react-globe.gl';
import { getAriActivity, getAriHistory } from '../api';
import { STATE_COORDS } from '../lib/states';

const RISK_LEVELS = { 'Minimal': 0, 'Very Low': 1, 'Low': 2, 'Moderate': 3, 'High': 4, 'Very High': 5 };
// Matte Light Mode Aesthetic Colors for the points
const RISK_COLORS = ['#059669', '#0ea5e9', '#6366f1', '#f59e0b', '#ef4444', '#b91c1c'];
const RISK_LABELS = ['Minimal', 'Very Low', 'Low', 'Moderate', 'High', 'Very High'];

export default function MapView() {
  const globeRef = useRef();
  const [ariData, setAriData] = useState([]);
  const [selectedState, setSelectedState] = useState(null);
  const [stateHistory, setStateHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [globeWidth, setGlobeWidth] = useState(800);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await getAriActivity();
        setAriData(res.data || []);
      } catch (err) {
        console.error('Failed to fetch map data:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();

    // Auto-resize the globe container
    const handleResize = () => {
      const parent = document.getElementById('globe-container');
      if (parent) {
        setGlobeWidth(parent.clientWidth);
      }
    };
    window.addEventListener('resize', handleResize);
    // Initial size
    setTimeout(handleResize, 100);

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
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
        <div className="loading-page-text">Loading the state map...</div>
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
    font: { family: 'Inter, sans-serif', color: '#6B7280', size: 11 },
    margin: { l: 0, r: 0, t: 0, b: 0 },
  };

  return (
    <div className="page-container">
      <div className="page-header fade-in">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">State map</h1>
            <p className="page-subtitle">
              Interactive 3D WebGL projection — click any node for historic viral activity
            </p>
          </div>
        </div>
      </div>

      <div className="charts-grid fade-in">
        <div className="card" style={{ padding: 0, overflow: 'hidden' }} id="globe-container">
          <div className="card-header" style={{ padding: '24px 24px 0', borderBottom: 'none' }}>
            <span className="card-title"><GlobeIcon size={18} /> US Continental Projection</span>
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
              globeImageUrl="//unpkg.com/three-globe/example/img/earth-water.png"
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
                <div style="background: rgba(255,255,255,0.9); padding: 8px 12px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); border: 1px solid #E5E7EB;">
                  <strong style="color: #111827; font-family: Inter, sans-serif; font-size: 14px;">${d.name}</strong><br/>
                  <span style="color: ${d.color}; font-family: Inter, sans-serif; font-size: 12px; font-weight: 600;">${d.label}</span>
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
                  <Plot
                    data={[{
                      x: historyData.map(d => d.date),
                      y: historyData.map(d => d.level),
                      type: 'scatter',
                      mode: 'lines+markers',
                      line: { color: '#4F46E5', width: 2, shape: 'spline' },
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
                        gridcolor: '#F3F4F6',
                      },
                      xaxis: { gridcolor: '#F3F4F6', tickfont: { color: '#6B7280' } },
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
