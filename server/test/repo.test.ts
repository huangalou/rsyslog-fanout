import { describe, it, expect, beforeEach } from 'vitest'
import { openDb } from '../src/db/db.js'
import { createRepo, type Repo } from '../src/domain/repo.js'

let repo: Repo
beforeEach(() => { repo = createRepo(openDb(':memory:')) })

describe('repo', () => {
  it('input CRUD 完整循環', () => {
    const i = repo.createInput({ name: 'n1', protocol: 'udp', port: 514, enabled: true, tls: false })
    expect(i.id).toBeGreaterThan(0)
    expect(repo.listInputs()).toHaveLength(1)
    const u = repo.updateInput(i.id, { name: 'n2', protocol: 'tcp', port: 5140, enabled: false, tls: false })
    expect(u?.name).toBe('n2')
    expect(u?.enabled).toBe(false)
    expect(repo.deleteInput(i.id)).toBe(true)
    expect(repo.listInputs()).toHaveLength(0)
  })
  it('刪除 input 連帶刪除其 routes（FK cascade）', () => {
    const i = repo.createInput({ name: 'n', protocol: 'udp', port: 514, enabled: true, tls: false })
    const d = repo.createDestination({ name: 'd', protocol: 'udp', host: '10.0.0.5', port: 514, headerMode: 'raw', enabled: true, tlsMode: 'off', tlsPeerName: null })
    repo.createRoute({ inputId: i.id, destinationId: d.id, sourceFilter: null, facilities: null, maxSeverity: null })
    repo.deleteInput(i.id)
    expect(repo.listRoutes()).toHaveLength(0)
  })
  it('route 的 facilities 以 JSON 往返保真', () => {
    const i = repo.createInput({ name: 'n', protocol: 'udp', port: 514, enabled: true, tls: false })
    const d = repo.createDestination({ name: 'd', protocol: 'udp', host: 'h', port: 1, headerMode: 'raw', enabled: true, tlsMode: 'off', tlsPeerName: null })
    const r = repo.createRoute({ inputId: i.id, destinationId: d.id, sourceFilter: '10.1.0.0/16', facilities: [16, 17], maxSeverity: 4 })
    expect(repo.listRoutes()[0]).toEqual(r)
    expect(r.facilities).toEqual([16, 17])
  })
  it('密碼雜湊與 appliedHash 可存取', () => {
    expect(repo.getPasswordHash()).toBeNull()
    repo.setPasswordHash('hash1')
    expect(repo.getPasswordHash()).toBe('hash1')
    repo.setAppliedHash('abc')
    expect(repo.getAppliedHash()).toBe('abc')
  })
  it('createRoute 指向不存在的 input 時丟出明確錯誤', () => {
    const d = repo.createDestination({ name: 'd', protocol: 'udp', host: 'h', port: 1, headerMode: 'raw', enabled: true, tlsMode: 'off', tlsPeerName: null })
    expect(() => {
      repo.createRoute({ inputId: 999, destinationId: d.id, sourceFilter: null, facilities: null, maxSeverity: null })
    }).toThrow('input 不存在')
  })
  it('createRoute 指向不存在的 destination 時丟出明確錯誤', () => {
    const i = repo.createInput({ name: 'n', protocol: 'udp', port: 514, enabled: true, tls: false })
    expect(() => {
      repo.createRoute({ inputId: i.id, destinationId: 999, sourceFilter: null, facilities: null, maxSeverity: null })
    }).toThrow('destination 不存在')
  })
  it('解構 getConfig 後呼叫仍正常', () => {
    const i = repo.createInput({ name: 'n', protocol: 'udp', port: 514, enabled: true, tls: false })
    const d = repo.createDestination({ name: 'd', protocol: 'udp', host: 'h', port: 1, headerMode: 'raw', enabled: true, tlsMode: 'off', tlsPeerName: null })
    repo.createRoute({ inputId: i.id, destinationId: d.id, sourceFilter: null, facilities: null, maxSeverity: null })
    const { getConfig } = repo
    const config = getConfig()
    expect(config.inputs).toHaveLength(1)
    expect(config.destinations).toHaveLength(1)
    expect(config.routes).toHaveLength(1)
  })
  it('input 的 tls 經建立、更新後可完整讀回', () => {
    const i = repo.createInput({ name: 'tls-in', protocol: 'tcp', port: 6514, enabled: true, tls: true })
    expect(i.tls).toBe(true)
    expect(repo.listInputs()[0].tls).toBe(true)
    repo.updateInput(i.id, { name: 'tls-in', protocol: 'tcp', port: 6514, enabled: true, tls: false })
    expect(repo.listInputs()[0].tls).toBe(false)
  })
  it('destination 的 tlsMode / tlsPeerName 經建立、更新後可完整讀回', () => {
    const d = repo.createDestination({ name: 'siem', protocol: 'tcp', host: '10.0.0.5', port: 6514, headerMode: 'raw', enabled: true, tlsMode: 'verify', tlsPeerName: 'siem.example.com' })
    expect(d).toMatchObject({ tlsMode: 'verify', tlsPeerName: 'siem.example.com' })
    expect(repo.listDestinations()[0]).toMatchObject({ tlsMode: 'verify', tlsPeerName: 'siem.example.com' })
    repo.updateDestination(d.id, { name: 'siem', protocol: 'tcp', host: '10.0.0.5', port: 6514, headerMode: 'raw', enabled: true, tlsMode: 'anon', tlsPeerName: null })
    expect(repo.listDestinations()[0]).toMatchObject({ tlsMode: 'anon', tlsPeerName: null })
  })
  it('未使用 TLS 的 destination 讀回 tlsMode=off、tlsPeerName=null', () => {
    repo.createDestination({ name: 'plain', protocol: 'udp', host: 'h', port: 514, headerMode: 'raw', enabled: true, tlsMode: 'off', tlsPeerName: null })
    expect(repo.listDestinations()[0]).toMatchObject({ tlsMode: 'off', tlsPeerName: null })
  })
})
