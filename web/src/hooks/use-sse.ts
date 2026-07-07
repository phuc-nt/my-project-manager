// Minimal SSE subscription for a run's live node-progress stream. Consumes the EXISTING
// firewall-projected /api/runs/{run_id}/stream (node events + one terminal). No new contract.
import { useEffect, useState } from 'react'

export interface SseEvent {
  event: string // "node" | "terminal"
  node?: string
  status?: string
  data?: Record<string, unknown>
}

export function useSse(runId: string | null): {
  events: SseEvent[]
  done: boolean
  errored: boolean
} {
  const [events, setEvents] = useState<SseEvent[]>([])
  const [done, setDone] = useState(false)
  // v10 M25 (red-team F5): distinguish "stream finished normally" (a terminal frame arrived)
  // from "the connection dropped" (network loss / mid-stream 401). The old code set done=true on
  // BOTH, so a dropped stream rendered as "(done)" — a silent lie. Callers now show an error.
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    if (!runId) return
    setEvents([])
    setDone(false)
    setErrored(false)
    let terminated = false // saw a terminal frame → a following onerror is just the close, ignore
    const es = new EventSource(`/api/runs/${runId}/stream`)
    es.onmessage = (m) => {
      try {
        const parsed = JSON.parse(m.data) as SseEvent
        setEvents((prev) => [...prev, parsed])
        if (parsed.event === 'terminal') {
          terminated = true
          setDone(true)
          es.close()
        }
      } catch {
        /* ignore a malformed frame */
      }
    }
    es.onerror = () => {
      // A normal end closes the stream and fires onerror AFTER the terminal frame — that's not a
      // failure. Only flag an error when no terminal frame was seen.
      if (!terminated) setErrored(true)
      setDone(true)
      es.close()
    }
    return () => es.close()
  }, [runId])

  return { events, done, errored }
}
