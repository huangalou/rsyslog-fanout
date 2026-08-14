# Rsyslog FanOut

[English](README.md)

一個容器化的 syslog fan-out（一進多出轉發）工具，搭配 WebUI 管理——以久經考驗的 **rsyslog** 作為收發引擎。預設行為是**透明轉發（transparent relay）**：下游收到與設備原始送出**位元組級完全一致**的 syslog 內容。

![Dashboard](docs/images/dashboard.png)

## Quick Start

```bash
git clone https://github.com/huangalou/rsyslog-fanout.git && cd rsyslog-fanout
export FANOUT_ADMIN_PASSWORD=$(openssl rand -base64 12)
echo "管理密碼: $FANOUT_ADMIN_PASSWORD"   # 記下來,登入時要用
cd docker && docker compose up -d --build
```

開啟 `http://localhost:8080`，用上面設定的密碼登入，接著設定一個 input、一個 destination、一條 route，然後按下**套用（Apply）**。

## 核心概念

| 實體 | 說明 |
|---|---|
| **Input（接收）** | 監聽埠（`udp`/`tcp`），接收設備送來的 syslog。埠號須落在 `FANOUT_PORT_RANGE` 範圍內。 |
| **Destination（目的地）** | 轉發目標（`host:port`、`udp`/`tcp`），有一個**表頭模式**： |
| — `raw`（預設） | 透明轉發——原樣轉發 `%rawmsg%`，位元組級不變。 |
| — `standard` | 重寫表頭為 RFC 3164 格式，但保留原始 timestamp/hostname。 |
| **Route（路由規則）** | Input → Destination 的對應，可選過濾條件：來源 IP/CIDR、facility（多選）、最低 severity。不設過濾即全轉。 |

修改先存入 SQLite 作為草稿，在按下**套用**前不會影響實際收發。套用會產生新的 rsyslog 設定、驗證（`rsyslogd -N1`）、換上新設定並重啟 rsyslogd——若新設定啟動失敗會自動回滾。

## WebUI 語言

WebUI 支援雙語（英文 / 繁體中文）。初始語言依瀏覽器語言自動判斷（`zh*` → 繁體中文，其他 → 英文）；頂欄（與登入頁）的切換器可手動切換，選擇會存在 `localStorage`。

API 錯誤回應帶有穩定的機器可讀錯誤碼，讓 UI 依語系翻譯：

```json
{ "success": false, "data": null, "error": { "code": "PORT_OUT_OF_RANGE", "message": "Port 9999 is outside the allowed range (FANOUT_PORT_RANGE=514...)", "params": { "port": 9999, "range": "FANOUT_PORT_RANGE=514..." } } }
```

`message` 一律為英文（供 `curl` / 程式化使用）；WebUI 會把已知的 `code` 翻成當前語言。

## 埠範圍限制

Docker 無法在執行期新增 port mapping，因此可用的監聽埠範圍必須先在 `docker/docker-compose.yml` 中發布，並與環境變數 `FANOUT_PORT_RANGE` 保持一致——WebUI 只允許在此範圍內新增 input。

預設：`514/udp`、`514/tcp` 與 `5140-5199`（UDP+TCP）。

如需新增埠：

1. 編輯 `docker/docker-compose.yml`，在 `ports:` 底下新增埠號（例如 `9000-9010:9000-9010/udp`）。
2. 同步更新 `FANOUT_PORT_RANGE`，例如 `"514,5140-5199,9000-9010"`。
3. 執行 `docker compose up -d --build` 重建容器以套用新的 port mapping。

## 整合範例：CyberRange

