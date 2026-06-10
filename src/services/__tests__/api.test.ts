import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  mapBackendNotebook,
  mapBackendSession,
  getMediaUrl,
  API_BASE,
} from '@/services/api'
import * as auth from '@/services/auth'

describe('mapBackendNotebook', () => {
  it('maps backend fields to frontend Notebook', () => {
    const bn = {
      id: 'nb-1',
      user_id: 'u-1',
      title: 'Test Notebook',
      description: 'A description',
      icon: 'Brain',
      color: 'from-blue-500 to-blue-600',
      session_count: 5,
      created_at: '2026-06-01T00:00:00Z',
    }
    const result = mapBackendNotebook(bn)
    expect(result.id).toBe('nb-1')
    expect(result.title).toBe('Test Notebook')
    expect(result.description).toBe('A description')
    expect(result.icon).toBe('Brain')
    expect(result.color).toBe('from-blue-500 to-blue-600')
    expect(result.sessionCount).toBe(5)
    expect(result.updatedAt).toBe('2026-06-01')
  })

  it('falls back to hashed color when color is null', () => {
    const bn = {
      id: 'nb-2',
      user_id: 'u-1',
      title: 'No Color',
      description: null,
      icon: null,
      color: null,
      session_count: 0,
      created_at: '2026-06-01T00:00:00Z',
    }
    const result = mapBackendNotebook(bn)
    expect(result.color).toMatch(/^from-/)
    expect(result.icon).toBe('BookOpen')
  })
})

describe('mapBackendSession', () => {
  it('maps backend session fields', () => {
    const bs = {
      id: 's-1',
      notebook_id: 'nb-1',
      title: 'Session 1',
      summary: 'Summary text',
      keywords: ['a', 'b'],
      status: 'completed',
      created_at: '2026-06-02T00:00:00Z',
    }
    const result = mapBackendSession(bs)
    expect(result.id).toBe('s-1')
    expect(result.notebookId).toBe('nb-1')
    expect(result.title).toBe('Session 1')
    expect(result.summary).toBe('Summary text')
    expect(result.keywords).toEqual(['a', 'b'])
    expect(result.date).toBe('2026-06-02')
    expect(result.duration).toBe('00:00:00')
  })
})

describe('getMediaUrl', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('appends token for relative paths', () => {
    vi.spyOn(auth, 'getToken').mockReturnValue('my-token')
    const url = getMediaUrl('/uploads/image.png')
    expect(url).toContain('/uploads/image.png')
    expect(url).toContain('token=my-token')
  })

  it('does not duplicate base for absolute URLs', () => {
    vi.spyOn(auth, 'getToken').mockReturnValue('my-token')
    const url = getMediaUrl('https://cdn.example.com/img.png')
    expect(url).toBe('https://cdn.example.com/img.png?token=my-token')
  })

  it('works without token', () => {
    vi.spyOn(auth, 'getToken').mockReturnValue(null)
    const url = getMediaUrl('/uploads/image.png')
    expect(url).not.toContain('token=')
  })
})

describe('API_BASE', () => {
  it('is defined', () => {
    expect(API_BASE).toBeDefined()
    expect(typeof API_BASE).toBe('string')
  })
})
