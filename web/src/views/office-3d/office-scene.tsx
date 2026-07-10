// The 3D office wireframe (v12 M30). Driven ONLY by the office room's real SSE stream
// (use-office-stream from P4) — no polling, no fake state, no animation without a backing
// event. Renders the coordinator's desk (center) + one desk per agent seen in the stream, each
// colored/tweened by its derived state (idle/assigned/working/done). Falls back to a 2D table
// when prefers-reduced-motion or a mobile UA is detected (see use-3d-fallback.ts), matching the
// route-level Suspense boundary in office-scene-lazy.tsx.
import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useMemo } from 'react'
import { useOfficeStream } from '../../hooks/use-office-stream'
import { AgentDesk } from './agent-desk'
import { agentIdsInOrder, deriveAgentDesks } from './agent-office-state'
import { AgentStatusTable } from './agent-status-table'
import { CoordinatorDesk } from './coordinator-desk'
import { deskPosition } from './desk-layout'
import { OfficeFloor } from './office-floor'
import { OfficeProps } from './office-props'
import { use3dFallback } from './use-3d-fallback'

const OFFICE_ROOM_ID = 'office'

export function OfficeScene() {
  const { messages } = useOfficeStream(OFFICE_ROOM_ID)
  const useFallback = use3dFallback()

  const agentIds = useMemo(() => agentIdsInOrder(messages), [messages])
  const desks = useMemo(() => deriveAgentDesks(messages), [messages])

  if (useFallback) {
    return <AgentStatusTable agentIds={agentIds} desks={desks} />
  }

  return (
    <section className="office-3d-scene">
      <h2>Văn phòng 3D</h2>
      <p className="ops-chat-hint">
        Sơ đồ trực quan: bàn điều phối viên ở giữa, mỗi nhân sự có một bàn riêng — trạng thái và
        công việc cập nhật theo thời gian thực từ dòng sự kiện của phòng.
      </p>
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
              never reach this branch — use3dFallback already routed them to the 2D table. */}
          <OrbitControls enablePan={false} minDistance={4} maxDistance={20} autoRotate autoRotateSpeed={0.5} />
        </Canvas>
      </div>
      {agentIds.length === 0 && (
        <p className="ops-chat-empty">Chưa có nhân sự nào xuất hiện trong dòng sự kiện.</p>
      )}
    </section>
  )
}

export default OfficeScene
