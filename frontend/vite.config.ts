import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// /api is proxied to the FastAPI backend (uvicorn on :8000).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8000' } },
  preview: { port: 4173, proxy: { '/api': 'http://127.0.0.1:8000' } },
})
