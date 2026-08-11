export interface AppEnv {
  portRange: number[]; adminPassword: string; dataDir: string
  httpPort: number; tailPort: number; rsyslogdBin: string
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

export function loadEnv(env: NodeJS.ProcessEnv): AppEnv {
  if (!env.FANOUT_ADMIN_PASSWORD) throw new Error('FANOUT_ADMIN_PASSWORD 未設定')
  return {
    portRange: parsePortRange(env.FANOUT_PORT_RANGE ?? '514,5140-5199'),
    adminPassword: env.FANOUT_ADMIN_PASSWORD,
    dataDir: env.FANOUT_DATA_DIR ?? '/data',
    httpPort: Number(env.FANOUT_HTTP_PORT ?? 8080),
    tailPort: Number(env.FANOUT_TAIL_PORT ?? 15514),
    rsyslogdBin: env.RSYSLOGD_BIN ?? 'rsyslogd',
  }
}
