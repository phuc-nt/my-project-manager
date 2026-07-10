// The coordinator's desk — always at the center of the office, static (no tween, no state
// machine: the coordinator is always "present"). Low-poly wireframe: a plain boxGeometry with
// drei's <Edges> outline, no texture/GLB per the phase's KISS decision.
import { Edges } from '@react-three/drei'
import { COORDINATOR_EDGE_COLOR } from './desk-colors'

const DESK_SIZE: [number, number, number] = [1.4, 0.6, 0.8]

export function CoordinatorDesk() {
  return (
    <group position={[0, 0.3, 0]}>
      <mesh>
        <boxGeometry args={DESK_SIZE} />
        <meshBasicMaterial color="#000000" transparent opacity={0} />
        <Edges color={COORDINATOR_EDGE_COLOR} lineWidth={2} />
      </mesh>
    </group>
  )
}
