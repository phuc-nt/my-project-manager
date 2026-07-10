// The unified office screen (v15, Decision Q4): 3D living office + live text activity
// feed + task composer in ONE view, all fed by ONE SSE stream (`useOfficeStream` is
// called exactly once, here — the canvas and the feed render the same messages array,
// so the two surfaces can never disagree; never add a second EventSource below).
//
// Reduced-motion/mobile (use3dFallback) swaps the Canvas for the 2D status table —
// feed + composer stay, so the screen is fully usable without WebGL.
import { useMemo } from 'react'
import { useOfficeStream } from '../../hooks/use-office-stream'
import { agentIdsInOrder, deriveAgentDesks } from '../office-3d/agent-office-state'
import { AgentStatusTable } from '../office-3d/agent-status-table'
import { OfficeCanvas } from '../office-3d/office-canvas'
import { use3dFallback } from '../office-3d/use-3d-fallback'
import { ActivityFeed } from './activity-feed'
import { AssignComposer } from './assign-composer'

const OFFICE_ROOM_ID = 'office'

export function OfficeUnified() {
  const { messages, connected, errored } = useOfficeStream(OFFICE_ROOM_ID)
  const useFallback = use3dFallback()

  const agentIds = useMemo(() => agentIdsInOrder(messages), [messages])
  const desks = useMemo(() => deriveAgentDesks(messages), [messages])

  return (
    <section className="office-unified">
      <h2>Văn phòng</h2>
      <p className="ops-chat-hint">
        Toàn cảnh đội đang làm việc + hoạt động trực tiếp. Giao việc ngay bên dưới:
        gõ <code>@tên-nhân-sự</code> để chỉ định người chịu trách nhiệm chính (PIC),
        hoặc <code>@all</code>/bỏ trống để đội tự chọn.
      </p>
      <div className="office-unified-layout">
        <div className="office-unified-main">
          {useFallback ? (
            <AgentStatusTable agentIds={agentIds} desks={desks} />
          ) : (
            <OfficeCanvas agentIds={agentIds} desks={desks} />
          )}
        </div>
        <ActivityFeed messages={messages} connected={connected} errored={errored} />
      </div>
      <AssignComposer />
      {/* Empty-state hint lives in AgentStatusTable (fallback) / the canvas renders an
          empty floor — no duplicate hint here. */}
    </section>
  )
}

export default OfficeUnified
