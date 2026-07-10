// Static floor + wall wireframe grid — the office "room" shell. Pure geometry, no state; split
// out from office-scene.tsx to keep that file focused on data wiring. Colors tuned for the
// light canvas background (see desk-colors.ts).
import { Edges } from '@react-three/drei'

const FLOOR_SIZE: [number, number, number] = [16, 0.05, 12]
const WALL_COLOR = '#bdbdbd'

export function OfficeFloor() {
  return (
    <group>
      <mesh position={[0, -0.05, 0]}>
        <boxGeometry args={FLOOR_SIZE} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0} />
        <Edges color={WALL_COLOR} lineWidth={1} />
      </mesh>
      <gridHelper args={[16, 16, '#d6d6d6', '#e7e7e7']} position={[0, 0, 0]} />
    </group>
  )
}
