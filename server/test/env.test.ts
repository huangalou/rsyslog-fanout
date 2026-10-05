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
  it('tlsDir 預設為資料目錄下的 tls', () => {
    expect(loadEnv({ FANOUT_ADMIN_PASSWORD: 'pw' }).tlsDir).toBe('/data/tls')
    expect(loadEnv({ FANOUT_ADMIN_PASSWORD: 'pw', FANOUT_DATA_DIR: '/srv/fanout' }).tlsDir).toBe('/srv/fanout/tls')
  })
  it('FANOUT_TLS_DIR 可覆寫 tlsDir', () => {
    expect(loadEnv({ FANOUT_ADMIN_PASSWORD: 'pw', FANOUT_TLS_DIR: '/run/secrets/tls' }).tlsDir).toBe('/run/secrets/tls')
  })
})

describe('loadEnv：會寫進 rsyslog 設定的路徑', () => {
  // 這兩個目錄會原樣出現在 rsyslog 設定的雙引號字串裡
  it.each(['/data"x', '/data\nmodule(load="omprog")', '/da\\ta', '/data\u0000'])('FANOUT_TLS_DIR 含引號、反斜線或控制字元時啟動失敗：%j', (dir) => {
    expect(() => loadEnv({ FANOUT_ADMIN_PASSWORD: 'pw', FANOUT_TLS_DIR: dir })).toThrow(/FANOUT_TLS_DIR/)
  })
  it('FANOUT_DATA_DIR 含引號時啟動失敗', () => {
    expect(() => loadEnv({ FANOUT_ADMIN_PASSWORD: 'pw', FANOUT_DATA_DIR: '/data"x' })).toThrow(/FANOUT_DATA_DIR/)
  })
  it('一般路徑（含空白與連字號）可用', () => {
    expect(loadEnv({ FANOUT_ADMIN_PASSWORD: 'pw', FANOUT_TLS_DIR: '/run/secrets/fan-out tls' }).tlsDir).toBe('/run/secrets/fan-out tls')
  })
})
