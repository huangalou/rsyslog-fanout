import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { generateConf, configHash } from '../src/rsyslog/generate.js'
import type { FanoutConfig } from '../src/domain/types.js'

const cfg: FanoutConfig = {
  inputs: [{ id: 1, name: 'net', protocol: 'udp', port: 514, enabled: true, tls: false }],
  destinations: [
    { id: 1, name: 'arcsight', protocol: 'udp', host: '10.0.0.5', port: 514, headerMode: 'raw', enabled: true, tlsMode: 'off', tlsPeerName: null },
    { id: 2, name: 'backup', protocol: 'tcp', host: '10.0.0.6', port: 1514, headerMode: 'standard', enabled: true, tlsMode: 'off', tlsPeerName: null },
  ],
  routes: [
    { id: 1, inputId: 1, destinationId: 1, sourceFilter: null, facilities: null, maxSeverity: null },
    { id: 2, inputId: 1, destinationId: 2, sourceFilter: '10.1.0.0/16', facilities: [16, 17], maxSeverity: 4 },
  ],
}
// 憑證檔俱全但設定沒用到 TLS：既有案例（含 golden）都以此 opts 產生，等於同時驗證「沒用 TLS 就不輸出任何 TLS 內容」
const tlsFiles = { caFile: '/data/tls/ca.pem', certFile: '/data/tls/cert.pem', keyFile: '/data/tls/key.pem' }
const opts = { tailPort: 15514, dataDir: '/data', tls: tlsFiles }

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
  it('無任何 enabled input 時輸出 /dev/null 佔位 action（避免 rsyslogd -N1 因 no active actions 而失敗）', () => {
    const PLACEHOLDER = 'action(type="omfile" file="/dev/null")'
    expect(generateConf({ inputs: [], destinations: [], routes: [] }, opts)).toContain(PLACEHOLDER)
    const allDisabled = { ...cfg, inputs: [{ ...cfg.inputs[0], enabled: false }] }
    expect(generateConf(allDisabled, opts)).toContain(PLACEHOLDER)
  })
  it('有 enabled input 時不輸出佔位 action', () => {
    expect(generateConf(cfg, opts)).not.toContain('file="/dev/null"')
  })
  it('同時有 udp 與 tcp input 時兩個模組都載入', () => {
    const c = {
      ...cfg,
      inputs: [...cfg.inputs, { id: 2, name: 'tcp-net', protocol: 'tcp' as const, port: 1514, enabled: true, tls: false }],
    }
    const out = generateConf(c, opts)
    expect(out).toContain('module(load="imudp")')
    expect(out).toContain('module(load="imtcp")')
  })
})

