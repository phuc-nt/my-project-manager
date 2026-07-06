// Guardrail/Audit view: verdict-breakdown doughnut + recent events table. Shows the
// Action Gateway at work (allow/deny/pending/…). Read-only; consumes /api/audit.
import { AuditTable } from '../components/AuditTable'
import { VerdictChart } from '../components/charts/VerdictChart'
import { api } from '../api/client'
import { useAgentData } from '../hooks/use-agent-data'
import type { AuditPayload } from '../types'

export function Guardrail() {
  const { data, loading, error } = useAgentData<AuditPayload>(api.getAudit)
  if (loading) return <p>Đang tải…</p>
  if (error) return <p className="error">Lỗi: {error}</p>
  if (!data) return null

  const total = Object.values(data.counts).reduce((a, b) => a + b, 0)
  return (
    <section>
      <h2>Guardrail &amp; audit</h2>
      <p>{total} recorded gateway decisions.</p>
      {total > 0 && (
        <div className="chart-box">
          <VerdictChart counts={data.counts} />
        </div>
      )}
      <h3>Recent events</h3>
      <AuditTable rows={data.recent} />
    </section>
  )
}
