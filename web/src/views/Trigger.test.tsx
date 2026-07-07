// v10 M25 (red-team F4): the Trigger form offers the SELECTED agent's own report kinds
// (from agent.report_kinds), not a hardcoded PM four. Mocked api; no network/SSE.
import { render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { AgentProvider } from '../agent-context'
import { api } from '../api/client'
import { AppProviders } from '../test-utils'
import { Trigger } from './Trigger'

beforeEach(() => vi.restoreAllMocks())

function wrap() {
  return render(
    <AppProviders>
      <AgentProvider>
        <Trigger />
      </AgentProvider>
    </AppProviders>,
  )
}

test('offers the selected agent kinds (hr pack), labelled in Vietnamese', async () => {
  // hr agent selected first (agent-context picks list[0]); its pack serves headcount-style kinds.
  vi.spyOn(api, 'getAgents').mockResolvedValue([
    { id: 'hr', name: 'HR', enabled: true, last_run: null, report_kinds: ['daily', 'okr'] },
  ])
  wrap()
  await waitFor(() => expect(screen.getByText('Chạy báo cáo thủ công')).toBeInTheDocument())
  const select = screen.getAllByRole('combobox')[0]
  // both the agent's kinds appear as options, using the VN KIND_LABEL
  expect(within(select).getByRole('option', { name: 'Báo cáo hằng ngày' })).toBeInTheDocument()
  expect(within(select).getByRole('option', { name: 'Báo cáo OKR' })).toBeInTheDocument()
  // and NOT a kind the agent's pack doesn't serve
  expect(within(select).queryByRole('option', { name: 'Báo cáo tuần' })).not.toBeInTheDocument()
})

test('falls back to PM kinds when report_kinds is absent (older payload)', async () => {
  vi.spyOn(api, 'getAgents').mockResolvedValue([
    { id: 'legacy', name: 'Legacy', enabled: true, last_run: null },
  ])
  wrap()
  await waitFor(() => expect(screen.getByText('Chạy báo cáo thủ công')).toBeInTheDocument())
  const select = screen.getAllByRole('combobox')[0]
  expect(within(select).getByRole('option', { name: 'Báo cáo tuần' })).toBeInTheDocument()
})
