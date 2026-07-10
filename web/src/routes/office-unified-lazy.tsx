// Code-split entry point for the unified office screen (v15). react-three-fiber/drei/
// three are heavy and only needed here, so the whole view (canvas included) is pulled
// in via React.lazy — Vite emits a separate chunk that never loads for anyone who
// doesn't visit /office.
import { Suspense, lazy } from 'react'

const OfficeUnified = lazy(() => import('../views/office-unified/office-unified'))

export function OfficeUnifiedLazy() {
  return (
    <Suspense fallback={<p style={{ padding: '2rem' }}>Đang tải văn phòng…</p>}>
      <OfficeUnified />
    </Suspense>
  )
}
