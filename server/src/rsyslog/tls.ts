import { existsSync, readFileSync } from 'node:fs'
import { X509Certificate } from 'node:crypto'
import { join } from 'node:path'

// TLS 檔案一律由操作者掛進容器（見 README「TLS」），server 只讀公開憑證、從不讀取私鑰內容。
export const SYSTEM_CA_FILE = '/etc/ssl/certs/ca-certificates.crt'

/** 產生 rsyslog 設定時實際採用的檔案路徑；certFile / keyFile 只會同時為 null 或同時有值 */
export interface TlsFiles { caFile: string; certFile: string | null; keyFile: string | null }

export interface TlsStatus {
  dir: string
  customCa: boolean
  serverCert: {
    ready: boolean; certPresent: boolean; keyPresent: boolean
    subject: string | null; altNames: string | null; notAfter: string | null; expired: boolean | null
  }
}

const pathsIn = (tlsDir: string) => ({
  ca: join(tlsDir, 'ca.pem'), cert: join(tlsDir, 'cert.pem'), key: join(tlsDir, 'key.pem'),
})

// 檔案不存在、讀不到、或內容不是憑證，對呼叫端都是同一件事：這張憑證不能用。
// 以 null 回報而不往上丟，由 readTlsStatus 的 ready 與套用前檢查呈現給使用者。
function parseCert(path: string): X509Certificate | null {
  try {
    return new X509Certificate(readFileSync(path))
  } catch {
    return null
  }
}

export function resolveTlsFiles(tlsDir: string): TlsFiles {
  const p = pathsIn(tlsDir)
  const hasServerCert = parseCert(p.cert) !== null && existsSync(p.key)
  return {
    caFile: existsSync(p.ca) ? p.ca : SYSTEM_CA_FILE,
    certFile: hasServerCert ? p.cert : null,
    keyFile: hasServerCert ? p.key : null,
  }
}

export function readTlsStatus(tlsDir: string, now: Date = new Date()): TlsStatus {
  const p = pathsIn(tlsDir)
  const cert = parseCert(p.cert)
  const keyPresent = existsSync(p.key)
  const notAfter = cert ? new Date(cert.validTo) : null
  return {
    dir: tlsDir,
    customCa: existsSync(p.ca),
    serverCert: {
      ready: cert !== null && keyPresent,
      certPresent: existsSync(p.cert),
      keyPresent,
      subject: cert?.subject ?? null,
      altNames: cert?.subjectAltName ?? null,
      notAfter: notAfter?.toISOString() ?? null,
      expired: notAfter ? notAfter.getTime() < now.getTime() : null,
    },
  }
}
