// S3 view tests: each view renders from MOCKED api data (no network). Local-only (npm test).
// Charts are stubbed so jsdom doesn't need a canvas; we assert the data reaches the view.
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { AgentProvider } from '../agent-context'
import { api } from '../api/client'
import { AppProviders } from '../test-utils'
import { Cost } from './Cost'
import { Guardrail } from './Guardrail'
import { MemoryAutomation } from './MemoryAuto'
import { Timeline } from './Timeline'

// Stub the chart wrappers — Chart.js needs a real canvas; we only care the data arrives.
vi.mock('../components/charts/CostChart', () => ({
  CostChart: ({ series }: { series: unknown[] }) => (
    <div data-testid="cost-chart">{series.length} months</div>
  ),
}))
vi.mock('../components/charts/VerdictChart', () => ({
  VerdictChart: ({ counts }: { counts: Record<string, number> }) => (
    <div data-testid="verdict-chart">{Object.keys(counts).length} verdicts</div>
  ),
}))

beforeEach(() => {
  vi.restoreAllMocks()
  // every view needs a selected agent — stub the agent list.
  vi.spyOn(api, 'getAgents').mockResolvedValue([
    { id: 'acme', name: 'Acme', enabled: true, last_run: null },
  ])
})

function wrap(ui: React.ReactElement) {
  return render(
    <AppProviders>
      <AgentProvider>{ui}</AgentProvider>
    </AppProviders>,
  )
}

test('Cost view renders the monthly series + ratio', async () => {
  vi.spyOn(api, 'getCost').mockResolvedValue({
    agent_id: 'acme',
    series: [
      { month: '2026-05', total_usd: 3.5 },
      { month: '2026-06', total_usd: 1.2 },
    ],
    cap: 50,
    warn_ratio: 0.8,
    spent_this_month: 1.2,
  })
  wrap(<Cost />)
  await waitFor(() => expect(screen.getByTestId('cost-chart')).toHaveTextContent('2 months'))
  expect(screen.getByText(/trên hạn mức \$50.00/)).toBeInTheDocument()
})

test('Guardrail view renders verdict counts + recent rows', async () => {
  vi.spyOn(api, 'getAudit').mockResolvedValue({
    agent_id: 'acme',
    counts: { allow: 3, deny: 1 },
    recent: [{ timestamp: 't1', action_type: 'mcp_tool', tool: 'slack:post', verdict: 'allow' }],
  })
  wrap(<Guardrail />)
  await waitFor(() => expect(screen.getByTestId('verdict-chart')).toHaveTextContent('2 verdicts'))
  expect(screen.getByText('slack:post')).toBeInTheDocument()
})

test('Timeline view lists run history', async () => {
  vi.spyOn(api, 'getRuns').mockResolvedValue({
    agent_id: 'acme',
    runs: [{ ts: 't1', kind: 'daily', audience: 'internal', status: 'delivered', delivered: true }],
  })
  wrap(<Timeline />)
  await waitFor(() => expect(screen.getByText('Báo cáo hằng ngày')).toBeInTheDocument())
  expect(screen.getByText('đã gửi')).toBeInTheDocument()
})

test('Memory view shows internal-only notice when no facts', async () => {
  vi.spyOn(api, 'getMemory').mockResolvedValue({ agent_id: 'acme', facts: [], internal_only: true })
  vi.spyOn(api, 'getAutomation').mockResolvedValue({ agent_id: 'acme', pending: [] })
  wrap(<MemoryAutomation />)
  await waitFor(() => expect(screen.getByText(/Chưa ghi nhớ điều gì/)).toBeInTheDocument())
  expect(screen.getByText(/Không có đề xuất chờ duyệt/)).toBeInTheDocument()
})

test('Memory view renders a seeded fact + proposal', async () => {
  vi.spyOn(api, 'getMemory').mockResolvedValue({
    agent_id: 'acme',
    facts: [{ fact: 'SCRUM-15 overdue', ts: 't1', key: 'k1' }],
    internal_only: true,
  })
  vi.spyOn(api, 'getAutomation').mockResolvedValue({
    agent_id: 'acme',
    pending: [
      { id: 1, reason: 'external post', status: 'pending', created_at: 't1', action_summary: 'mcp_tool:slack:post_message' },
    ],
  })
  wrap(<MemoryAutomation />)
  await waitFor(() => expect(screen.getByText('SCRUM-15 overdue')).toBeInTheDocument())
  expect(screen.getByText('mcp_tool:slack:post_message')).toBeInTheDocument()
})
