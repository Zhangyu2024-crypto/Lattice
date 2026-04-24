import { describe, expect, it } from 'vitest'
import { parseFrontmatter } from './frontmatter'

describe('parseFrontmatter', () => {
  it('returns empty frontmatter when no --- fence', () => {
    const out = parseFrontmatter('just a body, no fence\n')
    expect(out.data).toEqual({})
    expect(out.body).toBe('just a body, no fence\n')
  })

  it('parses scalar keys (string, number, boolean, null)', () => {
    const src =
      '---\n' +
      'name: foo\n' +
      'count: 3\n' +
      'enabled: true\n' +
      'disabled: false\n' +
      'nada:\n' +
      '---\n' +
      'body text\n'
    const out = parseFrontmatter(src)
    expect(out.data).toEqual({
      name: 'foo',
      count: 3,
      enabled: true,
      disabled: false,
      nada: null,
    })
    expect(out.body).toBe('body text\n')
  })

  it('parses quoted strings and bracketed arrays', () => {
    const src =
      '---\n' +
      'argumentHint: "<topic>"\n' +
      'aliases: [r, research, "long name"]\n' +
      '---\n' +
      'body'
    const out = parseFrontmatter(src)
    expect(out.data.argumentHint).toBe('<topic>')
    expect(out.data.aliases).toEqual(['r', 'research', 'long name'])
  })

  it('skips blank lines and # comments', () => {
    const src =
      '---\n' +
      '# this is a comment\n' +
      '\n' +
      'name: x\n' +
      '---\n' +
      'body'
    const out = parseFrontmatter(src)
    expect(out.data).toEqual({ name: 'x' })
  })

  it('bails cleanly when the closing fence is missing', () => {
    const src = '---\nname: foo\n(no closing fence)\n'
    const out = parseFrontmatter(src)
    expect(out.data).toEqual({})
    expect(out.body).toBe(src)
  })

  it('preserves the body verbatim including blank lines', () => {
    const src =
      '---\n' +
      'name: x\n' +
      '---\n' +
      'line one\n\nline three after blank\n'
    const out = parseFrontmatter(src)
    expect(out.body).toBe('line one\n\nline three after blank\n')
  })
})
