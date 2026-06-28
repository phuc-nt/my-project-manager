// Timeline view: chronological run history (newest-first) from /api/runs. Read-only.
// Live SSE node-progress overlay is deferred (plan stretch) — history is the must-have;
// the live trigger+stream surface lands with the S4 ops view.
import { RunList } from '../components/RunList'
import { api } from '../api/client'
import { useAgentData } from '../hooks/use-agent-data'
import type { RunsPayload } from '../types'

export function Timeline() {
  const { data, loading, error } = useAgentData<RunsPayload>(api.getRuns)
  if (loading) return <p>Loading runs…</p>
  if (error) return <p className="error">Error: {error}</p>
  if (!data) return null
  return (
    <section>
      <h2>Run timeline</h2>
      <RunList runs={data.runs} />
    </section>
  )
}
