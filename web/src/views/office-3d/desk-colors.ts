// Wireframe colors for the 3D office. The scene renders on a LIGHT (near-white) canvas
// background (see office-scene.tsx) regardless of the app's light/dark token — three.js
// materials can't resolve CSS custom properties, so one fixed palette is tuned for that
// background instead of swapping with the theme.
import type { AgentState } from './agent-office-state'

// State colors (desk outline): darker variants of the app's status hues so they stay
// legible on the light floor.
export const DESK_EDGE_COLOR: Record<AgentState, string> = {
  idle: '#9aa0a6', // neutral gray — waiting, no task
  assigned: '#2f6bd8', // accent blue — task received, walking to desk
  working: '#d97706', // amber — actively working
  done: '#188a4c', // green — step completed
}

export const COORDINATOR_EDGE_COLOR = '#2b2b2b' // near-black — always visible, distinct

// Personality palette: each agent gets a stable personal hue (avatar body/accessory) derived
// from its id, independent of the state color on the desk — two readable dimensions: WHO
// (avatar hue) and WHAT STATE (desk outline).
const AGENT_PALETTE = [
  '#d94848', // đỏ gạch
  '#2f6bd8', // xanh dương
  '#188a4c', // xanh lá
  '#b0529f', // hồng tím
  '#d97706', // cam đất
  '#0e8f8f', // teal
  '#7a5cd6', // tím
  '#946200', // nâu vàng
]

export function agentHash(id: string): number {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}

export function agentColor(id: string): string {
  return AGENT_PALETTE[agentHash(id) % AGENT_PALETTE.length]
}
