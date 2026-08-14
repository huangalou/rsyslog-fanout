import { describe, it, expect } from 'vitest'
import { ok, fail } from '../src/lib/envelope.js'

describe('envelope', () => {
  it('ok 包裝資料且 error 為 null', () => {
    expect(ok({ a: 1 })).toEqual({ success: true, data: { a: 1 }, error: null })
  })
  it('fail 帶錯誤碼與英文訊息且 data 為 null', () => {
    expect(fail('NOT_FOUND')).toEqual({
      success: false,
      data: null,
      error: { code: 'NOT_FOUND', message: 'Resource not found' },
    })
  })
  it('fail 以 params 插值訊息並保留 params 供前端翻譯', () => {
    const env = fail('PORT_OUT_OF_RANGE', { port: 9999, range: '514,5140-5199' })
    expect(env.error).toEqual({
      code: 'PORT_OUT_OF_RANGE',
      message: 'Port 9999 is outside the allowed range (514,5140-5199)',
      params: { port: 9999, range: '514,5140-5199' },
    })
  })
  it('fail 可用 messageOverride 傳遞動態訊息（zod 驗證）', () => {
    const env = fail('VALIDATION', undefined, 'port must be an integer')
    expect(env.error).toEqual({ code: 'VALIDATION', message: 'port must be an integer' })
  })
})
