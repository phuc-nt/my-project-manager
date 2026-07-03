// v6 M14b Chat view tests: renders the ops dialogue, sends a message to /api/ops/chat and
// shows the agent reply; disables the box when no admin ops agent is available. Mocked api,
// no network (npm test).
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { api } from '../api/client'
import { Chat } from './Chat'

beforeEach(() => {
  vi.restoreAllMocks()
})

test('sends a message and renders the agent reply', async () => {
  vi.spyOn(api, 'opsChatAvailable').mockResolvedValue({ available: true, agent_id: 'admin' })
  const opsChat = vi
    .spyOn(api, 'opsChat')
    .mockResolvedValue({ reply: 'Đội hiện có 3 agent', agent_id: 'admin' })
  render(<Chat />)

  const input = await screen.findByPlaceholderText('Nhắn cho trợ lý…')
  fireEvent.change(input, { target: { value: 'đội mình sao rồi' } })
  fireEvent.click(screen.getByText('Gửi'))

  await waitFor(() => expect(screen.getByText('Đội hiện có 3 agent')).toBeInTheDocument())
  expect(opsChat).toHaveBeenCalledWith('đội mình sao rồi')
  // the CEO's own message is echoed in the log
  expect(screen.getByText('đội mình sao rồi')).toBeInTheDocument()
})

test('shows the unavailable reason when no admin ops agent exists', async () => {
  vi.spyOn(api, 'opsChatAvailable').mockResolvedValue({
    available: false,
    reason: 'Chưa có agent quản trị',
  })
  render(<Chat />)
  await waitFor(() => expect(screen.getByText(/Chưa có agent quản trị/)).toBeInTheDocument())
  expect(screen.queryByPlaceholderText('Nhắn cho trợ lý…')).not.toBeInTheDocument()
})

test('does not send an empty message', async () => {
  vi.spyOn(api, 'opsChatAvailable').mockResolvedValue({ available: true, agent_id: 'admin' })
  const opsChat = vi.spyOn(api, 'opsChat').mockResolvedValue({ reply: 'x', agent_id: 'admin' })
  render(<Chat />)
  await screen.findByPlaceholderText('Nhắn cho trợ lý…')
  // button disabled with empty draft → clicking does nothing
  fireEvent.click(screen.getByText('Gửi'))
  expect(opsChat).not.toHaveBeenCalled()
})
