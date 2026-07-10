// The 3D office Canvas, props-in only (v15): extracted from the former office-canvas.tsx
// so the unified office screen owns the ONE SSE stream and passes derived state down to
// both this canvas and the text activity feed — the two surfaces can never disagree.
// Everything inside is unchanged v12-v14 behavior: event-driven desks/avatars, slow
// auto-rotate, static props, low-poly wireframe look.
import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { AgentDesk } from './agent-desk'
import type { AgentDeskState } from './agent-office-state'
import { CoordinatorDesk } from './coordinator-desk'
import { deskPosition } from './desk-layout'
import { OfficeFloor } from './office-floor'
import { OfficeProps } from './office-props'

interface OfficeCanvasProps {
  agentIds: string[]
  desks: Map<string, AgentDeskState>
}

export function OfficeCanvas({ agentIds, desks }: OfficeCanvasProps) {
  return (
    <div className="office-3d-canvas-wrap">
      <Canvas camera={{ position: [0, 6, 10], fov: 50 }}>
        <color attach="background" args={['#fafafa']} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 8, 5]} intensity={0.8} />
        <OfficeFloor />
        <OfficeProps />
        <CoordinatorDesk />
        {agentIds.map((id, i) => {
          const desk = desks.get(id)
          if (!desk) return null
          // Colleague desk position while this desk is consulting — drives the
          // walk-toward-each-other tween in AgentDesk. The ring index of the
          // colleague comes from the same first-seen order this map iterates in.
          const colleagueIdx = desk.consultWith ? agentIds.indexOf(desk.consultWith) : -1
          const consultPos = colleagueIdx >= 0 ? deskPosition(colleagueIdx, agentIds.length) : null
          return (
            <AgentDesk
              key={id}
              position={deskPosition(i, agentIds.length)}
              label={id}
              desk={desk}
              consultPos={consultPos}
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
