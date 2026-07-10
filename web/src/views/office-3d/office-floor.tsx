// Static floor + wall wireframe grid — the office "room" shell. Pure geometry, no state; split
// out from office-scene.tsx to keep that file focused on data wiring (agent-office-state.md
// modularization: components >200 lines split).
import { Edges } from '@react-three/drei'

const FLOOR_SIZE: [number, number, number] = [16, 0.05, 12]
const WALL_COLOR = '#4a4a4a'

export function OfficeFloor() {
  return (
    <group>
      <mesh position={[0, -0.05, 0]}>
        <boxGeometry args={FLOOR_SIZE} />
        <meshBasicMaterial color="#000000" transparent opacity={0} />
        <Edges color={WALL_COLOR} lineWidth={1} />
      </mesh>
      <gridHelper args={[16, 16, '#3a3a3a', '#2c2c2c']} position={[0, 0, 0]} />
    </group>
  )
}
