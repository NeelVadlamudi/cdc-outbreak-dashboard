import process from 'node:process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// APP_BASE is set by the Pages workflow (/cdc-outbreak-dashboard/app/); local dev stays at /.
export default defineConfig({
  base: process.env.APP_BASE || '/',
  plugins: [react()],
})
