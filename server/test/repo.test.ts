import { describe, it, expect, beforeEach } from 'vitest'
import { openDb } from '../src/db/db.js'
import { createRepo, type Repo } from '../src/domain/repo.js'

let repo: Repo
beforeEach(() => { repo = createRepo(openDb(':memory:')) })

describe('repo', () => {
  it('input CRUD 完整循環', () => {
    const i = repo.createInput({ name: 'n1', protocol: 'udp', port: 514, enabled: true })
    expect(i.id).toBeGreaterThan(0)
    expect(repo.listInputs()).toHaveLength(1)
    const u = repo.updateInput(i.id, { name: 'n2', protocol: 'tcp', port: 5140, enabled: false })
    expect(u?.name).toBe('n2')
    expect(u?.enabled).toBe(false)
    expect(repo.deleteInput(i.id)).toBe(true)
    expect(repo.listInputs()).toHaveLength(0)
  })
  it('刪除 input 連帶刪除其 routes（FK cascade）', () => {
    const i = repo.createInput({ name: 'n', protocol: 'udp', port: 514, enabled: true })
    const d = repo.createDestination({ name: 'd', protocol: 'udp', host: '10.0.0.5', port: 514, headerMode: 'raw', enabled: true })
    repo.createRoute({ inputId: i.id, destinationId: d.id, sourceFilter: null, facilities: null, maxSeverity: null })
    repo.deleteInput(i.id)
    expect(repo.listRoutes()).toHaveLength(0)
  })
  it('route 的 facilities 以 JSON 往返保真', () => {
    const i = repo.createInput({ name: 'n', protocol: 'udp', port: 514, enabled: true })
    const d = repo.createDestination({ name: 'd', protocol: 'udp', host: 'h', port: 1, headerMode: 'raw', enabled: true })
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
})
