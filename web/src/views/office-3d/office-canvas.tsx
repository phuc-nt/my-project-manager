// The 3D office Canvas, props-in only (v15): extracted from the former office-canvas.tsx
// so the unified office screen owns the ONE SSE stream and passes derived state down to
// both this canvas and the text activity feed — the two surfaces can never disagree.
// Everything inside is unchanged v12-v14 behavior: event-driven desks/avatars, slow
// auto-rotate, static props, low-poly wireframe look.
import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useEffect, useState } from 'react'
import { AgentDesk } from './agent-desk'
import type { AgentDeskState } from './agent-office-state'
import { CoordinatorDesk } from './coordinator-desk'
import { deskPosition } from './desk-layout'
import { OfficeFloor } from './office-floor'
import { OfficeProps } from './office-props'

interface OfficeCanvasProps {
  agentIds: string[]
  desks: Map<string, AgentDeskState>
  // v16: desks render ONLY for CURRENT registry staff (ghost desks from old events are
  // gone); null/undefined = no filtering (callers without a roster yet).
  rosterIds?: string[] | null
  // v16: when a workroom is selected, everyone NOT in it dims (opacity) — visual only.
  dimmedIds?: Set<string>
}

// Roster filter runs BEFORE ring-index math (red-team m-visibleDesks): positions are
// computed over the VISIBLE list so a filtered-out ghost never leaves a hole in the ring.
export function visibleDesks(agentIds: string[], rosterIds?: string[] | null): string[] {
  if (!rosterIds) return agentIds
  const allowed = new Set(rosterIds)
  return agentIds.filter((id) => allowed.has(id))
}

// v18: the canvas background follows the app theme (the page toggle stamps
// data-theme on <html>) — a MutationObserver keeps it live without a reload.
function useThemeIsDark(): boolean {
  const [dark, setDark] = useState(
    () => document.documentElement.dataset.theme === 'dark',
  )
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setDark(document.documentElement.dataset.theme === 'dark'),
    )
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return dark
}

export function OfficeCanvas({ agentIds, desks, rosterIds, dimmedIds }: OfficeCanvasProps) {
  const visible = visibleDesks(agentIds, rosterIds)
  const dark = useThemeIsDark()
  return (
    <div className="office-3d-canvas-wrap">
      <Canvas camera={{ position: [0, 6, 10], fov: 50 }}>
        <color attach="background" args={[dark ? '#141414' : '#fafafa']} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 8, 5]} intensity={0.8} />
        <OfficeFloor dark={dark} />
        <OfficeProps />
        <CoordinatorDesk />
        {visible.map((id, i) => {
          const desk = desks.get(id)
          if (!desk) return null
          // Colleague desk position while this desk is consulting — ring indexes are
          // computed over the VISIBLE list (a consult partner outside the roster has no
          // desk to walk to, so the walk simply doesn't trigger).
          const colleagueIdx = desk.consultWith ? visible.indexOf(desk.consultWith) : -1
          const consultPos = colleagueIdx >= 0 ? deskPosition(colleagueIdx, visible.length) : null
          return (
            <AgentDesk
              key={id}
              position={deskPosition(i, visible.length)}
              label={id}
              desk={desk}
              consultPos={consultPos}
              dimmed={dimmedIds?.has(id) ?? false}
            />
          )
        })}
        {/* autoRotate = the v14 "living office" slow 360° pan (~0.5 ≈ full turn / 4 min);
            drei pauses it while the user drags and resumes after. Reduced-motion users
            never reach this component — the unified screen renders the 2D table instead. */}
        <OrbitControls enablePan={false} minDistance={4} maxDistance={20} autoRotate autoRotateSpeed={0.5} />
      </Canvas>
    </div>
  )
}

export default OfficeCanvas
