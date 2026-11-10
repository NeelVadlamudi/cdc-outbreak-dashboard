import process from 'node:process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// APP_BASE is set by the Pages workflow (/cdc-outbreak-dashboard/app/); local dev stays at /.
export default defineConfig({
  base: process.env.APP_BASE || '/',
  define: { global: 'globalThis' },
  plugins: [react(), {
    name: 'same-origin-plot-geography',
    enforce: 'pre',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/plotly.js/src/plot_api/plot_config.js')) return null;
      // Keep the upstream fallback same-origin as well as the explicit component config.
      return code.replace(/(topojsonURL:\s*\{[\s\S]*?dflt:\s*)'[^']*'/,
        (_, prefix) => prefix + JSON.stringify(`${process.env.APP_BASE || '/'}geo/`))
        .replace(/'By default, the topojson files[^']*'/, "'The topojson files are served by this application.'");
    },
  }],
})
