import createPlotlyComponent from 'react-plotly.js/factory';
import Plotly from 'plotly.js/lib/core';
import bar from 'plotly.js/lib/bar';
import heatmap from 'plotly.js/lib/heatmap';
import choropleth from 'plotly.js/lib/choropleth';
import usaTopology from '../assets/usa_110m.json';

// Only the SVG trace types used by this dashboard belong in its browser bundle.
Plotly.register([bar, heatmap, choropleth]);
// Preload the only geographic scope used here before any chart can mount.
window.PlotlyGeoAssets.topojson.usa_110m = usaTopology;
const PlotlyComponent = createPlotlyComponent(Plotly);

export default function Plot({ config, ...props }) {
  return <PlotlyComponent {...props} config={{ ...config, topojsonURL: `${import.meta.env.BASE_URL}geo/` }} />;
}
