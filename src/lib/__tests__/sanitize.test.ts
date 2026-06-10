import { describe, it, expect } from 'vitest'
import { sanitizeHTML } from '@/lib/sanitize'

describe('sanitizeHTML', () => {
  it('removes script tags', () => {
    const dirty = '<p>hello</p><script>alert("xss")</script>'
    const result = sanitizeHTML(dirty) as unknown as string
    expect(result).not.toContain('<script>')
    expect(result).toContain('<p>hello</p>')
  })

  it('removes event handlers', () => {
    const dirty = '<img src="x" onerror="alert(1)">'
    const result = sanitizeHTML(dirty) as unknown as string
    expect(result).not.toContain('onerror')
  })

  it('allows safe HTML', () => {
    const clean = '<strong>bold</strong> <em>italic</em>'
    const result = sanitizeHTML(clean) as unknown as string
    expect(result).toContain('<strong>bold</strong>')
    expect(result).toContain('<em>italic</em>')
  })

  it('returns empty string for empty input', () => {
    const result = sanitizeHTML('') as unknown as string
    expect(result).toBe('')
  })
})
