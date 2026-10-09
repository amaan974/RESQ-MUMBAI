import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import Dashboard from './Dashboard.tsx'
import SosPage from './SosPage.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/sos" element={<SosPage />} />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