describe('generateConf：TLS', () => {
  const TLS_GLOBAL = 'global(workDirectory="/data/queues" defaultNetstreamDriverCAFile="/data/tls/ca.pem" defaultNetstreamDriverCertFile="/data/tls/cert.pem" defaultNetstreamDriverKeyFile="/data/tls/key.pem")'
  const tlsInput = { id: 2, name: 'tls-in', protocol: 'tcp' as const, port: 6514, enabled: true, tls: true }
  const withTlsDest = (over: Partial<FanoutConfig['destinations'][number]>): FanoutConfig => ({
    ...cfg,
    destinations: [cfg.destinations[0], { ...cfg.destinations[1], tlsMode: 'verify', ...over }],
    routes: [{ id: 2, inputId: 1, destinationId: 2, sourceFilter: null, facilities: null, maxSeverity: null }],
  })

  it('TLS input 輸出逐 input 的 gtls 參數，並於 global 帶入 CA 與伺服器憑證', () => {
    const out = generateConf({ ...cfg, inputs: [tlsInput] }, opts)
    expect(out).toContain('input(type="imtcp" port="6514" ruleset="rs_i2" streamDriver.name="gtls" streamDriver.mode="1" streamDriver.authMode="anon")')
    expect(out.split('\n')[0]).toBe(TLS_GLOBAL)
  })
  it('明文 tcp input 與 TLS input 並存時，明文那條不帶 TLS 參數', () => {
    const plain = { id: 3, name: 'plain-tcp', protocol: 'tcp' as const, port: 5140, enabled: true, tls: false }
    const out = generateConf({ ...cfg, inputs: [tlsInput, plain] }, opts)
    expect(out).toContain('input(type="imtcp" port="5140" ruleset="rs_i3")')
  })
  it('停用的 TLS input 不觸發任何 TLS 輸出', () => {
    const out = generateConf({ ...cfg, inputs: [cfg.inputs[0], { ...tlsInput, enabled: false }] }, opts)
    expect(out).not.toContain('NetstreamDriver')
    expect(out).not.toContain('streamDriver')
  })
  it('verify 模式未指定 tlsPeerName 時，以 host 作為憑證須符合的名稱', () => {
    const out = generateConf(withTlsDest({}), opts)
    expect(out).toContain('protocol="tcp" StreamDriver="gtls" StreamDriverMode="1" StreamDriverAuthMode="x509/name" StreamDriverPermittedPeers="10.0.0.6" template="t_std"')
  })
  it('verify 模式指定 tlsPeerName 時以它為準（連線目標仍是 host）', () => {
    const out = generateConf(withTlsDest({ tlsPeerName: 'siem.example.com' }), opts)
    expect(out).toContain('target="10.0.0.6"')
    expect(out).toContain('StreamDriverAuthMode="x509/name" StreamDriverPermittedPeers="siem.example.com"')
  })
  it('anon 模式只加密、不輸出 PermittedPeers（即使殘留 tlsPeerName）', () => {
    const out = generateConf(withTlsDest({ tlsMode: 'anon', tlsPeerName: 'siem.example.com' }), opts)
    expect(out).toContain('StreamDriver="gtls" StreamDriverMode="1" StreamDriverAuthMode="anon" template=')
    expect(out).not.toContain('StreamDriverPermittedPeers')
  })
  it('只有 TLS destination 且沒有伺服器憑證時，global 只帶 CA', () => {
    const out = generateConf(withTlsDest({}), { ...opts, tls: { caFile: '/etc/ssl/certs/ca-certificates.crt', certFile: null, keyFile: null } })
    expect(out.split('\n')[0]).toBe('global(workDirectory="/data/queues" defaultNetstreamDriverCAFile="/etc/ssl/certs/ca-certificates.crt")')
  })
  it('TLS destination 停用或沒有任何路由指向它時，不輸出 TLS global', () => {
    const disabled = withTlsDest({ enabled: false })
    const unrouted = { ...withTlsDest({}), routes: [] }
    expect(generateConf(disabled, opts)).not.toContain('NetstreamDriver')
    expect(generateConf(unrouted, opts)).not.toContain('NetstreamDriver')
  })
  // schema 已在 API 邊界擋掉 udp + TLS；若資料仍出現這種組合（DB 被直接改動或日後的程式錯誤），
  // 產生器必須拒絕，而不是默默產出一份明文設定
  it('udp input 標了 tls 時拒絕產生設定', () => {
    const udpTlsInput = { ...cfg.inputs[0], tls: true }
    expect(() => generateConf({ ...cfg, inputs: [udpTlsInput] }, opts)).toThrow(/input "net".*TLS.*tcp/)
  })
  it('udp destination 標了 tlsMode 時拒絕產生設定', () => {
    expect(() => generateConf(withTlsDest({ protocol: 'udp' }), opts)).toThrow(/destination "backup".*TLS.*tcp/)
  })
  it('停用中的 udp + TLS 資料同樣拒絕（啟用後就會變成明文）', () => {
    const udpTlsInput = { ...cfg.inputs[0], id: 9, name: 'off-in', port: 5150, enabled: false, tls: true }
    expect(() => generateConf({ ...cfg, inputs: [cfg.inputs[0], udpTlsInput] }, opts)).toThrow(/input "off-in"/)
  })
})

describe('configHash：TLS 欄位的向後相容', () => {
  // 升級前的設定物件沒有 TLS 欄位；升級後同一份設定多了預設值，雜湊必須相同，
  // 否則所有既有安裝升級後都會被判定為「未套用變更」
  const legacy = {
    inputs: [{ id: 1, name: 'net', protocol: 'udp', port: 514, enabled: true }],
    destinations: [{ id: 1, name: 'arcsight', protocol: 'tcp', host: '10.0.0.5', port: 514, headerMode: 'raw', enabled: true }],
    routes: [{ id: 1, inputId: 1, destinationId: 1, sourceFilter: null, facilities: null, maxSeverity: null }],
  } as unknown as FanoutConfig
  const upgraded: FanoutConfig = {
    inputs: [{ ...legacy.inputs[0], tls: false }],
    destinations: [{ ...legacy.destinations[0], tlsMode: 'off', tlsPeerName: null }],
    routes: legacy.routes,
  }

  it('新欄位皆為預設值時，雜湊與升級前相同', () => {
    expect(configHash(upgraded)).toBe(configHash(legacy))
  })
  it('input 啟用 tls 會改變雜湊', () => {
    const c = { ...upgraded, inputs: [{ ...upgraded.inputs[0], protocol: 'tcp' as const, tls: true }] }
    const plainTcp = { ...upgraded, inputs: [{ ...upgraded.inputs[0], protocol: 'tcp' as const }] }
    expect(configHash(c)).not.toBe(configHash(plainTcp))
  })
  it('destination 的 tlsMode 或 tlsPeerName 變動會改變雜湊', () => {
    const verify = { ...upgraded, destinations: [{ ...upgraded.destinations[0], tlsMode: 'verify' as const }] }
    const named = { ...upgraded, destinations: [{ ...upgraded.destinations[0], tlsMode: 'verify' as const, tlsPeerName: 'siem' }] }
    expect(configHash(verify)).not.toBe(configHash(upgraded))
    expect(configHash(named)).not.toBe(configHash(verify))
  })
})
