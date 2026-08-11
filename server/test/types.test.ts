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
  it('route 的 sourceFilter 遮罩不支援時拒絕', () => {
    const r = RouteCreateSchema.safeParse({ inputId: 1, destinationId: 1, sourceFilter: '10.0.0.0/12', facilities: null, maxSeverity: null })
    expect(r.success).toBe(false)
  })
  it('facility 超出 0-23 拒絕', () => {
    const r = RouteCreateSchema.safeParse({ inputId: 1, destinationId: 1, sourceFilter: null, facilities: [24], maxSeverity: null })
    expect(r.success).toBe(false)
  })
})
