import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db/db.js'
import { createRepo, type Repo } from '../src/domain/repo.js'
import { applyConfig } from '../src/rsyslog/apply.js'
import { configHash } from '../src/rsyslog/generate.js'

let repo: Repo, dir: string, paths: { staging: string; live: string; backup: string }
const okCmd = async () => ({ ok: true, output: '' })
const genOpts = { tailPort: 15514, dataDir: '/data' }
const noCert = { caFile: '/etc/ssl/certs/ca-certificates.crt', certFile: null, keyFile: null }
const withCert = { caFile: '/data/tls/ca.pem', certFile: '/data/tls/cert.pem', keyFile: '/data/tls/key.pem' }
const resolveTls = () => noCert

beforeEach(() => {
  repo = createRepo(openDb(':memory:'))
  repo.createInput({ name: 'n', protocol: 'udp', port: 514, enabled: true, tls: false })
  dir = mkdtempSync(join(tmpdir(), 'fanout-'))
  paths = { staging: join(dir, 's.conf'), live: join(dir, 'l.conf'), backup: join(dir, 'b.conf') }
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('applyConfig', () => {
  it('成功：staging 內容進 live、appliedHash 更新', async () => {
    const r = await applyConfig({ repo, paths, genOpts, resolveTls, validate: okCmd, restart: okCmd })
    expect(r.applied).toBe(true)
    expect(readFileSync(paths.live, 'utf8')).toContain('rs_i1')
    expect(repo.getAppliedHash()).toBe(configHash(repo.getConfig()))
  })
  it('驗證失敗：不動 live、回傳 rsyslogd 輸出', async () => {
    writeFileSync(paths.live, 'OLD')
    const r = await applyConfig({ repo, paths, genOpts, resolveTls, validate: async () => ({ ok: false, output: 'syntax err' }), restart: okCmd })
    expect(r).toEqual({ applied: false, stage: 'validate', error: 'syntax err' })
    expect(readFileSync(paths.live, 'utf8')).toBe('OLD')
  })
  it('重啟失敗：還原備份並再次 restart', async () => {
    writeFileSync(paths.live, 'OLD')
    let calls = 0
    const restart = async () => ({ ok: ++calls > 1, output: calls === 1 ? 'crashed' : '' })
    const r = await applyConfig({ repo, paths, genOpts, resolveTls, validate: okCmd, restart })
    expect(r).toEqual({ applied: false, stage: 'restart', error: 'crashed' })
    expect(readFileSync(paths.live, 'utf8')).toBe('OLD')
    expect(calls).toBe(2)
  })
  it('首次套用（無現行 live）也成功', async () => {
    expect(existsSync(paths.live)).toBe(false)
    const r = await applyConfig({ repo, paths, genOpts, resolveTls, validate: okCmd, restart: okCmd })
    expect(r.applied).toBe(true)
  })
  it('重啟 + 回滾重啟都失敗時仍回傳第一次失敗', async () => {
    writeFileSync(paths.live, 'OLD')
    let calls = 0
    const restart = async () => {
      const isFirst = calls === 0
      calls++
      return { ok: false, output: isFirst ? 'first error' : 'rollback error' }
    }
    const r = await applyConfig({ repo, paths, genOpts, resolveTls, validate: okCmd, restart })
    expect(r).toEqual({ applied: false, stage: 'restart', error: 'first error' })
    expect(readFileSync(paths.live, 'utf8')).toBe('OLD')
    expect(calls).toBe(2)
  })

  describe('TLS 套用前檢查', () => {
    const tlsInput = { name: 'tls-in', protocol: 'tcp' as const, port: 6514, enabled: true, tls: true }
    const tlsDest = { name: 'siem', protocol: 'tcp' as const, host: 'siem.example.com', port: 6514, headerMode: 'raw' as const, enabled: true, tlsMode: 'verify' as const, tlsPeerName: null }

    it('有啟用的 TLS input 但沒有伺服器憑證：以 TLS_CERT_MISSING 擋下，不驗證、不動 live', async () => {
      repo.createInput(tlsInput)
      writeFileSync(paths.live, 'OLD')
      let validated = false
      const validate = async () => { validated = true; return { ok: true, output: '' } }
      const r = await applyConfig({ repo, paths, genOpts, resolveTls: () => noCert, validate, restart: okCmd })
      expect(r).toMatchObject({ applied: false, stage: 'precheck', code: 'TLS_CERT_MISSING' })
      expect(validated).toBe(false)
      expect(readFileSync(paths.live, 'utf8')).toBe('OLD')
      expect(repo.getAppliedHash()).toBeNull()
    })
    it('TLS input 已停用時不需要憑證', async () => {
      repo.createInput({ ...tlsInput, enabled: false })
      const r = await applyConfig({ repo, paths, genOpts, resolveTls: () => noCert, validate: okCmd, restart: okCmd })
      expect(r.applied).toBe(true)
    })
    it('憑證就緒時套用成功，live 設定帶入憑證路徑', async () => {
      repo.createInput(tlsInput)
      const r = await applyConfig({ repo, paths, genOpts, resolveTls: () => withCert, validate: okCmd, restart: okCmd })
      expect(r.applied).toBe(true)
      const live = readFileSync(paths.live, 'utf8')
      expect(live).toContain('defaultNetstreamDriverCertFile="/data/tls/cert.pem"')
      expect(live).toContain('streamDriver.name="gtls"')
    })
    it('只有 TLS destination 時不需要伺服器憑證', async () => {
      const d = repo.createDestination(tlsDest)
      repo.createRoute({ inputId: 1, destinationId: d.id, sourceFilter: null, facilities: null, maxSeverity: null })
      const r = await applyConfig({ repo, paths, genOpts, resolveTls: () => noCert, validate: okCmd, restart: okCmd })
      expect(r.applied).toBe(true)
      expect(readFileSync(paths.live, 'utf8')).toContain('StreamDriverPermittedPeers="siem.example.com"')
    })
    it('每次套用都重新解析 TLS 檔案（憑證事後才掛上也能生效）', async () => {
      repo.createInput(tlsInput)
      let current = noCert as typeof noCert | typeof withCert
      const deps = { repo, paths, genOpts, resolveTls: () => current, validate: okCmd, restart: okCmd }
      expect((await applyConfig(deps)).applied).toBe(false)
      current = withCert
      expect((await applyConfig(deps)).applied).toBe(true)
    })
  })
})
