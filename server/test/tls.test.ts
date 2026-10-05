import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveTlsFiles, readTlsStatus, SYSTEM_CA_FILE } from '../src/rsyslog/tls.js'

const FIXTURE_CERT = 'test/fixtures/tls/cert.pem' // CN=fanout.test，SAN: fanout.test、localhost，2126 年到期
let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fanout-tls-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const putCert = () => copyFileSync(FIXTURE_CERT, join(dir, 'cert.pem'))
const putKey = () => writeFileSync(join(dir, 'key.pem'), 'dummy-key')

describe('resolveTlsFiles', () => {
  it('目錄為空（或不存在）時用系統信任庫、沒有伺服器憑證', () => {
    expect(resolveTlsFiles(dir)).toEqual({ caFile: SYSTEM_CA_FILE, certFile: null, keyFile: null })
    expect(resolveTlsFiles(join(dir, 'missing'))).toEqual({ caFile: SYSTEM_CA_FILE, certFile: null, keyFile: null })
  })
  it('ca.pem 存在時取代系統信任庫', () => {
    writeFileSync(join(dir, 'ca.pem'), 'ca')
    expect(resolveTlsFiles(dir).caFile).toBe(join(dir, 'ca.pem'))
  })
  it('cert.pem 與 key.pem 皆存在才視為有伺服器憑證', () => {
    putCert(); putKey()
    expect(resolveTlsFiles(dir)).toMatchObject({ certFile: join(dir, 'cert.pem'), keyFile: join(dir, 'key.pem') })
  })
  it.each([['只有 cert.pem', putCert], ['只有 key.pem', putKey]])('%s 時視為沒有伺服器憑證', (_label, put) => {
    put()
    expect(resolveTlsFiles(dir)).toMatchObject({ certFile: null, keyFile: null })
  })
})

describe('resolveTlsFiles：憑證內容', () => {
  it('cert.pem 不是合法憑證時視為沒有伺服器憑證（rsyslogd -N1 擋不住這種設定）', () => {
    writeFileSync(join(dir, 'cert.pem'), 'not a certificate'); putKey()
    expect(resolveTlsFiles(dir)).toMatchObject({ certFile: null, keyFile: null })
  })
})

describe('resolveTlsFiles：只接受一般檔案', () => {
  it('key.pem 是目錄時視為沒有伺服器憑證', () => {
    putCert(); mkdirSync(join(dir, 'key.pem'))
    expect(resolveTlsFiles(dir)).toMatchObject({ certFile: null, keyFile: null })
    expect(readTlsStatus(dir).serverCert).toMatchObject({ ready: false, keyPresent: false })
  })
  it('ca.pem 是目錄時不當成自訂 CA', () => {
    mkdirSync(join(dir, 'ca.pem'))
    expect(resolveTlsFiles(dir).caFile).toBe(SYSTEM_CA_FILE)
    expect(readTlsStatus(dir).customCa).toBe(false)
  })
  it('cert.pem 超過大小上限時不讀取、視為不可用（即使開頭是合法憑證）', () => {
    const real = readFileSync(FIXTURE_CERT)
    writeFileSync(join(dir, 'cert.pem'), Buffer.concat([real, Buffer.alloc(1024 * 1024 + 1, 0x0a)])); putKey()
    expect(resolveTlsFiles(dir)).toMatchObject({ certFile: null, keyFile: null })
    expect(readTlsStatus(dir).serverCert).toMatchObject({ ready: false, certPresent: true, subject: null })
  })
})

describe('readTlsStatus', () => {
  it('沒有任何檔案：未就緒、無自訂 CA', () => {
    expect(readTlsStatus(dir)).toEqual({
      dir, customCa: false,
      serverCert: { ready: false, certPresent: false, keyPresent: false, subject: null, altNames: null, notAfter: null, expired: null },
    })
  })
  it('憑證與私鑰俱全：就緒，並回報主體、SAN 與到期日', () => {
    putCert(); putKey()
    expect(readTlsStatus(dir).serverCert).toEqual({
      ready: true, certPresent: true, keyPresent: true,
      subject: 'CN=fanout.test', altNames: 'DNS:fanout.test, DNS:localhost',
      notAfter: '2126-09-11T08:04:00.000Z', expired: false,
    })
  })
  it('以傳入的現在時間判斷是否過期', () => {
    putCert(); putKey()
    expect(readTlsStatus(dir, new Date('2200-01-01T00:00:00Z')).serverCert.expired).toBe(true)
  })
  it('缺私鑰：未就緒，但仍回報憑證資訊', () => {
    putCert()
    expect(readTlsStatus(dir).serverCert).toMatchObject({ ready: false, certPresent: true, keyPresent: false, subject: 'CN=fanout.test' })
  })
  it('cert.pem 不是合法憑證：未就緒，不丟例外', () => {
    writeFileSync(join(dir, 'cert.pem'), 'not a certificate'); putKey()
    expect(readTlsStatus(dir).serverCert).toMatchObject({ ready: false, certPresent: true, keyPresent: true, subject: null, notAfter: null })
  })
  it('有 ca.pem 時 customCa 為 true', () => {
    writeFileSync(join(dir, 'ca.pem'), 'ca')
    expect(readTlsStatus(dir).customCa).toBe(true)
  })
  it('狀態不含任何檔案內容', () => {
    putCert(); putKey()
    expect(JSON.stringify(readTlsStatus(dir))).not.toContain('dummy-key')
    expect(JSON.stringify(readTlsStatus(dir))).not.toContain('BEGIN')
  })
})
