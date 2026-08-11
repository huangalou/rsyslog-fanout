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

beforeEach(() => {
  repo = createRepo(openDb(':memory:'))
  repo.createInput({ name: 'n', protocol: 'udp', port: 514, enabled: true })
  dir = mkdtempSync(join(tmpdir(), 'fanout-'))
  paths = { staging: join(dir, 's.conf'), live: join(dir, 'l.conf'), backup: join(dir, 'b.conf') }
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('applyConfig', () => {
  it('成功：staging 內容進 live、appliedHash 更新', async () => {
    const r = await applyConfig({ repo, paths, genOpts, validate: okCmd, restart: okCmd })
    expect(r.applied).toBe(true)
    expect(readFileSync(paths.live, 'utf8')).toContain('rs_i1')
    expect(repo.getAppliedHash()).toBe(configHash(repo.getConfig()))
  })
  it('驗證失敗：不動 live、回傳 rsyslogd 輸出', async () => {
    writeFileSync(paths.live, 'OLD')
    const r = await applyConfig({ repo, paths, genOpts, validate: async () => ({ ok: false, output: 'syntax err' }), restart: okCmd })
    expect(r).toEqual({ applied: false, stage: 'validate', error: 'syntax err' })
    expect(readFileSync(paths.live, 'utf8')).toBe('OLD')
  })
  it('重啟失敗：還原備份並再次 restart', async () => {
    writeFileSync(paths.live, 'OLD')
    let calls = 0
    const restart = async () => ({ ok: ++calls > 1, output: calls === 1 ? 'crashed' : '' })
    const r = await applyConfig({ repo, paths, genOpts, validate: okCmd, restart })
    expect(r).toEqual({ applied: false, stage: 'restart', error: 'crashed' })
    expect(readFileSync(paths.live, 'utf8')).toBe('OLD')
    expect(calls).toBe(2)
  })
  it('首次套用（無現行 live）也成功', async () => {
    expect(existsSync(paths.live)).toBe(false)
    const r = await applyConfig({ repo, paths, genOpts, validate: okCmd, restart: okCmd })
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
    const r = await applyConfig({ repo, paths, genOpts, validate: okCmd, restart })
    expect(r).toEqual({ applied: false, stage: 'restart', error: 'first error' })
    expect(readFileSync(paths.live, 'utf8')).toBe('OLD')
    expect(calls).toBe(2)
  })
})
