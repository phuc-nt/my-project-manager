// Minimal SSE subscription for a run's live node-progress stream. Consumes the EXISTING
// firewall-projected /api/runs/{run_id}/stream (node events + one terminal). No new contract.
import { useEffect, useState } from 'react'

export interface SseEvent {
  event: string // "node" | "terminal"
  node?: string
  status?: string
  data?: Record<string, unknown>
}

export function useSse(runId: string | null): { events: SseEvent[]; done: boolean } {
  const [events, setEvents] = useState<SseEvent[]>([])
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!runId) return
    setEvents([])
    setDone(false)
    const es = new EventSource(`/api/runs/${runId}/stream`)
    es.onmessage = (m) => {
      try {
        const parsed = JSON.parse(m.data) as SseEvent
        setEvents((prev) => [...prev, parsed])
        if (parsed.event === 'terminal') {
          setDone(true)
          es.close()
        }
      } catch {
        /* ignore a malformed frame */
      }
    }
    es.onerror = () => {
      setDone(true)
      es.close()
    }
    return () => es.close()
  }, [runId])

  return { events, done }
}