FanOut 與 [CyberRange](https://github.com/huangalou/CyberRange)（catalog 驅動的日誌產生器，用於 SIEM 偵測規則驗證）天然成對：把 CyberRange 的 UDP sink 指向 FanOut 的 input，FanOut 便能將日誌流透明分流到一個或多個 SIEM。

```bash
# 1. 在 WebUI 建立 Input（例如 udp/5160）、每個 SIEM 一個 Destination
#   （headerMode: raw）、一條 Route 串起來，然後 Apply。

# 2. 對 input 發射具真實廠牌樣態的日誌：
cyberrange gen \
  --vendor fortinet --product fortios --version 7.4 --log-type traffic.forward \
  --count 1000 --rate 50 --sink udp://<fanout-host>:5160
```

已完成端到端實測（2026-08-15）：CyberRange 產生的 FortiOS key-value、CEF、RFC 3164 三種格式，經 FanOut 轉發後在下游接收端與送出內容 byte-identical（`headerMode: raw`），Live Tail 亦正確解析 facility/severity。

## 已知限制

- **套用設定時有小於 1 秒的中斷。** rsyslog 不支援熱載入新的監聽埠，因此套用設定必須重啟 rsyslogd（通常 <1 秒）。TCP 來源會自動重連；該瞬間傳輸中的 UDP 封包會遺失——這是 rsyslog 本身的特性，並非本工具的 bug。
- **relay 封包來源 IP。** 如同任何 relay，下游收到的封包在網路層的來源 IP 會是**本工具**的 IP，而非原始設備的 IP。若下游系統是依 syslog 表頭內的 hostname 欄位判斷來源，則不受此限制影響。
- **尚未支援 TLS / RELP。** 目前僅支援明文 UDP/TCP 傳輸；加密/可靠傳輸列為後續版本規劃。
- **WebUI 僅為 HTTP。** session cookie 已設 `httpOnly` + `sameSite=strict`，但**未**設定 `secure` flag，因為伺服器本身不終止 TLS。若需要 HTTPS（例如將 WebUI 開放給非受信任的內網以外環境），請在前方掛一個反向代理（nginx、Caddy、Traefik 等）並在該處終止 TLS。

## 環境變數

| 變數 | 預設值 | 說明 |
|---|---|---|
| `FANOUT_ADMIN_PASSWORD` | *（必填）* | 初始管理密碼；登入後可修改。 |
| `FANOUT_PORT_RANGE` | `514,5140-5199` | 逗號分隔的埠號/範圍清單，WebUI 只允許在此範圍內開新 input。須與 `docker-compose.yml` 中發布的埠一致。 |
| `FANOUT_STALE_MINUTES` | `10` | 來源 IP 沉默超過此分鐘數後，於 Sources 頁標示為疑似斷訊。 |
| `FANOUT_DATA_DIR` | `/data` | 存放 SQLite 設定庫、產生的 rsyslog conf、設定備份的目錄。 |
| `FANOUT_HTTP_PORT` | `8080` | 管理 WebUI/API 監聽埠。 |
| `FANOUT_TAIL_PORT` | `15514` | 僅供內部 loopback 使用的 UDP 埠，用於將收到訊息的副本串流至 Live Tail，不對外發布。 |
| `RSYSLOGD_BIN` | `rsyslogd` | rsyslogd 執行檔路徑（若不在 `PATH` 中時使用）。 |

**來源 IP 過濾**支援完整 IPv4 位址（例如 `10.0.0.5`）或 `/8`、`/16`、`/24` CIDR 前綴（例如 `10.0.0.0/16`）；其他遮罩長度會被驗證拒絕。

## Volume 說明

- `/data`（compose 檔中的具名 volume `fanout-data`）——SQLite 資料庫、產生的 rsyslog 設定、套用前的設定備份。這是設定的單一真相來源；若在意重建時不用重新輸入 input/destination/route，請備份此 volume。

## 開發指南

需要 **Node.js 22+**（server 的 `better-sqlite3@13` 依賴的官方預編譯二進位要求 Node ≥22）。

```bash
# 後端（Fastify + TypeScript），支援 hot reload
cd server && npm install && npm run dev

# 前端（Vue 3 + Vite），/api 會 proxy 到 localhost:8080
cd web && npm install && npm run dev
```

測試：

```bash
cd server && npm run test:coverage   # 單元 + 整合測試，覆蓋率門檻 ≥80%
cd web && npm test                   # component/單元測試
```

### End-to-end 測試

```bash
cd docker && FANOUT_ADMIN_PASSWORD=devpass docker compose up -d --build
cd ../e2e && npm install && npx playwright test
```

E2E 測試套件以 Playwright 覆蓋主要 UI 流程（登入、設定 input/destination/route、套用、dashboard/live-tail 斷言、各斷點響應式截圖），並另外執行 `e2e/scripts/transparency-test.sh`——一個位元組級驗證：送一則 syslog 訊息完整跑過 input → route → destination 這條管線，並斷言下游收到的位元組與送出時**完全一致**。這個「預設透明、不改動一個位元組」的保證是本專案的招牌賣點，因此驗證做到位元組級，而不只是「訊息有沒有送到」。

## License

[MIT](LICENSE) © 2026 susualou
