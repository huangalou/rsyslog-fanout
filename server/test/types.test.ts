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
