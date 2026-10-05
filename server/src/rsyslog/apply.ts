import { writeFileSync, copyFileSync, existsSync } from 'node:fs'
import type { Repo } from '../domain/repo.js'
import { generateConf, configHash, type GenOpts } from './generate.js'
import type { TlsFiles } from './tls.js'

export interface CmdResult { ok: boolean; output: string }
export interface ApplyDeps {
  repo: Repo
  paths: { staging: string; live: string; backup: string }
  genOpts: Omit<GenOpts, 'tls'>
  /** 每次套用時呼叫：憑證檔可能在 server 啟動後才掛上或更換 */
  resolveTls(): TlsFiles
  validate(confPath: string): Promise<CmdResult>
  restart(): Promise<CmdResult>
}
export type ApplyResult =
  | { applied: true }
  | { applied: false; stage: 'validate' | 'restart'; error: string }
  | { applied: false; stage: 'precheck'; code: 'TLS_CERT_MISSING'; error: string }

export async function applyConfig(deps: ApplyDeps): Promise<ApplyResult> {
  const cfg = deps.repo.getConfig()
  const tls = deps.resolveTls()
  // rsyslogd -N1 對「伺服器憑證檔不存在」只印訊息、不判定設定無效（8.2302 實測），
  // 放行的話 rsyslogd 會帶著開不起來的 TLS 監聽埠重啟，所以在這裡自己擋。
  const needsServerCert = cfg.inputs.some((i) => i.enabled && i.protocol === 'tcp' && i.tls)
  if (needsServerCert && (tls.certFile === null || tls.keyFile === null))
    return { applied: false, stage: 'precheck', code: 'TLS_CERT_MISSING', error: 'TLS server certificate or key not found' }
  writeFileSync(deps.paths.staging, generateConf(cfg, { ...deps.genOpts, tls }))

  const v = await deps.validate(deps.paths.staging)
  if (!v.ok) return { applied: false, stage: 'validate', error: v.output }

  const hadLive = existsSync(deps.paths.live)
  if (hadLive) copyFileSync(deps.paths.live, deps.paths.backup)
  copyFileSync(deps.paths.staging, deps.paths.live)

  const r = await deps.restart()
  if (!r.ok) {
    if (hadLive) {
      copyFileSync(deps.paths.backup, deps.paths.live)
      await deps.restart()
    }
    return { applied: false, stage: 'restart', error: r.output }
  }
  deps.repo.setAppliedHash(configHash(cfg))
  return { applied: true }
}
