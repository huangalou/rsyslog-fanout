import { join } from 'node:path'

export interface AppEnv {
  portRange: number[]; adminPassword: string; dataDir: string
  httpPort: number; tailPort: number; rsyslogdBin: string
  /** 操作者掛入 ca.pem / cert.pem / key.pem 的目錄 */
  tlsDir: string
}

export function parsePortRange(s: string): number[] {
  const out: number[] = []
  for (const part of s.split(',').map((p) => p.trim())) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part)
    if (!m) throw new Error(`FANOUT_PORT_RANGE 格式錯誤: ${part}`)
    const lo = Number(m[1]); const hi = m[2] ? Number(m[2]) : lo
    if (lo > hi || hi > 65535) throw new Error(`FANOUT_PORT_RANGE 範圍錯誤: ${part}`)
    for (let p = lo; p <= hi; p++) out.push(p)
  }
  return out
}

// dataDir 與 tlsDir 會原樣寫進 rsyslog 設定的雙引號字串，含引號、反斜線或控制字元就能跳出字串。
// 這些值來自部署環境而非 WebUI，於啟動時檢查一次。
const UNSAFE_IN_CONF_STRING = /["\\\x00-\x1f\x7f]/
function confSafePath(name: string, value: string): string {
  if (UNSAFE_IN_CONF_STRING.test(value)) throw new Error(`${name} 不可包含引號、反斜線或控制字元`)
  return value
}

export function loadEnv(env: NodeJS.ProcessEnv): AppEnv {
  if (!env.FANOUT_ADMIN_PASSWORD) throw new Error('FANOUT_ADMIN_PASSWORD 未設定')
  const dataDir = confSafePath('FANOUT_DATA_DIR', env.FANOUT_DATA_DIR ?? '/data')
  return {
    portRange: parsePortRange(env.FANOUT_PORT_RANGE ?? '514,5140-5199'),
    adminPassword: env.FANOUT_ADMIN_PASSWORD,
    dataDir,
    tlsDir: confSafePath('FANOUT_TLS_DIR', env.FANOUT_TLS_DIR ?? join(dataDir, 'tls')),
    httpPort: Number(env.FANOUT_HTTP_PORT ?? 8080),
    tailPort: Number(env.FANOUT_TAIL_PORT ?? 15514),
    rsyslogdBin: env.RSYSLOGD_BIN ?? 'rsyslogd',
  }
}
