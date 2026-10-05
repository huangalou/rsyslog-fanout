import { describe, it, expect } from 'vitest'
import { InputCreateSchema, DestinationCreateSchema, RouteCreateSchema, cidrToPrefix } from '../src/domain/types.js'

describe('cidrToPrefix', () => {
  it('完整 IP 原樣回傳', () => expect(cidrToPrefix('10.1.2.3')).toBe('10.1.2.3'))
  it('/24 轉三段前綴', () => expect(cidrToPrefix('10.1.2.0/24')).toBe('10.1.2.'))
  it('/16 轉兩段前綴', () => expect(cidrToPrefix('10.1.0.0/16')).toBe('10.1.'))
  it('/8 轉一段前綴', () => expect(cidrToPrefix('10.0.0.0/8')).toBe('10.'))
  it('不支援的遮罩回 null', () => expect(cidrToPrefix('10.0.0.0/12')).toBeNull())
  it('非 IP 回 null', () => expect(cidrToPrefix('abc')).toBeNull())
})

describe('schemas', () => {
  it('合法 input 通過', () => {
    expect(InputCreateSchema.safeParse({ name: 'n1', protocol: 'udp', port: 514, enabled: true }).success).toBe(true)
  })
  it('埠號超界拒絕', () => {
    expect(InputCreateSchema.safeParse({ name: 'n1', protocol: 'udp', port: 70000, enabled: true }).success).toBe(false)
  })
  it('destination 預設 headerMode=raw', () => {
    const r = DestinationCreateSchema.parse({ name: 'd', protocol: 'udp', host: '10.0.0.5', port: 514, enabled: true })
    expect(r.headerMode).toBe('raw')
  })
  it('host 含引號時拒絕（防止跳出 conf 屬性注入指令）', () => {
    const r = DestinationCreateSchema.safeParse(
      { name: 'd', protocol: 'udp', host: '1.2.3.4" x', port: 514, enabled: true })
    expect(r.success).toBe(false)
  })
  it('host 含換行時拒絕（防止跳出 conf 屬性注入指令）', () => {
    const r = DestinationCreateSchema.safeParse(
      { name: 'd', protocol: 'udp', host: 'a\nb', port: 514, enabled: true })
    expect(r.success).toBe(false)
  })
  it.each(['10.0.0.5', 'h', 'host.docker.internal'])('合法 hostname 通過：%s', (h) => {
    const r = DestinationCreateSchema.safeParse({ name: 'd', protocol: 'udp', host: h, port: 514, enabled: true })
    expect(r.success).toBe(true)
  })
  it('route 的 sourceFilter 遮罩不支援時拒絕', () => {
    const r = RouteCreateSchema.safeParse({ inputId: 1, destinationId: 1, sourceFilter: '10.0.0.0/12', facilities: null, maxSeverity: null })
    expect(r.success).toBe(false)
  })
  it('facility 超出 0-23 拒絕', () => {
    const r = RouteCreateSchema.safeParse({ inputId: 1, destinationId: 1, sourceFilter: null, facilities: [24], maxSeverity: null })
    expect(r.success).toBe(false)
  })
})

describe('host IPv6 支援', () => {
  it.each(['2001:db8::1', '::1', 'fe80::1', '2001:0db8:0000:0000:0000:0000:0000:0001'])('合法 IPv6 literal 通過：%s', (h) => {
    const r = DestinationCreateSchema.safeParse({ name: 'd', protocol: 'udp', host: h, port: 514, enabled: true })
    expect(r.success).toBe(true)
  })
  it.each(['2001:db8::1" x', ':::', 'g::1', '2001:db8::1\n'])('非法 IPv6 樣式仍拒絕（維持注入防護）：%s', (h) => {
    const r = DestinationCreateSchema.safeParse({ name: 'd', protocol: 'udp', host: h, port: 514, enabled: true })
    expect(r.success).toBe(false)
  })
})

describe('host IPv6 zone-id 拒絕', () => {
  it.each(['fe80::1%eth0', '::1%0'])('帶 zone-id 的 IPv6 拒絕（容器 outbound 無意義）：%s', (h) => {
    const r = DestinationCreateSchema.safeParse({ name: 'd', protocol: 'udp', host: h, port: 514, enabled: true })
    expect(r.success).toBe(false)
  })
})

describe('TLS 欄位', () => {
  const input = { name: 'n1', protocol: 'tcp', port: 5140, enabled: true }
  const dest = { name: 'd', protocol: 'tcp', host: 'siem.example.com', port: 6514, enabled: true }
  const firstMessage = (r: { success: boolean; error?: { issues: Array<{ message: string }> } }) => r.error?.issues[0].message

  it('input 未帶 tls 時預設 false（舊的 API 呼叫方不需修改）', () => {
    expect(InputCreateSchema.parse(input).tls).toBe(false)
  })
  it('tcp input 可啟用 tls', () => {
    expect(InputCreateSchema.parse({ ...input, tls: true }).tls).toBe(true)
  })
  it('udp input 啟用 tls 時以 TLS_REQUIRES_TCP 拒絕', () => {
    const r = InputCreateSchema.safeParse({ ...input, protocol: 'udp', tls: true })
    expect(r.success).toBe(false)
    expect(firstMessage(r)).toBe('TLS_REQUIRES_TCP')
  })
  it('destination 未帶 TLS 欄位時預設 tlsMode=off、tlsPeerName=null', () => {
    const r = DestinationCreateSchema.parse(dest)
    expect(r.tlsMode).toBe('off')
    expect(r.tlsPeerName).toBeNull()
  })
  it.each(['verify', 'anon'])('tcp destination 可設 tlsMode=%s', (mode) => {
    expect(DestinationCreateSchema.parse({ ...dest, tlsMode: mode }).tlsMode).toBe(mode)
  })
  it.each(['verify', 'anon'])('udp destination 設 tlsMode=%s 時以 TLS_REQUIRES_TCP 拒絕', (mode) => {
    const r = DestinationCreateSchema.safeParse({ ...dest, protocol: 'udp', tlsMode: mode })
    expect(r.success).toBe(false)
    expect(firstMessage(r)).toBe('TLS_REQUIRES_TCP')
  })
  it('未知的 tlsMode 拒絕', () => {
    expect(DestinationCreateSchema.safeParse({ ...dest, tlsMode: 'strict' }).success).toBe(false)
  })
  it.each(['siem.example.com', '*.example.com', 'siem-01'])('合法 tlsPeerName 通過：%s', (name) => {
    const r = DestinationCreateSchema.safeParse({ ...dest, tlsMode: 'verify', tlsPeerName: name })
    expect(r.success).toBe(true)
  })
  it.each(['a" x="1', 'a\nb', 'a b', '', 'a,b'])('非法 tlsPeerName 以 TLS_PEER_NAME_FORMAT 拒絕（防止跳出 conf 屬性）：%j', (name) => {
    const r = DestinationCreateSchema.safeParse({ ...dest, tlsMode: 'verify', tlsPeerName: name })
    expect(r.success).toBe(false)
    expect(firstMessage(r)).toBe('TLS_PEER_NAME_FORMAT')
  })
})
