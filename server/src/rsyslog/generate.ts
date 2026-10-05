import { createHash } from 'node:crypto'
import type { FanoutConfig, Input, Destination, RouteRule } from '../domain/types.js'
import { cidrToPrefix } from '../domain/types.js'
import type { TlsFiles } from './tls.js'

export interface GenOpts { tailPort: number; dataDir: string; tls: TlsFiles }

// 選 gtls 而非 ossl：名稱不符時 gtls 會印出原因與對方憑證名稱，ossl 在部分情況完全沒有輸出
// （rsyslogd 8.2302 實測，見 docs/superpowers/specs/2026-10-05-tls-transport-design.md）。
const TLS_DRIVER = 'gtls'

// TLS 只對 tcp 有意義。schema 已在 API 邊界擋掉 udp + TLS，這裡再判一次協定作為最後防線：
// 把 TLS 參數寫進 udp 的 input / action 會讓整份設定無法通過驗證。
const isTlsInput = (i: Input): boolean => i.protocol === 'tcp' && i.tls === true
const isTlsDest = (d: Destination): boolean => d.protocol === 'tcp' && (d.tlsMode === 'verify' || d.tlsMode === 'anon')

const destTlsParams = (d: Destination): string => {
  if (!isTlsDest(d)) return ''
  const driver = ` StreamDriver="${TLS_DRIVER}" StreamDriverMode="1"`
  if (d.tlsMode === 'anon') return `${driver} StreamDriverAuthMode="anon"`
  // PermittedPeers 一律明確寫出：未指定時 gtls 會退回比對連線目標，ossl 則直接不送且不報錯
  return `${driver} StreamDriverAuthMode="x509/name" StreamDriverPermittedPeers="${d.tlsPeerName ?? d.host}"`
}

const destAction = (d: Destination, inputId: number): string => {
  const tpl = d.headerMode === 'raw' ? 't_raw' : 't_std'
  return `action(name="d${d.id}_i${inputId}" type="omfwd" target="${d.host}" port="${d.port}" protocol="${d.protocol}"${destTlsParams(d)} template="${tpl}" queue.type="LinkedList" queue.filename="q_i${inputId}_d${d.id}" queue.maxdiskspace="1g" queue.saveonshutdown="on" action.resumeRetryCount="-1")`
}

// input 的 authMode="anon" 指不要求用戶端憑證；伺服器仍會出示自己的憑證供設備驗證
const inputTlsParams = (i: Input): string =>
  isTlsInput(i) ? ` streamDriver.name="${TLS_DRIVER}" streamDriver.mode="1" streamDriver.authMode="anon"` : ''

// 沒用到 TLS 時不輸出任何 TLS 全域參數：既有的非 TLS 設定升級後逐字不變
const globalTlsParams = (tls: TlsFiles): string => {
  const ca = ` defaultNetstreamDriverCAFile="${tls.caFile}"`
  if (tls.certFile === null || tls.keyFile === null) return ca
  return `${ca} defaultNetstreamDriverCertFile="${tls.certFile}" defaultNetstreamDriverKeyFile="${tls.keyFile}"`
}

const condition = (r: RouteRule): string | null => {
  const parts: string[] = []
  if (r.sourceFilter) {
    const p = cidrToPrefix(r.sourceFilter)
    if (p === r.sourceFilter) parts.push(`$fromhost-ip == "${p}"`)
    else parts.push(`$fromhost-ip startswith "${p}"`)
  }
  if (r.facilities?.length)
    parts.push(`(${r.facilities.map((f) => `$syslogfacility == ${f}`).join(' or ')})`)
  if (r.maxSeverity !== null) parts.push(`$syslogseverity <= ${r.maxSeverity}`)
  return parts.length ? parts.join(' and ') : null
}

export function generateConf(cfg: FanoutConfig, opts: GenOpts): string {
  const L: string[] = []
  const enabledInputs = cfg.inputs.filter((i) => i.enabled)
  const destById = new Map(cfg.destinations.map((d) => [d.id, d]))
  const enabledInputIds = new Set(enabledInputs.map((i) => i.id))
  const usesTls = enabledInputs.some(isTlsInput) || cfg.routes.some((r) => {
    const d = destById.get(r.destinationId)
    return enabledInputIds.has(r.inputId) && d !== undefined && d.enabled && isTlsDest(d)
  })
  L.push(`global(workDirectory="${opts.dataDir}/queues"${usesTls ? globalTlsParams(opts.tls) : ''})`)
  // 只在確實有對應協定的 enabled input 時才載入該接收模組；
  // 若無條件載入（不論有無對應 input）rsyslogd -N1 會因「module loaded, but no
  // listeners defined」而以非 0 退出，導致套用一律失敗（實機以真實 rsyslogd 驗證時發現）。
  if (enabledInputs.some((i) => i.protocol === 'udp')) L.push('module(load="imudp")')
  if (enabledInputs.some((i) => i.protocol === 'tcp')) L.push('module(load="imtcp")')
  L.push(`module(load="impstats" interval="10" format="json" resetCounters="off" log.file="${opts.dataDir}/stats/impstats.json" log.syslog="off")`)
  L.push('')
  L.push('template(name="t_raw" type="string" string="%rawmsg%")')
  L.push('template(name="t_std" type="string" string="<%pri%>%timestamp% %hostname% %syslogtag%%msg%")')
  for (const i of enabledInputs)
    L.push(`template(name="t_tail_i${i.id}" type="string" string="{\\"src\\":\\"%fromhost-ip%\\",\\"input\\":${i.id},\\"fac\\":%syslogfacility%,\\"sev\\":%syslogseverity%,\\"msg\\":\\"%rawmsg:::json%\\"}")`)
  for (const i of enabledInputs) {
    L.push('')
    L.push(`input(type="im${i.protocol}" port="${i.port}" ruleset="rs_i${i.id}"${inputTlsParams(i)})`)
    L.push(`ruleset(name="rs_i${i.id}") {`)
    L.push(`  action(type="omfwd" target="127.0.0.1" port="${opts.tailPort}" protocol="udp" template="t_tail_i${i.id}")`)
    for (const r of cfg.routes.filter((r) => r.inputId === i.id)) {
      const d = destById.get(r.destinationId)
      if (!d || !d.enabled) continue
      const cond = condition(r)
      if (cond === null) L.push(`  ${destAction(d, i.id)}`)
      else L.push(`  if (${cond}) then {`, `    ${destAction(d, i.id)}`, '  }')
    }
    L.push('}')
  }
  // 無任何 enabled input 時整份設定沒有 action，rsyslogd -N1 會以 error -2103
  // （no active actions configured）判定無效，導致刪光 input 後永遠無法套用。
  // 補一個寫入 /dev/null 的佔位 action；omdiscard / stop 皆不被視為 active action（實機驗證）。
  if (enabledInputs.length === 0) {
    L.push('')
    L.push('action(type="omfile" file="/dev/null")')
  }
  return L.join('\n') + '\n'
}

// v1.2 新增的欄位取預設值時不納入雜湊：升級前已套用的設定物件沒有這些欄位，
// 若一併雜湊，所有既有安裝升級後都會被判定為「未套用變更」。
const HASH_OMITTED_DEFAULTS: Readonly<Record<string, unknown>> = { tls: false, tlsMode: 'off', tlsPeerName: null }

export function configHash(cfg: FanoutConfig): string {
  const json = JSON.stringify(cfg, (key, value) =>
    Object.hasOwn(HASH_OMITTED_DEFAULTS, key) && value === HASH_OMITTED_DEFAULTS[key] ? undefined : value)
  return createHash('sha256').update(json).digest('hex')
}
