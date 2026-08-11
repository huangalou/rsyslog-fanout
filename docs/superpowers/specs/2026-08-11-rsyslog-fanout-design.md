# Rsyslog FanOut — 設計文件

- 日期：2026-08-11
- 狀態：已與使用者逐段確認核可
- 定位：公開開源專案（GitHub 第二個 public 作品），搭配 CyberRange 專案使用，亦可獨立作為 SOC/SIEM 環境的 syslog 分流工具

## 1. 目標與範圍

一個容器化的 syslog fan-out（一進多出轉發）工具：

- 以久經考驗的 **rsyslog** 作為收發引擎，工具本身不重造 syslog 收發輪子。
- 使用者透過 **WebUI** 管理接收（監聽埠）、轉發（目的地與路由規則）設定並監控狀態。
- 預設行為是**透明轉發（transparent relay）**：下游接收端收到與設備原始送出完全相同格式的 syslog（對齊現行 rhea 主機上 rsyslog fan-out 的效果）。
- `docker compose up -d` 一行即可部署，跨平台、不依賴宿主機發行版。

### 不在本版範圍（YAGNI）

- TLS / RELP 傳輸（列為後續版本方向）
- 多使用者與角色權限
- 內容 regex / 屬性比對等進階規則引擎
- `msg-only`（只送內文）表頭模式

## 2. 整體架構

```
┌─────────────────────── Docker 容器 ───────────────────────┐
│                                                           │
│  ┌──────────┐  產生設定檔    ┌────────────┐               │
│  │ Fastify   │──────────────▶│ rsyslogd   │◀── UDP/TCP    │
│  │ 管理服務  │  驗證+重啟     │  (引擎)    │    514, 5140+ │
│  │ +Vue SPA │◀──────────────│            │──▶ 轉發目的地  │
│  └────┬─────┘  impstats /    └────────────┘               │
│       │        loopback copy                              │
│  :8080 WebUI                                              │
│                                                           │
│  程序管理：s6-overlay（rsyslogd + node 兩個服務）          │
└───────────────────────────────────────────────────────────┘
   Volume: /data（SQLite 設定庫、產生的 conf、磁碟佇列、設定備份）
```

### 技術堆疊

| 層 | 選型 | 理由 |
|----|------|------|
| 引擎 | rsyslog（容器內建） | 背壓、磁碟佇列、斷線重送皆為現成且久經考驗 |
| 後端 | Fastify（Node 20 + TypeScript） | REST + WebSocket 即時推播自然；與使用者既有技術棧一致 |
| 前端 | Vue 3 + Vite SPA | build 後由 Fastify 服務靜態檔 |
| 儲存 | SQLite（存於 /data） | 設定的單一真相來源；容器重建不掉設定 |
| 程序管理 | s6-overlay | 單容器雙程序；rsyslogd 與管理服務解耦，互不牽連 |
| 基底 image | Debian slim + rsyslog + Node 20 | rsyslog 套件完整、模組齊全 |

### 容器埠限制（重要設計決策）

Docker 無法在執行期新增 port mapping。因此：

- compose 檔預先發布一個埠範圍（預設 `514/udp`、`514/tcp` 與 `5140-5199` UDP+TCP）。
- 環境變數 `FANOUT_PORT_RANGE` 告知管理服務可用範圍；WebUI 新增監聽埠時僅允許此範圍內的埠號。
- README 說明如何調整範圍（改 compose 後 `docker compose up -d` 重建）。

## 3. 設定資料模型（SQLite）

### Input（監聽埠）

| 欄位 | 說明 |
|------|------|
| id, name | 識別與顯示名稱 |
| protocol | `udp` / `tcp` |
| port | 埠號（限制於 FANOUT_PORT_RANGE） |
| enabled | 啟用開關 |

### Destination（轉發目的地）

| 欄位 | 說明 |
|------|------|
| id, name | 識別與顯示名稱 |
| protocol | `udp` / `tcp` |
| host, port | 目的地位址 |
| header_mode | `raw`（預設，透明轉發 `%rawmsg%`）/ `standard`（RFC3164 重寫，保留原始 timestamp/hostname） |
| enabled | 啟用開關 |

每個 destination 的 omfwd action 內建合理預設（不暴露給使用者調整）：disk-assisted queue、無限重試（`action.resumeRetryCount="-1"`）、佇列磁碟用量上限。

透明轉發的本質限制（README 明示）：訊息內容原樣保留，但封包層的來源 IP 是本工具的 IP——任何 relay 皆如此；下游若依 syslog 表頭內 hostname 判斷來源則不受影響。

### Route（轉發規則）

Input → Destination 多對多對應，每條規則可選過濾條件（不設即全轉）：

- 來源 IP / CIDR（`fromhost-ip`）
- facility（多選）
- 最低 severity

### Settings

管理員密碼雜湊（bcrypt）、來源斷訊閾值（預設 10 分鐘）等系統偏好。初始密碼由環境變數 `FANOUT_ADMIN_PASSWORD` 設定，登入後可改。

## 4. 設定套用流程

WebUI 修改先寫入 SQLite（草稿），按「套用設定」才生效：

