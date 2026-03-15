import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { resolveDataDir, dataPath } from './paths.js'

describe('resolveDataDir', () => {
  it('uses DATA_DIR env when set', () => {
    expect(resolveDataDir('/custom/data', () => false, '/home/user'))
      .toBe('/custom/data')
  })

  it('resolves relative DATA_DIR to absolute', () => {
    const result = resolveDataDir('relative/path', () => false, '/home/user')
    expect(path.isAbsolute(result)).toBe(true)
    expect(result).toBe(path.resolve('relative/path'))
  })

  it('uses ./data when the directory exists and DATA_DIR is unset', () => {
    expect(resolveDataDir(undefined, () => true, '/home/user'))
      .toBe(path.resolve('data'))
  })

  it('falls back to ~/.oksskolten/data when ./data does not exist', () => {
    expect(resolveDataDir(undefined, () => false, '/home/user'))
      .toBe('/home/user/.oksskolten/data')
  })

  it('DATA_DIR takes precedence over ./data', () => {
    expect(resolveDataDir('/override', () => true, '/home/user'))
      .toBe('/override')
  })
})

describe('dataPath', () => {
  it('joins segments to DATA_DIR', () => {
    const result = dataPath('rss.db')
    expect(path.isAbsolute(result)).toBe(true)
    expect(result.endsWith('rss.db')).toBe(true)
  })

  it('joins multiple segments', () => {
    const result = dataPath('articles', 'images')
    expect(result.endsWith(path.join('articles', 'images'))).toBe(true)
  })
})
