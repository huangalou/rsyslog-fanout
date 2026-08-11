import { describe, it, expect } from 'vitest'
import { nextBackoff } from '../src/api/ws'

describe('nextBackoff', () => {
  it('1s 起每次翻倍、上限 30s', () => {
    expect(nextBackoff(0)).toBe(1000)
    expect(nextBackoff(1000)).toBe(2000)
    expect(nextBackoff(16000)).toBe(30000)
    expect(nextBackoff(30000)).toBe(30000)
  })
})
