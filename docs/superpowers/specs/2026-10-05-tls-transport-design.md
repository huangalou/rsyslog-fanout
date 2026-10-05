# TLS 傳輸設計（2026-10-05）

> **審閱狀態：尚未經使用者核可。** 本設計在使用者不在場、已授權自主進行的情況下完成，正常流程中「逐段確認設計」的步驟改由本文件與對應 PR 承擔。所有需要使用者判斷的決策集中列在[待確認決策](#待確認決策)。

## 目標

讓 FanOut 在收、送兩端都能用 TLS 加密 syslog（RFC 5425 syslog-over-TLS），補上 README「已知限制」中的「尚未支援 TLS」。這是專案結案條件 #2。

成功標準：

1. TCP input 可啟用 TLS，設備以 TLS 連入；同一個容器內 TLS 與明文 input 可並存。
2. TCP destination 可啟用 TLS 送往下游，預設驗證對方憑證與名稱。
3. 未使用 TLS 的既有設定，升級後產生的 rsyslog 設定逐字不變、不需重新套用。
4. 私鑰不經過 WebUI / API。

不在範圍內：RELP、WebUI 本身的 HTTPS、input 端要求用戶端憑證（mTLS 驗證來源）、每個 destination 各自的 CA / 用戶端憑證、憑證自動更新。

## 實測依據

以下行為皆在 throwaway 容器（`rsyslog-fanout` image 加裝 `rsyslog-gnutls` / `rsyslog-openssl`，rsyslogd 8.2302.0）實測，探針腳本未收進 repo。

| 項目 | 結果 |
|---|---|
| `input(type="imtcp" ... streamDriver.name/mode/authMode)` 逐 input 設定 | gtls、ossl 皆可用；與明文 imtcp input 並存正常 |
| 明文連線打進 TLS 埠 | 握手失敗、連線被關閉，不會被當成日誌收下 |
| omfwd `x509/name` + `StreamDriverPermittedPeers` 與憑證名稱相符 | 兩種驅動皆送達 |
| 憑證由不受信任的 CA 簽發 | `x509/name`、`x509/certvalid` 皆拒絕；`anon` 送達 |
| 名稱不符 | 兩種驅動皆拒絕 |
| `x509/name` 但**未設** `StreamDriverPermittedPeers` | gtls 退回比對連線目標主機名；**ossl 不送達且不印任何錯誤** |
| 目標以 IP 連線、`PermittedPeers` 給 DNS 名稱 | 兩種驅動皆送達（比對對象是 PermittedPeers，與連線目標無關） |
| gtls 以 IP 作為 PermittedPeers、憑證含 IP SAN | 拒絕（gtls 只比對 DNSname 與 CN） |
| 伺服器憑證檔不存在 | `rsyslogd -N1` 只印錯誤訊息，不能依賴它擋下設定 |

## 設計

### 驅動：gtls

選 `gtls`（Debian 套件 `rsyslog-gnutls`）。兩種驅動功能都夠用，差別在出錯時的可診斷性：名稱不符時 gtls 會印出「peer name not authorized」與對方憑證的名稱清單，ossl 在部分情況完全沒有輸出。產生設定時一律明確寫出 `StreamDriverPermittedPeers`，不依賴任何驅動的預設行為。

### 憑證檔：掛載進容器，不經 API

TLS 檔案放在 `FANOUT_TLS_DIR`（預設 `${FANOUT_DATA_DIR}/tls`，即 `/data/tls`）：

| 檔案 | 用途 | 必要性 |
|---|---|---|
| `cert.pem`、`key.pem` | TLS input 的伺服器憑證與私鑰 | 有啟用的 TLS input 時必須兩者皆在 |
| `ca.pem` | 驗證 destination 憑證用的 CA bundle | 選用；不存在時用系統信任庫 `/etc/ssl/certs/ca-certificates.crt` |

理由：WebUI 只有 HTTP，私鑰經 API 上傳等於明文過網路；掛檔是 nginx、Traefik 等自架工具的慣例，也方便接 certbot 之類的外部更新流程。

`ca.pem` 存在時**取代**系統信任庫而非合併。需要同時信任公有 CA 與私有 CA 的人，自行把兩者串接成一個檔。

`cert.pem` / `key.pem` 存在時會設為 rsyslog 的全域預設憑證，因此 TLS destination 若要求用戶端憑證，rsyslog 會出示同一張。這是 rsyslog 全域設定的既有行為，本設計不另外提供開關。

### 資料模型

| 實體 | 新欄位 | 說明 |
|---|---|---|
| Input | `tls: boolean`（預設 `false`） | 僅 `protocol = tcp` 可為 `true` |
| Destination | `tlsMode: 'off' \| 'verify' \| 'anon'`（預設 `'off'`） | 僅 `protocol = tcp` 可非 `off` |
| Destination | `tlsPeerName: string \| null`（預設 `null`） | `verify` 模式下憑證須符合的名稱；`null` 表示用 `host` |

- `verify`：驗證憑證鏈與名稱（`x509/name`）。
- `anon`：只加密、不驗證對方身分，給自簽憑證的實驗環境用。UI 明確標示不安全。
- 用列舉而非兩個布林，避免「未啟用 TLS 卻要求驗證」這種無意義組合。
- `tlsPeerName` 存在的原因：SIEM 常以 IP 連線，而憑證簽給 DNS 名稱；gtls 不比對 IP SAN，沒有這個欄位時這種部署無法使用 `verify`。允許字元為主機名字元加 `*`（rsyslog 支援萬用字元）。

DB 以 `ALTER TABLE ... ADD COLUMN`（先查 `table_info`，冪等）加欄位，既有資料取預設值。API schema 的新欄位皆有預設值，舊的 API 呼叫方不需修改。

`configHash` 在新欄位為預設值時不把它們納入雜湊，升級前已套用的設定不會因為多了欄位被判定為「未套用變更」。

### 產生的 rsyslog 設定

只有在設定實際用到 TLS（有啟用的 TLS input，或有路由指向啟用中的 TLS destination）時才輸出 TLS 相關內容：

```
global(workDirectory="/data/queues" defaultNetstreamDriverCAFile="<ca>" defaultNetstreamDriverCertFile="<cert>" defaultNetstreamDriverKeyFile="<key>")

input(type="imtcp" port="6514" ruleset="rs_i1" streamDriver.name="gtls" streamDriver.mode="1" streamDriver.authMode="anon")

action(name="d1_i1" type="omfwd" target="siem.example.com" port="6514" protocol="tcp" StreamDriver="gtls" StreamDriverMode="1" StreamDriverAuthMode="x509/name" StreamDriverPermittedPeers="siem.example.com" template="t_raw" ...)
```

- `cert` / `key` 兩個全域參數只在兩個檔都存在時輸出。
- input 的 `authMode="anon"` 指的是不要求用戶端憑證；伺服器仍會出示自己的憑證供設備驗證。
- 產生器維持純函式：TLS 檔案路徑由呼叫端解析後經 `GenOpts.tls` 傳入，產生器不碰檔案系統。

### 套用前檢查

套用時若存在啟用的 TLS input，但 `cert.pem` 不存在或內容不是合法憑證、或 `key.pem` 不存在，直接回報錯誤碼 `TLS_CERT_MISSING`（帶目錄路徑），不產生設定、不重啟 rsyslogd。實測顯示 `rsyslogd -N1` 對這種情況不可靠，所以由 server 自己擋。server 只解析公開憑證，不讀取私鑰內容，因此「私鑰與憑證不成對」不在檢查範圍內。

### API 與 WebUI

- `GET /api/tls/status`：回報 TLS 目錄、是否有自訂 CA、伺服器憑證是否就緒，以及憑證的主體、SAN、到期日。只回報公開資訊，不回傳任何檔案內容。
- 新錯誤碼：`TLS_REQUIRES_TCP`、`TLS_CERT_MISSING`、`TLS_PEER_NAME_FORMAT`。
- 接收設定頁：表單加「TLS」勾選（非 tcp 時停用）；勾選時顯示伺服器憑證狀態，未就緒則提示要掛哪些檔；列表加 TLS 欄。
- 轉發設定頁：目的地表單加 TLS 模式選單（非 tcp 時停用）與「憑證名稱」欄位（僅 `verify` 時顯示）；列表加 TLS 欄。

### 容器

Dockerfile 加裝 `rsyslog-gnutls`。預設發布的埠不變；標準的 syslog-TLS 埠 6514 不在預設 `FANOUT_PORT_RANGE` 內，README 說明如何加入。

## 測試

- **單元（server）**：schema 驗證與預設值、DB 遷移（舊 schema 升級、重複開啟冪等）、repo 讀寫新欄位、產生器（TLS input / 各 TLS 模式 / 全域參數出現條件 / 無 TLS 時 golden 不變）、`configHash` 向後相容、套用前檢查、TLS 檔案解析與狀態、新路由。
- **單元（web）**：兩個表單的欄位連動、送出的 payload、狀態提示。
- **容器端到端**（`e2e/scripts/tls-test.sh`，進 CI）：現場產生 CA 與 `localhost` 憑證放進容器，建立迴路 `openssl s_client →（TLS）input A → destination（TLS verify → localhost）→（TLS）input B → 明文 UDP destination → nc`，驗證內容 byte-identical。一條迴路同時涵蓋 TLS 收、TLS 送與名稱驗證。另驗證憑證未就緒時套用回 `TLS_CERT_MISSING`。

## 已知限制（實作後寫進 README）

- 更換憑證檔後需重新套用設定（或重啟容器）才會生效。
- input 端不驗證用戶端憑證；要限制來源請用路由的來源過濾或網路層管控。
- 所有 destination 共用同一份 CA bundle 與同一張用戶端憑證。
- 仍不支援 RELP。

## 待確認決策

以下是我替你做的選擇，任何一項你不同意都可以在 PR 上直接改：

1. **範圍含收、送兩端。** 只做送出端比較省工，但號稱支援 TLS 的 relay 只能單向加密說不過去。
2. **憑證用掛檔，不做 UI 上傳。** 代價是設定 TLS input 需要動到容器的 volume。
3. **`anon` 模式有提供。** 它讓自簽環境能先跑起來，但也讓人有機會選到不驗證的模式。替代方案是完全不提供，強制所有人準備 CA。
4. **input 端不做用戶端憑證驗證。**
5. **`ca.pem` 取代而非合併系統信任庫。**
6. **驅動選 gtls。**
