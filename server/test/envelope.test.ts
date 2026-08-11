import { describe, it, expect } from 'vitest'
import { ok, fail } from '../src/lib/envelope.js'

describe('envelope', () => {
  it('ok 包裝資料且 error 為 null', () => {
    expect(ok({ a: 1 })).toEqual({ success: true, data: { a: 1 }, error: null })
  })
  it('fail 帶錯誤訊息且 data 為 null', () => {
    expect(fail('bad')).toEqual({ success: false, data: null, error: 'bad' })
  })
})
