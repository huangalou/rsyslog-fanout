import { createHash } from 'node:crypto'
import type { FanoutConfig, Destination, RouteRule } from '../domain/types.js'
import { cidrToPrefix } from '../domain/types.js'

export interface GenOpts { tailPort: number; dataDir: string }

const destAction = (d: Destination, inputId: number): string => {
  const tpl = d.headerMode === 'raw' ? 't_raw' : 't_std'
  return `action(name="d${d.id}_i${inputId}" type="omfwd" target="${d.host}" port="${d.port}" protocol="${d.protocol}" template="${tpl}" queue.type="LinkedList" queue.filename="q_i${inputId}_d${d.id}" queue.maxdiskspace="1g" queue.saveonshutdown="on" action.resumeRetryCount="-1")`
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
  L.push(`global(workDirectory="${opts.dataDir}/queues")`)
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
  const destById = new Map(cfg.destinations.map((d) => [d.id, d]))
  for (const i of enabledInputs) {
    L.push('')
    L.push(`input(type="im${i.protocol}" port="${i.port}" ruleset="rs_i${i.id}")`)
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
  return L.join('\n') + '\n'
}

export function configHash(cfg: FanoutConfig): string {
  return createHash('sha256').update(JSON.stringify(cfg)).digest('hex')
}