1. **產生**：由 SQLite 產生 rsyslog conf 至暫存目錄。結構：每個 input 一個 ruleset（綁定監聽埠）；route 過濾條件編為 ruleset 內條件式；每個 destination 一個 omfwd action（帶佇列設定與 header_mode 對應的 template）。
2. **驗證**：`rsyslogd -N1 -f <暫存主檔>` 語法檢查；失敗即回傳錯誤至 UI，不碰現行設定。
3. **切換**：備份現行 conf → 換上新 conf → s6 重啟 rsyslogd。rsyslog 不支援熱載入新監聽埠，必須重啟；中斷 <1 秒，TCP 來源自動重連，UDP 該瞬間封包會遺失（rsyslog 本身特性，README 明示）。
4. **回滾**：rsyslogd 重啟後 5 秒內異常退出 → 自動還原備份並重啟，UI 顯示失敗原因。

UI 常駐「有未套用的變更」徽章。

## 5. 監控資料流

### 來源一：impstats

- rsyslog 每 10 秒輸出 JSON 統計至本機檔案；管理服務解析後存入記憶體環形緩衝區（保留 1 小時）。
- 支撐：**即時流量統計**（每 input 速率/累計、每 destination 成功/失敗、佇列深度）與**目的地連線狀態**（action suspended = 不可達，配佇列深度警示）。

### 來源二：loopback 複製流

- 每個 input ruleset 追加一個 action：以 JSON template（來源 IP、input 標籤、facility、severity、原始訊息）轉一份至 `127.0.0.1` 內部 UDP 埠，action 上設 ratelimit（預設 500 msg/s）保護管理服務。
- 管理服務據此提供：
  - **Live Tail**：最近 N 則環形緩衝 + WebSocket 推播（可依 input 過濾；無訂閱者時直接丟棄）。
  - **來源健康狀態**：維護「來源 IP → 最後收到時間」表，超過閾值標示疑似斷訊。

儀表板與 Live Tail 共用一條 WebSocket；前端斷線指數退避重連。

## 6. API 與前端頁面

### REST API（session cookie 驗證；統一 `success/data/error` envelope；zod 驗證輸入）

| 端點 | 用途 |
|------|------|
| `POST /api/auth/login`、`POST /api/auth/logout`、`PUT /api/auth/password` | 認證（login 具 rate limit） |
| `GET/POST/PUT/DELETE /api/inputs`、`/api/destinations`、`/api/routes` | 三實體 CRUD |
| `POST /api/config/apply` | 產生→驗證→切換→回滾 |
| `GET /api/config/status` | 未套用變更、上次套用結果 |
| `GET /api/stats/overview` | 儀表板初始資料 |
| `WS /api/ws` | stats 與 live tail 兩頻道推播 |
| `GET /api/health` | docker healthcheck |

### 前端頁面（5 頁）

1. **Dashboard**：流量趨勢圖、input/destination 狀態卡、未套用變更提示
2. **接收設定（Inputs）**：監聽埠 CRUD（埠號限制於範圍內）
3. **轉發設定（Destinations + Routes）**：目的地管理（含 header_mode，預設 raw）、input→destination 對應矩陣、過濾條件編輯
4. **Live Tail**：即時檢視、依 input 過濾、暫停/繼續
5. **來源狀態（Sources）**：來源 IP、最後收到時間、斷訊警示

## 7. 錯誤處理

- **API 層**：zod 驗證（埠號範圍、IP/CIDR、名稱長度）；統一 envelope；欄位級錯誤訊息。
- **設定套用**：驗證失敗與回滾均回傳 rsyslogd 實際錯誤輸出，不吞錯。
- **程序**：s6 監控 rsyslogd 異常自動重啟；管理服務故障不影響 rsyslogd 收發（轉發永遠優先存活）。
- **WebSocket**：前端指數退避重連，重連後重拉 `stats/overview` 對齊。
- **磁碟**：佇列設 maxdiskspace 上限，避免目的地長期斷線塞爆 /data。

## 8. 測試策略（覆蓋率目標 80%）

1. **單元測試（核心）**：conf 產生器 golden file 測試——給定設定內容，逐字比對產出 conf；涵蓋 raw/standard、有無過濾、多 route 組合。另測過濾條件轉譯與 zod schema。
2. **整合測試**：Fastify API + 記憶體 SQLite——CRUD、套用失敗路徑、auth。
3. **E2E**：docker compose 起真容器 → 腳本打 UDP/TCP syslog → netcat 模擬目的地驗證透明轉發位元組一致 → Playwright 走 UI 主流程（登入、建三實體、套用、Live Tail 見訊息）。
4. **CI**：GitHub Actions（公開 repo 標配）。

## 9. 已確認的關鍵決策紀錄

| 決策 | 選擇 |
|------|------|
| 核心引擎 | 容器化 + 內含 rsyslog，WebUI 管理設定（非自行實作收發引擎） |
| 協定 | UDP + TCP（TLS/RELP 後續版本） |
| 路由細緻度 | input→destination 對應 + 來源 IP/facility/severity 過濾 |
| 表頭處理 | 預設 raw 透明轉發（對齊 rhea 現況）；可選 standard 重寫 |
| 監控 | 流量統計、Live Tail、來源健康、目的地狀態（四項全做） |
| 驗證 | 單一管理帳號，環境變數給初始密碼 |
| 技術棧 | Fastify + TypeScript + Vue 3 + SQLite，單容器 s6-overlay |
