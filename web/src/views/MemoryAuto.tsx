// Memory & Automation view: remembered facts (internal-only) + pending proposals. Both
// READ-only here — the approve/reject actions are the S4 ops surface. Two fetches via the
// shared hook (memory is internal-only by the API's audience gate; default audience=internal).
import { FactsList } from '../components/FactsList'
import { PendingProposals } from '../components/PendingProposals'
import { api } from '../api/client'
import { useAgentData } from '../hooks/use-agent-data'
import type { AutomationPayload, MemoryPayload } from '../types'

export function MemoryAutomation() {
  const mem = useAgentData<MemoryPayload>(api.getMemory)
  const auto = useAgentData<AutomationPayload>(api.getAutomation)

  return (
    <section>
      <h2>Memory &amp; automation</h2>

      <h3>Remembered facts</h3>
      {mem.loading ? (
        <p>Loading memory…</p>
      ) : mem.error ? (
        <p className="error">Error: {mem.error}</p>
      ) : (
        <FactsList facts={mem.data?.facts ?? []} />
      )}

      <h3>Pending proposals</h3>
      {auto.loading ? (
        <p>Loading proposals…</p>
      ) : auto.error ? (
        <p className="error">Error: {auto.error}</p>
      ) : (
        <PendingProposals pending={auto.data?.pending ?? []} />
      )}
    </section>
  )
}
