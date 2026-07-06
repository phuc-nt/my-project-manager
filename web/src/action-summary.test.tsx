// v9 P1 — the trust surface. Each case asserts the summary reads the ACTUAL field-shape
// (mcp_tool → args camelCase, email_send → top-level, gh_cli → argv) and that the external
// dimension is surfaced, never hidden. An unrecognised action must fall back to a readable
// line, not a blank.
import { expect, test } from 'vitest'
import { summarizeAction } from './action-summary'

test('jira createIssue reads args.projectKey + args.summary', () => {
  const r = summarizeAction({
    type: 'mcp_tool',
    server: 'jira',
    tool: 'createIssue',
    args: { projectKey: 'SCRUM', summary: 'Fix login' },
  })
  expect(r.text).toBe("Tạo ticket Jira 'Fix login' trong dự án SCRUM")
  expect(r.external).toBe(false)
})

test('jira closeIssue/transitionIssue/assignIssue read args.issueKey (Lớp B universe)', () => {
  const base = { type: 'mcp_tool', server: 'jira', args: { issueKey: 'SCRUM-23' } }
  expect(summarizeAction({ ...base, tool: 'closeIssue' }).text).toMatch(/Đóng issue Jira SCRUM-23/)
  expect(summarizeAction({ ...base, tool: 'transitionIssue' }).text).toMatch(/Chuyển trạng thái/)
  expect(summarizeAction({ ...base, tool: 'assignIssue' }).text).toMatch(/Giao issue/)
})

test('confluence createPage reads args.title', () => {
  const r = summarizeAction({
    type: 'mcp_tool',
    server: 'confluence',
    tool: 'createPage',
    args: { title: 'Q3 OKRs' },
  })
  expect(r.text).toBe("Tạo trang Confluence 'Q3 OKRs'")
})

test('slack post_message internal vs external (flagged from reason)', () => {
  const action = {
    type: 'mcp_tool',
    server: 'slack',
    tool: 'post_message',
    args: { channel: 'C123' },
  }
  const internal = summarizeAction(action, 'weekly report to team')
  expect(internal.external).toBe(false)
  expect(internal.text).toMatch(/Đăng tin vào kênh Slack C123/)

  const external = summarizeAction(action, 'external post to stakeholder channel')
  expect(external.external).toBe(true)
  expect(external.text).toMatch(/RA NGOÀI/)
})

test('email_send reads top-level to/subject and is always external', () => {
  const r = summarizeAction({ type: 'email_send', to: 'ceo@corp.com', subject: 'Weekly' })
  expect(r.text).toBe('Gửi email tới ceo@corp.com: Weekly')
  expect(r.external).toBe(true)
})

test('gh_cli parses argv for pr merge/close/ready', () => {
  expect(summarizeAction({ type: 'gh_cli', argv: ['pr', 'merge', '42'] }).text).toMatch(/Gộp .*PR #42/)
  expect(summarizeAction({ type: 'gh_cli', argv: ['pr', 'close', '7'] }).text).toMatch(/Đóng PR #7/)
  expect(summarizeAction({ type: 'gh_cli', argv: ['pr', 'ready', '9'] }).text).toMatch(/PR #9/)
})

test('unknown mcp tool → readable "server · tool" fallback, never blank', () => {
  const r = summarizeAction({ type: 'mcp_tool', server: 'jira', tool: 'weirdOp', args: {} })
  expect(r.text).toBe('Hành động jira · weirdOp')
  expect(r.text.length).toBeGreaterThan(0)
})

test('fully unknown action → best-effort readable line, never blank', () => {
  expect(summarizeAction({ type: 'brand_new_thing' }).text.length).toBeGreaterThan(0)
  expect(summarizeAction({}).text.length).toBeGreaterThan(0)
})
