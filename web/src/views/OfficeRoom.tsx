// Office group-chat room (v12 M29): the team's shared timeline — CEO briefs, task
// assignments, step progress, handoffs, and milestones — rendered as a chat-like log,
// matching Chat.tsx's ops-chat-* styling conventions. Room picker on the left (via
// GET /api/office/rooms), live timeline via SSE store-tail (use-office-stream.ts).
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { api } from '../api/client'
import { useOfficeStream } from '../hooks/use-office-stream'
import type { OfficeEventKind, OfficeMessage } from '../types'

const KIND_LABEL: Record<OfficeEventKind, string> = {
  ceo: 'CEO giao việc',
  assignment: 'Phân công',
  step_status: 'Tiến độ bước',
  handoff: 'Bàn giao',
  milestone: 'Cột mốc',
  consult: 'Tham vấn',
  review: 'Soát chéo',
}

const OFFICE_ROOM_ID = 'office'

//: Closed-set phase tag -> short Vietnamese label. Matches `team_task_graph.py`'s
//: PHASE_WORK/PHASE_SELF_CHECK/PHASE_REWORK constants — an unrecognized tag renders
//: nothing extra rather than the raw code.
const PHASE_LABEL: Record<string, string> = {
  'dang-lam': 'đang làm',
  'tu-soat': 'tự soát',
  'dang-sua': 'đang sửa',
}

function messageLine(m: OfficeMessage): string {
  const b = m.body
  switch (m.kind) {
    case 'ceo':
      return b.text ?? ''
    case 'assignment':
      return `${b.task_title ?? ''} — ${b.summary ?? ''} (${b.step_count ?? 0} bước)`
    case 'step_status': {
      const phaseLabel = b.phase ? PHASE_LABEL[b.phase] : undefined
      const suffix = phaseLabel ? ` (${phaseLabel})` : ''
      return `${b.task_title ?? ''} / ${b.step_title ?? ''}: ${b.status ?? ''}${suffix}`
    }
    case 'handoff':
      return `${b.task_title ?? ''} / ${b.step_title ?? ''}: ${b.message ?? ''}`
    case 'milestone':
      return `${b.task_title ?? ''}: ${b.message ?? ''}`
    case 'consult':
      return `${b.from ?? ''} hỏi ${b.to ?? ''}: ${b.question_summary ?? ''} → ${b.answer_summary ?? ''}`
    case 'review': {
      const verdictLabel = b.verdict === 'passed' ? 'đạt' : `cần sửa (${b.failure_count ?? 0} lỗi)`
      return `${b.task_title ?? ''} / ${b.step_title ?? ''}: ${verdictLabel}`
    }
    default:
      return ''
  }
}

export function OfficeRoom() {
  const [rooms, setRooms] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const activeRoom = searchParams.get('room') ?? OFFICE_ROOM_ID

  const loadRooms = useCallback(() => {
    api
      .getOfficeRooms()
      .then((p) => setRooms(p.rooms))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'tải thất bại'))
  }, [])

  useEffect(() => {
    loadRooms()
  }, [loadRooms])

  const { messages, connected, errored } = useOfficeStream(activeRoom)

  const selectRoom = (roomId: string) => setSearchParams({ room: roomId })

  return (
    <section className="office-room">
      <h2>Văn phòng</h2>
      <p className="ops-chat-hint">
        Dòng thời gian hoạt động của cả đội: giao việc, phân công, tiến độ, bàn giao và các cột
        mốc quan trọng.
      </p>
      {error && <p className="error">Lỗi: {error}</p>}
      <div className="office-room-layout">
        <nav className="office-room-picker" aria-label="Danh sách phòng">
          <button
            type="button"
            className={activeRoom === OFFICE_ROOM_ID ? 'chip chip-active' : 'chip'}
            onClick={() => selectRoom(OFFICE_ROOM_ID)}
          >
            Tổng quan
          </button>
          {rooms
            ?.filter((r) => r !== OFFICE_ROOM_ID)
            .map((r) => (
              <button
                key={r}
                type="button"
                className={activeRoom === r ? 'chip chip-active' : 'chip'}
                onClick={() => selectRoom(r)}
              >
                Việc #{r}
              </button>
            ))}
        </nav>
        <div className="office-room-timeline">
          <p className="office-room-status">
            {errored ? 'Mất kết nối luồng — thử tải lại trang.' : connected ? 'Đang theo dõi trực tiếp' : 'Đang kết nối…'}
          </p>
          {messages.length === 0 && !errored && (
            <p className="ops-chat-empty">Chưa có hoạt động nào trong phòng này.</p>
          )}
          <ul className="office-room-log">
            {messages.map((m) => (
              <li key={m.seq} className={`office-room-entry office-room-${m.kind}`}>
                <span className="office-room-kind">{KIND_LABEL[m.kind] ?? m.kind}</span>
                <span className="office-room-author">{m.author}</span>
                <p className="office-room-text">{messageLine(m)}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
