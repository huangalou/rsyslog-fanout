import { writeFileSync, copyFileSync, existsSync } from 'node:fs'
import type { Repo } from '../domain/repo.js'
import { generateConf, configHash, type GenOpts } from './generate.js'

export interface CmdResult { ok: boolean; output: string }
export interface ApplyDeps {
  repo: Repo
  paths: { staging: string; live: string; backup: string }
  genOpts: GenOpts
  validate(confPath: string): Promise<CmdResult>
  restart(): Promise<CmdResult>
}
export type ApplyResult =
  | { applied: true }
  | { applied: false; stage: 'validate' | 'restart'; error: string }

export async function applyConfig(deps: ApplyDeps): Promise<ApplyResult> {
  const cfg = deps.repo.getConfig()
  writeFileSync(deps.paths.staging, generateConf(cfg, deps.genOpts))

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
