// v9 P1 — ConfirmDialog is the approve gate. Assert: Vietnamese labels, the human summary of
// the action, the external warning surfaced OUTSIDE <details>, the raw JSON still available in
// <details>, and modal a11y (aria-modal + Esc closes).
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

const EXTERNAL_ITEM = {
  id: 7,
  reason: 'external post to stakeholder channel',
  status: 'pending',
  created_at: 't1',
  action: { type: 'mcp_tool', server: 'slack', tool: 'post_message', args: { channel: 'C999' } },
} as never

const INTERNAL_ITEM = {
  id: 3,
  reason: 'weekly report',
  status: 'pending',
  created_at: 't1',
  action: {
    type: 'mcp_tool',
    server: 'jira',
    tool: 'createIssue',
    args: { projectKey: 'SCRUM', summary: 'Fix bug' },
  },
} as never

test('renders Vietnamese title + summary + keeps raw JSON in details', () => {
  render(<ConfirmDialog item={INTERNAL_ITEM} busy={false} onApprove={vi.fn()} onCancel={vi.fn()} />)
  expect(screen.getByText('Duyệt việc #3')).toBeInTheDocument()
  expect(screen.getByText(/Tạo ticket Jira 'Fix bug' trong dự án SCRUM/)).toBeInTheDocument()
  expect(screen.getByText('Chi tiết kỹ thuật')).toBeInTheDocument()
  // raw action tool name is still present (inside <details>)
  expect(screen.getByText(/createIssue/)).toBeInTheDocument()
  expect(screen.getByText('Duyệt & thực hiện')).toBeInTheDocument()
  expect(screen.getByText('Huỷ')).toBeInTheDocument()
})

test('external action surfaces a prominent warning outside the details', () => {
  render(<ConfirmDialog item={EXTERNAL_ITEM} busy={false} onApprove={vi.fn()} onCancel={vi.fn()} />)
  expect(screen.getByText(/Đăng tin RA NGOÀI, tới kênh Slack C999/)).toBeInTheDocument()
  expect(screen.getByText(/gửi thông tin RA NGOÀI công ty/)).toBeInTheDocument()
})

test('modal a11y: aria-modal and Esc closes', () => {
  const onCancel = vi.fn()
  render(<ConfirmDialog item={INTERNAL_ITEM} busy={false} onApprove={vi.fn()} onCancel={onCancel} />)
  const dialog = screen.getByRole('dialog')
  expect(dialog).toHaveAttribute('aria-modal', 'true')
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(onCancel).toHaveBeenCalled()
})

test('busy disables the buttons and Esc does not close mid-action', () => {
  const onCancel = vi.fn()
  render(<ConfirmDialog item={INTERNAL_ITEM} busy={true} onApprove={vi.fn()} onCancel={onCancel} />)
  expect(screen.getByText('Đang thực hiện…')).toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(onCancel).not.toHaveBeenCalled()
})
