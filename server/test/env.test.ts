import { describe, it, expect } from 'vitest'
import { parsePortRange, loadEnv } from '../src/env.js'

describe('parsePortRange', () => {
  it('混合單埠與範圍', () => {
    const r = parsePortRange('514,5140-5142')
    expect(r).toEqual([514, 5140, 5141, 5142])
  })
  it('格式錯誤丟 Error', () => expect(() => parsePortRange('abc')).toThrow())
  it('反向範圍丟 Error', () => expect(() => parsePortRange('5199-5140')).toThrow())
})

describe('loadEnv', () => {
  it('缺 FANOUT_ADMIN_PASSWORD 丟 Error', () => expect(() => loadEnv({})).toThrow(/FANOUT_ADMIN_PASSWORD/))
  it('預設值正確', () => {
    const e = loadEnv({ FANOUT_ADMIN_PASSWORD: 'pw' })
    expect(e.httpPort).toBe(8080)
    expect(e.tailPort).toBe(15514)
    expect(e.dataDir).toBe('/data')
    expect(e.portRange).toContain(514)
  })
})
