// Trigger ops view: a form (kind/audience/dry_run) that POSTs the EXISTING /trigger endpoint,
// then streams the run's live node-progress via the EXISTING SSE stream. The backend validates
// audience strictly (a typo'd external → 422); React mirrors the valid set but the server is
// the authority. No backend change — this just drives the existing gateway-routed run.
import { useCallback, useState } from 'react'
import { useAgent } from '../agent-context'
import { api } from '../api/client'
import { useSse } from '../hooks/use-sse'

const KINDS = ['daily', 'weekly', 'okr', 'resource']
const AUDIENCES = ['internal', 'external']

export function Trigger() {
  const { selected } = useAgent()
  const [kind, setKind] = useState('daily')
  const [audience, setAudience] = useState('internal')
  const [dryRun, setDryRun] = useState(true)
  const [runId, setRunId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { events, done } = useSse(runId)

  const start = useCallback(async () => {
    if (!selected) return
    setBusy(true)
    setError(null)
    setRunId(null)
    try {
      const res = await api.triggerRun(selected, { kind, audience, dry_run: dryRun })
      setRunId(res.run_id)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'trigger failed')
    } finally {
      setBusy(false)
    }
  }, [selected, kind, audience, dryRun])

  return (
    <section>
      <h2>Trigger a run</h2>
      <div className="trigger-form">
        <label>
          Kind:{' '}
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>{' '}
        <label>
          Audience:{' '}
          <select value={audience} onChange={(e) => setAudience(e.target.value)}>
            {AUDIENCES.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>{' '}
        <label>
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />{' '}
          dry-run
        </label>{' '}
        <button type="button" disabled={busy || !selected} onClick={start}>
          {busy ? 'Starting…' : 'Run'}
        </button>
      </div>
      {error && <p className="error">Error: {error}</p>}
      {runId && (
        <div className="run-stream">
          <h3>
            Run {runId} {done ? '(done)' : '(streaming…)'}
          </h3>
          <ul>
            {events.map((ev, i) => (
              <li key={i}>
                {ev.event === 'node'
                  ? `${ev.node}: ${JSON.stringify(ev.data)}`
                  : `terminal · ${ev.status} ${JSON.stringify(ev.data)}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
