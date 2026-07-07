// Cost view: monthly cost-vs-budget chart (last 12 months) + current-month spend/ratio.
// Monthly-only (decided — no per-run trend). Read-only; consumes /api/cost via the client.
import { CostChart } from '../components/charts/CostChart'
import { api } from '../api/client'
import { useAgentData } from '../hooks/use-agent-data'
import { useTheme } from '../theme-context'
import type { CostPayload } from '../types'

export function Cost() {
  const { data, loading, error } = useAgentData<CostPayload>(api.getCost)
  // Remount the chart when the RESOLVED theme flips so it re-reads token colors (v10 M25).
  const { resolved } = useTheme()
  if (loading) return <p>Đang tải…</p>
  if (error) return <p className="error">Lỗi: {error}</p>
  if (!data) return null

  const ratio = data.cap > 0 ? data.spent_this_month / data.cap : 0
  return (
    <section>
      <h2>Chi phí so với ngân sách</h2>
      <p>
        Tháng này: <strong>${data.spent_this_month.toFixed(4)}</strong> trên hạn mức $
        {data.cap.toFixed(2)} ({(ratio * 100).toFixed(0)}%
        {ratio >= data.warn_ratio ? ' ⚠️' : ''})
      </p>
      {data.series.length === 0 ? (
        <p>Chưa có lịch sử chi phí.</p>
      ) : (
        <CostChart key={resolved} series={data.series} cap={data.cap} />
      )}
    </section>
  )
}
