// v7 M17 Setup wizard tests: walks a group, tests a connection, advances, and finishes.
// Mocked api, no network (npm test).
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { api } from '../api/client'
import { Setup } from './Setup'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(api, 'setupEnv').mockResolvedValue({ ok: true, written: [] })
})

test('renders the first group and can test the connection', async () => {
  const setupTest = vi
    .spyOn(api, 'setupTest')
    .mockResolvedValue({ group: 'openrouter', ok: true, detail: 'OK', hint: '' })
  render(<Setup onDone={vi.fn()} />)
  expect(screen.getByText('OpenRouter (bộ não LLM)')).toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-x' } })
  fireEvent.click(screen.getByText('Kiểm tra kết nối'))
  await waitFor(() => expect(screen.getByText(/Kết nối OK/)).toBeInTheDocument())
  expect(setupTest).toHaveBeenCalledWith('openrouter')
  expect(api.setupEnv).toHaveBeenCalled() // persisted before test
})

test('advances through groups to the password step and finishes', async () => {
  vi.spyOn(api, 'setupFinish').mockResolvedValue({
    ok: true,
    restarting: true,
    message: 'restarting',
  })
  const onDone = vi.fn()
  render(<Setup onDone={onDone} />)

  // click "Tiếp tục" through the 4 groups → password step
  for (let i = 0; i < 4; i++) {
    fireEvent.click(screen.getByText('Tiếp tục'))
    await waitFor(() => {}) // let saveGroup resolve
  }
  await waitFor(() => expect(screen.getByText('Đặt mật khẩu đăng nhập')).toBeInTheDocument())

  fireEvent.change(screen.getByLabelText(/Mật khẩu/), { target: { value: 'ceopass' } })
  fireEvent.click(screen.getByText('Hoàn tất & khởi động'))
  await waitFor(() => expect(screen.getByText(/Đang khởi động lại/)).toBeInTheDocument())
  expect(api.setupFinish).toHaveBeenCalledWith('admin', 'ceopass')
})

test('short password blocks finish', async () => {
  const finish = vi.spyOn(api, 'setupFinish')
  render(<Setup onDone={vi.fn()} />)
  for (let i = 0; i < 4; i++) {
    fireEvent.click(screen.getByText('Tiếp tục'))
    await waitFor(() => {})
  }
  await screen.findByText('Đặt mật khẩu đăng nhập')
  fireEvent.change(screen.getByLabelText(/Mật khẩu/), { target: { value: '12' } })
  // button disabled at <6 chars → finish never called
  expect(screen.getByText('Hoàn tất & khởi động')).toBeDisabled()
  expect(finish).not.toHaveBeenCalled()
})
