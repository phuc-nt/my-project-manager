// The coordinator's desk — always at the center of the office, static (no tween, no state
// machine: the coordinator is always "present"). Low-poly wireframe box + a small standing
// monitor so bàn trưởng phòng nhìn khác bàn nhân viên ngay cả khi chưa có event nào.
import { Edges, Html } from '@react-three/drei'
import { COORDINATOR_EDGE_COLOR } from './desk-colors'

const DESK_SIZE: [number, number, number] = [1.4, 0.6, 0.8]

export function CoordinatorDesk() {
  return (
    <group position={[0, 0.3, 0]}>
      <mesh>
        <boxGeometry args={DESK_SIZE} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.55} />
        <Edges color={COORDINATOR_EDGE_COLOR} lineWidth={2} />
      </mesh>
      <mesh position={[0, 0.5, -0.15]}>
        <boxGeometry args={[0.55, 0.35, 0.05]} />
        <meshBasicMaterial color={COORDINATOR_EDGE_COLOR} transparent opacity={0.12} />
        <Edges color={COORDINATOR_EDGE_COLOR} lineWidth={1.5} />
      </mesh>
      <Html position={[0, 1, 0]} center distanceFactor={10} occlude={false}>
        <div className="office-3d-label office-3d-label-coordinator">trưởng phòng</div>
      </Html>
    </group>
  )
}
