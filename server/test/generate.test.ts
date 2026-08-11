import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { generateConf, configHash } from '../src/rsyslog/generate.js'
import type { FanoutConfig } from '../src/domain/types.js'

const cfg: FanoutConfig = {
  inputs: [{ id: 1, name: 'net', protocol: 'udp', port: 514, enabled: true }],
  destinations: [
    { id: 1, name: 'arcsight', protocol: 'udp', host: '10.0.0.5', port: 514, headerMode: 'raw', enabled: true },
    { id: 2, name: 'backup', protocol: 'tcp', host: '10.0.0.6', port: 1514, headerMode: 'standard', enabled: true },
  ],
  routes: [
    { id: 1, inputId: 1, destinationId: 1, sourceFilter: null, facilities: null, maxSeverity: null },
    { id: 2, inputId: 1, destinationId: 2, sourceFilter: '10.1.0.0/16', facilities: [16, 17], maxSeverity: 4 },
  ],
}
const opts = { tailPort: 15514, dataDir: '/data' }

describe('generateConf', () => {
  it('完整組合逐字符合 golden file', () => {
    expect(generateConf(cfg, opts)).toBe(readFileSync('test/golden/full.conf', 'utf8'))
  })
  it('停用的 input 不輸出 input/ruleset', () => {
    const c = { ...cfg, inputs: [{ ...cfg.inputs[0], enabled: false }] }
    const out = generateConf(c, opts)
    expect(out).not.toContain('input(type=')
    expect(out).not.toContain('ruleset(')
  })
  it('停用的 destination 其 route 不輸出', () => {
    const c = { ...cfg, destinations: [cfg.destinations[0], { ...cfg.destinations[1], enabled: false }] }
    expect(generateConf(c, opts)).not.toContain('d2_i1')
  })
  it('完整 IP sourceFilter 使用 ==', () => {
    const c = { ...cfg, routes: [{ ...cfg.routes[0], sourceFilter: '10.9.9.9' }] }
    expect(generateConf(c, opts)).toContain(`if ($fromhost-ip == "10.9.9.9") then {`)
  })
  it('configHash 對相同內容穩定、不同內容相異', () => {
    expect(configHash(cfg)).toBe(configHash(structuredClone(cfg)))
    expect(configHash(cfg)).not.toBe(configHash({ ...cfg, routes: [] }))
  })
  it('無 tcp input 時不載入 imtcp 模組（避免 rsyslogd -N1 因 no listeners defined 而失敗）', () => {
    const out = generateConf(cfg, opts)
    expect(out).toContain('module(load="imudp")')
    expect(out).not.toContain('module(load="imtcp")')
  })
  it('無 udp input 時不載入 imudp 模組', () => {
    const c = { ...cfg, inputs: [{ ...cfg.inputs[0], protocol: 'tcp' as const }] }
    const out = generateConf(c, opts)
    expect(out).toContain('module(load="imtcp")')
    expect(out).not.toContain('module(load="imudp")')
  })
  it('同時有 udp 與 tcp input 時兩個模組都載入', () => {
    const c = {
      ...cfg,
      inputs: [...cfg.inputs, { id: 2, name: 'tcp-net', protocol: 'tcp' as const, port: 1514, enabled: true }],
    }
    const out = generateConf(c, opts)
    expect(out).toContain('module(load="imudp")')
    expect(out).toContain('module(load="imtcp")')
  })
})
