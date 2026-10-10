import { NavLink } from 'react-router-dom'
import { Building2, ChartColumn, CloudRain, Database, ExternalLink, House, Phone, Waves, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const PRIMARY: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/', label: 'Dispatch Center', icon: House },
  { to: '/simulation', label: 'Disaster Simulation', icon: CloudRain },
  { to: '/resources', label: 'Resource Planning', icon: Building2 },
  { to: '/analytics', label: 'Analytics & Reports', icon: ChartColumn },
]

export default function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <nav className={`sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
      <div className="brand">
        <span className="brand-mark" aria-hidden><Waves size={20} /></span>
        <span className="brand-text">
          <span className="brand-name">RESQ Mumbai</span>
          <span className="brand-sub">Emergency command simulation</span>
        </span>
        <button type="button" className="icon-btn nav-close" onClick={onClose} aria-label="Close navigation"><X size={18} /></button>
      </div>
      <ul className="nav-list">
        {PRIMARY.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink to={to} end={to === '/'} className="nav-item" onClick={onClose} title={label}>
              <Icon size={18} aria-hidden /><span className="nav-label">{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
      <hr className="nav-sep" />
      <ul className="nav-list">
        <li>
          <a href="/sos" target="_blank" rel="noopener" className="nav-item" title="Citizen SOS (opens in a new tab)">
            <Phone size={18} aria-hidden /><span className="nav-label">Citizen SOS</span>
            <ExternalLink size={14} className="nav-ext" aria-label="opens in a new tab" />
          </a>
        </li>
        <li>
          <NavLink to="/sources" className="nav-item" onClick={onClose} title="Data & Sources">
            <Database size={18} aria-hidden /><span className="nav-label">Data &amp; Sources</span>
          </NavLink>
        </li>
      </ul>
      <div className="nav-foot">
        <p><strong>Research simulation.</strong> Not for real emergency use. Ambulances, beds, incidents and closures are simulated.</p>
        <p>Road graph and hospital locations: OpenStreetMap contributors (ODbL).</p>
      </div>
    </nav>
  )
}
