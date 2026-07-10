// Wireframe edge colors per agent state. Chosen against BOTH themes: the scene itself always
// renders on a neutral dark canvas background (see office-scene.tsx) regardless of the app's
// light/dark token, so wires need to read clearly on that one background rather than swap with
// --color-* CSS custom properties (three.js materials don't resolve CSS vars). Hex values below
// were picked to roughly track the app's status hues (ok/warn/accent) while staying legible on
// a dark canvas.
import type { AgentState } from './agent-office-state'

export const DESK_EDGE_COLOR: Record<AgentState, string> = {
  idle: '#8a8a8a', // neutral gray — waiting, no task
  assigned: '#7aa2f7', // accent blue — task received, walking to desk
  working: '#e0a03e', // warm amber — actively working
  done: '#6bd68a', // green glow — step completed
}

export const COORDINATOR_EDGE_COLOR = '#e8e8e8' // near-white — always visible, distinct from any agent state
