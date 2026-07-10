// Room-scoped SSE subscription for the office group-chat timeline (v12 M29). Mirrors
// use-sse.ts's shape (EventSource, done/errored distinction) but is ROOM-scoped and
// NEVER "done" — a room's stream has no terminal frame (store-tail keeps polling
// forever), so this hook's only terminal state is a dropped connection.
//
// Resume: the browser's EventSource sends `Last-Event-ID` automatically on reconnect
// (using the last `id` field it saw) — no manual bookkeeping needed for the common
// case. This hook ALSO tracks the last seq itself so a caller-triggered re-mount (a
// room switch) can pass `?since_seq=` explicitly on first connect if ever needed; today
// every mount starts fresh (`since_seq=0`, i.e. full room replay — rooms are small).
import { useEffect, useRef, useState } from 'react'
import type { OfficeMessage } from '../types'

export function useOfficeStream(roomId: string | null): {
  messages: OfficeMessage[]
  connected: boolean
  errored: boolean
} {
  const [messages, setMessages] = useState<OfficeMessage[]>([])
  const [connected, setConnected] = useState(false)
  const [errored, setErrored] = useState(false)
  const seenSeqs = useRef<Set<number>>(new Set())

  useEffect(() => {
    if (!roomId) return
    setMessages([])
    setConnected(false)
    setErrored(false)
    seenSeqs.current = new Set()

    const es = new EventSource(`/api/office/rooms/${encodeURIComponent(roomId)}/stream`)
    es.onopen = () => setConnected(true)
    es.onmessage = (m) => {
      try {
        const parsed = JSON.parse(m.data) as OfficeMessage
        // A reconnect can briefly re-deliver the boundary row — dedup by seq so the
        // timeline never shows a duplicate entry.
        if (seenSeqs.current.has(parsed.seq)) return
        seenSeqs.current.add(parsed.seq)
        setMessages((prev) => [...prev, parsed])
      } catch {
        /* ignore a malformed frame */
      }
    }
    es.onerror = () => {
      setConnected(false)
      setErrored(true)
    }
    return () => {
      es.close()
      setConnected(false)
    }
  }, [roomId])

  return { messages, connected, errored }
}
