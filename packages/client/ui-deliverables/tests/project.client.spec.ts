/** Source extraction uses admitted messages and successful, structured web results only. */
import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { draftSources, isProjectOverview, parseProjectAddress, projectAddress, projectSources, sourceUrl } from '../src/project.ts'

describe('project sources', () => {
  it('keeps original draft coordinates, quoted paths, folders, and safe external URLs', () => {
    const text = 'Read @"src/a b.ts" and @docs/ with https://example.com/page.'
    const sources = draftSources(text)
    expect(sources.map(source => [source.kind, source.target])).toEqual([
      ['file', 'src/a b.ts'], ['file', 'docs/'], ['url', 'https://example.com/page'],
    ])
    for (const source of sources) expect(text.slice(source.start, source.end)).toContain(source.target)
    for (const value of ['javascript:alert(1)', 'file:///etc/passwd', 'https://user:secret@example.com', 'not a url']) {
      expect(sourceUrl(value)).toBeUndefined()
    }
  })

  it('distinguishes supplied links from actual search results and ignores failed or unrelated tool metadata', () => {
    const session = Session.create(SessionId('project-sources'))
    const call = ToolCallId('web-call')
    const other = ToolCallId('other-call')
    const user = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '@"src/app.ts" https://example.com/' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const assistant = session.append('assistant/message', {
      turn: 1, step: 1, stream: [], message: createAssistantMessage({
        content: [{ type: 'tool-call', id: call, name: 'web_search', arguments: '{}' }],
        source: { provider: 'test', model: 'test' },
      }),
    }, { surfaceOp: 'append' })
    const result = session.append('tool/result', {
      turn: 1, step: 1, message: createToolResultMessage({ callId: call, content: [], isError: false }),
      meta: { sources: [{ url: 'https://example.com/', title: 'Example' }, { url: 'javascript:alert(1)' }] },
    }, { surfaceOp: 'append' })
    const failed = session.append('tool/result', {
      turn: 1, step: 1, message: createToolResultMessage({ callId: call, content: [], isError: true }),
      meta: { sources: [{ url: 'https://failed.example/' }] },
    }, { surfaceOp: 'append' })
    const unrelated = session.append('tool/result', {
      turn: 1, step: 1, message: createToolResultMessage({ callId: other, content: [], isError: false }),
      meta: { sources: [{ url: 'https://unrelated.example/' }] },
    }, { surfaceOp: 'append' })
    expect(projectSources([user, assistant, result, failed, unrelated], () => undefined)).toEqual([
      { kind: 'file', target: 'src/app.ts', label: 'app.ts' },
      { kind: 'url', target: 'https://example.com/', label: 'https://example.com/' },
      { kind: 'web', target: 'https://example.com/', label: 'Example' },
    ])
  })

  it('refuses malformed resource addresses and response counts', () => {
    const id = SessionId('session with spaces')
    expect(parseProjectAddress(projectAddress(id, '../a b.ts'))).toEqual({ sessionId: id, path: '../a b.ts' })
    for (const value of ['bad', 'https://project-overview/session/id', 'dsh-resource://project-overview/session/%ZZ', 'dsh-resource://project-diff/session/id']) {
      expect(parseProjectAddress(value)).toBeUndefined()
    }
    const overview = { cwd: '/repo', sources: [], webSearch: true, project: {
      kind: 'repository', root: '/repo', branch: 'main', base: 'abc', total: 0, added: 0, deleted: 0, files: [],
    } }
    expect(isProjectOverview(overview)).toBe(true)
    expect(isProjectOverview({ ...overview, project: { ...overview.project, added: -1 } })).toBe(false)
    expect(isProjectOverview({ ...overview, sources: [{ kind: 'web' }] })).toBe(false)
    expect(isProjectOverview({})).toBe(false)
  })
})
