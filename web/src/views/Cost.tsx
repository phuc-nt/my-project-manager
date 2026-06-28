// Cost view: monthly cost-vs-budget chart (last 12 months) + current-month spend/ratio.
// Monthly-only (decided — no per-run trend). Read-only; consumes /api/cost via the client.
import { CostChart } from '../components/charts/CostChart'
import { api } from '../api/client'
import { useAgentData } from '../hooks/use-agent-data'
import type { CostPayload } from '../types'

export function Cost() {
  const { data, loading, error } = useAgentData<CostPayload>(api.getCost)
  if (loading) return <p>Loading cost…</p>
  if (error) return <p className="error">Error: {error}</p>
  if (!data) return null

  const ratio = data.cap > 0 ? data.spent_this_month / data.cap : 0
  return (
    <section>
      <h2>Cost vs budget</h2>
      <p>
        This month: <strong>${data.spent_this_month.toFixed(4)}</strong> of $
        {data.cap.toFixed(2)} cap ({(ratio * 100).toFixed(0)}%
        {ratio >= data.warn_ratio ? ' ⚠️' : ''})
      </p>
      {data.series.length === 0 ? (
        <p>No cost history yet.</p>
      ) : (
        <CostChart series={data.series} cap={data.cap} />
      )}
    </section>
  )
}
