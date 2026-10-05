# CyberRange 時間軸演練驗收（2026-10-05）

本專案結案條件 #1 的驗收紀錄：以 CyberRange 時間模型軸第 1 期（[CyberRange PR #1](https://github.com/huangalou/CyberRange/pull/1)，`--burst` / `--repeat` / `--gap`）跑一輪**有時間軸的持續演練**，經 FanOut 同時分流至 2 個目的地。

**結論：通過。** 676 筆日誌全數送達、內容 byte-identical、依 facility 分流正確、時間軸經轉發後偏差 ≤ 3.06 ms。

## 環境

| 項目 | 版本 / 設定 |
|---|---|
| FanOut | v1.1.2（`f430fc3`），Docker Desktop for Mac 上的 dev 容器，rsyslogd 8.2302.0 |
| CyberRange | `main` @ `30963c8`（含 PR #1 時間模型軸第 1 期） |
| 下游接收端 | 主機上 2 個 UDP 接收程式（`udp_tap.py recv`），模擬 2 台 SIEM |

## 劇本

一條 input 同時承載「背景流量」與「攻擊時間軸」，兩個目的地各取所需：

```
CyberRange ── FortiOS traffic.forward  2 筆/秒 × 330 秒（660 筆，local7.notice）──┐
           └─ OpenSSH auth.failure     burst 8/120s × 2、間隔 60s（16 筆，authpriv.info）─┤
                                                                                         ▼
                                                                         FanOut input  udp/5160
                                                              ┌──────────────┴──────────────┐
                                             route：無過濾                      route：facilities = [4, 10]
                                                              ▼                             ▼
                                          siem-a（全量，676 筆）              siem-b（僅 auth 類，16 筆）
```

SSH 暴力破解的節奏 `8/120s` 對應 Wazuh 內建規則 5712（120 秒內 8 次失敗）的觸發門檻；第二波在 60 秒靜默後重複，用來確認「波與波之間的靜默」也原樣保留。

FanOut 設定（皆 `headerMode: raw`）：

| 類型 | 名稱 | 內容 |
|---|---|---|
| Input | `drill-in` | udp/5160 |
| Destination | `siem-a` | udp → `host.docker.internal:19101` |
| Destination | `siem-b` | udp → `host.docker.internal:19102` |
| Route | `drill-in` → `siem-a` | 無過濾條件 |
| Route | `drill-in` → `siem-b` | `facilities: [4, 10]`（auth、authpriv） |

## 量測方法

CyberRange CLI 一次只能指定一個 sink，且內容隨機產生、無法重跑比對，因此在 CyberRange 與 FanOut 之間放一個**記錄代理**（`udp_tap.py proxy`）：逐筆記下送出的 payload 與時間後原樣轉送給 FanOut。下游兩個接收端（`udp_tap.py recv`）同樣逐筆記錄 payload 與收到時間。三方紀錄由 `analyze.py` 比對。

```bash
# 接收端（模擬 SIEM）與記錄代理
python3 udp_tap.py recv  19101 out/siem-a.jsonl &
python3 udp_tap.py recv  19102 out/siem-b.jsonl &
python3 udp_tap.py proxy 19110 out/sent-fortios.jsonl 127.0.0.1 5160 &
python3 udp_tap.py proxy 19111 out/sent-ssh.jsonl     127.0.0.1 5160 &

# 演練（約 5.5 分鐘）與分析
CYBERRANGE_BIN=~/Projects/CyberRange/engine/.venv/bin/cyberrange ./run_drill.sh
python3 analyze.py out
```

本目錄的 `run_drill.sh` 是實際執行版本把輸出路徑與 CyberRange 執行檔位置參數化後的結果，產生器參數未更動。

## 結果

演練時間：2026-10-05 07:48:30Z – 07:54:00Z（5 分 30 秒）。

| 檢查項目 | 結果 |
|---|---|
| 送出筆數 | FortiOS 660 + SSH 16 = 676 |
| `siem-a` 收到 | 676 筆，與全部送出內容 byte-identical，各串流順序與送出一致 |
| `siem-b` 收到 | 16 筆，恰為 SSH 串流且依序 byte-identical；FortiOS（local7）0 筆 |
| 遺失 / 重複 | 0 / 0 |
| 轉發延遲（代理送出 → 接收端收到） | `siem-a` p50 1.41 ms、p95 1.84 ms、max 3.86 ms；`siem-b` p50 1.63 ms、p95 2.07 ms、max 3.81 ms |
| FanOut 統計計數（演練前後差值） | input `udp:5160` submitted +676；`siem-a` processed +676；`siem-b` processed +16；failed 0、佇列 0 |

### 時間軸保真度

SSH 串流在 `siem-b` 收到的時間（相對演練開始）：

| 波次 | 收到時間（秒） | 相鄰間隔 |
|---|---|---|
| 第 1 波（8 筆） | 15、30、45、60、75、90、105、120 | 15.00 s ± 14 ms |
| 靜默 | — | 75.00 s（最後一筆的 15 s 間隔 + 60 s gap） |
| 第 2 波（8 筆） | 195、210、225、240、255、270、285、300 | 15.00 s ± 13 ms |

「送出間隔」與「`siem-b` 收到間隔」逐一相減，15 個間隔的最大偏差為 **3.06 ms**。也就是說，經 FanOut 轉發後，下游 SIEM 看到的事件節奏與 CyberRange 排定的節奏一致，frequency / timeframe 類偵測規則（如 Wazuh 5712）不會因為中間多一層 relay 而失真。

## 觀察與限制

- **來源 IP 顯示異常屬 Docker Desktop 行為。** 演練期間 Live Tail 與 Sources 頁顯示的來源 IP 為 `185.199.109.133`，並非主機位址。流量是由主機經 Docker Desktop for Mac 發布的 UDP 埠送進容器，rsyslog 的 `fromhost-ip` 回報的是容器看到的封包來源；推測該位址來自 Docker Desktop 的網路轉送層，本次未進一步查證，也未在 Linux 原生 Docker 上重測。轉發內容與計數不受影響。
- **兩個目的地都在同一台主機上。** 延遲數字反映的是本機 loopback / Docker 虛擬網路，不代表跨網段部署的延遲。
- **未接真實 SIEM。** 本次驗證的是 FanOut 的分流與時間保真；Wazuh 5712 在此節奏下確實觸發，已由 CyberRange PR #1 的 live-fire 驗收涵蓋。
- 演練用的 input / destination / route 已於驗收後刪除並套用，dev 容器回到空設定。
