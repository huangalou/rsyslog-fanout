# Rsyslog FanOut Implementation Plan — 總覽

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打造一個容器化 syslog fan-out 工具：rsyslog 引擎 + Fastify/Vue WebUI，預設透明轉發（下游收到原始格式 syslog）。

**Architecture:** 單一 Docker 容器內以 s6-overlay 跑 rsyslogd 與 Node 管理服務。SQLite 為設定真相來源，管理服務產生 rsyslog conf（驗證→切換→回滾），並經 impstats 與 loopback 複製流提供監控。前端為 Vue 3 SPA，由 Fastify 服務靜態檔。

**Tech Stack:** Node 20 + TypeScript (ESM) / Fastify 4 / better-sqlite3 / zod / bcryptjs / @fastify/websocket / Vue 3 + Vite + Pinia + vue-router / Vitest / Playwright / Docker + s6-overlay / rsyslog (Debian slim)

**Spec:** `docs/superpowers/specs/2026-08-11-rsyslog-fanout-design.md`

## Global Constraints

- Node 20、TypeScript `strict: true`、ESM（`"type": "module"`）
- 測試覆蓋率目標 80%；單元/整合用 Vitest，E2E 用 Playwright
- 單檔 <800 行、函式 <50 行；不可變資料模式優先
- Commit 格式 `<type>: <描述>`（feat/fix/refactor/docs/test/chore/perf/ci），描述用繁體中文
- API 回應統一 envelope：`{ success: boolean, data: T | null, error: string | null }`
- 環境變數：`FANOUT_PORT_RANGE`（預設 `514,5140-5199`）、`FANOUT_ADMIN_PASSWORD`（初始密碼，必填）、`FANOUT_DATA_DIR`（預設 `/data`）、`FANOUT_HTTP_PORT`（預設 `8080`）、`FANOUT_TAIL_PORT`（預設 `15514`）、`FANOUT_STALE_MINUTES`（來源斷訊閾值，預設 `10`）、`RSYSLOGD_BIN`（預設 `rsyslogd`）
- `/data` 佈局：`fanout.db`、`rsyslog/{staging,live,backup}/fanout.conf`、`queues/`、`stats/impstats.json`
- 表頭模式僅 `raw`（預設）與 `standard`；來源過濾接受完整 IP 或 `/8`、`/16`、`/24` CIDR（轉為 startswith 前綴），其他遮罩拒絕並回明確錯誤
- severity 過濾語意：`maxSeverity` 為數值上限（syslog 數值越小越嚴重），`$syslogseverity <= maxSeverity`
- Live tail 保護：管理服務端 token bucket 限流 500 msg/s，超出即丟棄（達成 spec 的保護要求）

## 檔案結構（決策鎖定）

```
server/                       # Fastify 管理服務（TypeScript ESM）
├── package.json  tsconfig.json  vitest.config.ts
├── src/
│   ├── index.ts              # bootstrap（讀 env、開 db、起服務）
│   ├── app.ts                # buildApp() Fastify 工廠（可測試）
│   ├── env.ts                # 環境變數解析與 port range 解析
│   ├── lib/envelope.ts       # ok()/fail() 回應 helper
│   ├── db/db.ts              # better-sqlite3 開啟 + migration
│   ├── domain/types.ts       # 實體型別 + zod schemas
│   ├── domain/repo.ts        # CRUD repository（含 dirty 判定）
│   ├── rsyslog/generate.ts   # conf 產生器（純函式，golden test 核心）
│   ├── rsyslog/apply.ts      # 驗證→備份→切換→回滾（exec 可注入）
│   ├── monitor/impstats.ts   # impstats JSON 解析 + 環形緩衝
│   ├── monitor/tail.ts       # UDP 15514 listener + 來源健康 + 限流
│   ├── routes/auth.ts        # login/logout/password
│   ├── routes/crud.ts        # inputs/destinations/routes 通用 CRUD
│   ├── routes/config.ts      # apply/status
│   ├── routes/stats.ts       # stats overview
│   └── routes/ws.ts          # WebSocket（stats + tail 頻道）
└── test/                     # 對應各模組；golden/ 放 conf 快照
web/                          # Vue 3 SPA
├── package.json  vite.config.ts  index.html
├── src/
│   ├── main.ts  App.vue  router.ts
│   ├── api/client.ts         # fetch 包裝（envelope 解包）
│   ├── api/ws.ts             # WebSocket 客戶端（指數退避重連）
│   ├── stores/session.ts     # Pinia：登入狀態
│   ├── components/LineChart.vue  StatusCard.vue
│   └── pages/Login.vue  Dashboard.vue  Inputs.vue  Forwarding.vue  LiveTail.vue  Sources.vue
docker/
├── Dockerfile                # multi-stage：web build → server build → runtime
├── docker-compose.yml
└── rootfs/etc/s6-overlay/    # rsyslogd 與 node 服務定義
e2e/
├── playwright.config.ts  tests/ui.spec.ts
└── scripts/send-syslog.sh  capture-dest.sh  transparency-test.sh
.github/workflows/ci.yml
README.md  README.zh-TW.md
```

## 任務索引

| # | 任務 | 檔案 |
|---|------|------|
| 1 | server 鷹架 + envelope | [01-backend-foundation.md](01-backend-foundation.md) |
| 2 | domain 型別 + zod schemas | 同上 |
| 3 | SQLite db + repository | 同上 |
| 4 | rsyslog conf 產生器（golden tests） | 同上 |
| 5 | 套用流程（驗證/切換/回滾） | 同上 |
| 6 | env 解析 + auth 路由 | [02-backend-api.md](02-backend-api.md) |
| 7 | CRUD API + config API | 同上 |
| 8 | impstats 解析 + 統計 | 同上 |
| 9 | tail listener + 來源健康 | 同上 |
| 10 | WebSocket + bootstrap + health | 同上 |
| 11 | web 鷹架 + 登入 + api client | [03-frontend.md](03-frontend.md) |
| 12 | Dashboard + LineChart | 同上 |
| 13 | Inputs 頁 | 同上 |
| 14 | Forwarding 頁（destinations+routes） | 同上 |
| 15 | Live Tail + Sources 頁 | 同上 |
| 16 | Dockerfile + s6 + compose | [04-container-e2e-ci.md](04-container-e2e-ci.md) |
| 17 | E2E 透明轉發驗證 + Playwright | 同上 |
| 18 | CI + README | 同上 |

執行順序即編號順序；Task 11 起依賴 server API 形狀（各任務 Interfaces 區塊有明確契約）。
