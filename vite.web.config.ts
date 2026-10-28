import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Runs the UI in a normal browser with demo data, for UI work without Electron.
export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  server: { port: 5199, host: '127.0.0.1' }
})
