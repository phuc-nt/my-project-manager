// Code-split entry point for the 3D office wireframe (v12 M30). react-three-fiber/drei/three
// are heavy and only needed on this one route, so they are pulled in via React.lazy — Vite emits
// them as a separate chunk that never loads for anyone who doesn't visit /office/3d.
import { Suspense, lazy } from 'react'

const OfficeScene = lazy(() => import('../views/office-3d/office-scene'))

export function OfficeSceneLazy() {
  return (
    <Suspense fallback={<p style={{ padding: '2rem' }}>Đang tải sơ đồ 3D…</p>}>
      <OfficeScene />
    </Suspense>
  )
}
