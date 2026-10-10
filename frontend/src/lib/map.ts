import { Bandage, HeartPulse, Waves } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface Layers {
  incidents: boolean; ambulances: boolean; hospitals: boolean; closures: boolean
  flood: boolean; evac: boolean; sites: boolean; others: boolean; tiles: boolean; network: boolean
}
export const DEFAULT_LAYERS: Layers = {
  incidents: true, ambulances: true, hospitals: true, closures: true,
  flood: true, evac: false, sites: false, others: true, tiles: true, network: false,
}
export interface Focus { leg: 'to_incident' | 'to_hospital' | 'all'; nonce: number }

export const TYPE_ICON: Record<string, LucideIcon> = { medical: HeartPulse, flood_rescue: Waves, trauma: Bandage }
