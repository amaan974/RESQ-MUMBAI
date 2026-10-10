import { Suspense, lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { SimProvider } from './store.tsx'
import AppShell from './components/AppShell.tsx'
import DispatchCenter from './pages/DispatchCenter.tsx'

// Secondary views load on demand so the dispatcher's first load stays small.
const DisasterSimulation = lazy(() => import('./pages/DisasterSimulation.tsx'))
const ResourcePlanning = lazy(() => import('./pages/ResourcePlanning.tsx'))
const AnalyticsReports = lazy(() => import('./pages/AnalyticsReports.tsx'))
const DataSources = lazy(() => import('./pages/DataSources.tsx'))
const SosPage = lazy(() => import('./SosPage.tsx'))

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="loading" role="status">Loading view.</div>}>
        <Routes>
          <Route path="/sos" element={<SosPage />} />
          <Route element={<SimProvider><AppShell /></SimProvider>}>
            <Route path="/" element={<DispatchCenter />} />
            <Route path="/simulation" element={<DisasterSimulation />} />
            <Route path="/resources" element={<ResourcePlanning />} />
            <Route path="/analytics" element={<AnalyticsReports />} />
            <Route path="/sources" element={<DataSources />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
