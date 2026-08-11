# Phase 4：容器、E2E 與 CI（Tasks 16-18）

> 前置：完成 [03-frontend.md](03-frontend.md)。指令在 repo 根目錄執行。

### Task 16: Dockerfile + s6-overlay + compose

**Files:**
- Create: `docker/Dockerfile`, `docker/docker-compose.yml`
- Create: `docker/rootfs/etc/s6-overlay/s6-rc.d/rsyslogd/{type,run}`, `docker/rootfs/etc/s6-overlay/s6-rc.d/fanout-server/{type,run}`, `docker/rootfs/etc/s6-overlay/s6-rc.d/user/contents.d/{rsyslogd,fanout-server}`
- Create: `docker/rootfs/etc/rsyslog-bootstrap.conf`（rsyslogd 首次啟動、live.conf 尚不存在時的空殼設定）
- Create: `.dockerignore`

**Interfaces:**
- Consumes: server 的 `dist/`（`npm run build`）、web 的 `dist/`、Task 10 `index.ts` 的 restart 指令（`s6-svc -r /run/service/rsyslogd`）。
- Produces: image `rsyslog-fanout`；容器啟動後 `:8080` WebUI、published 埠範圍收 syslog。

- [ ] **Step 1: 撰寫 Dockerfile（multi-stage）**

`docker/Dockerfile`：

```dockerfile
FROM node:20-slim AS web-build
WORKDIR /build
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:20-slim AS server-build
WORKDIR /build
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build && npm prune --omit=dev

FROM debian:bookworm-slim
ARG S6_OVERLAY_VERSION=3.2.0.2
RUN apt-get update && apt-get install -y --no-install-recommends \
      rsyslog nodejs xz-utils ca-certificates && \
    rm -rf /var/lib/apt/lists/*
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz /tmp
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-x86_64.tar.xz /tmp
RUN tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz && tar -C / -Jxpf /tmp/s6-overlay-x86_64.tar.xz && rm /tmp/*.xz
COPY docker/rootfs/ /
COPY --from=server-build /build/dist /app/server/dist
COPY --from=server-build /build/node_modules /app/server/node_modules
COPY --from=server-build /build/package.json /app/server/package.json
COPY --from=web-build /build/dist /app/web/dist
ENV FANOUT_DATA_DIR=/data
EXPOSE 8080 514/udp 514/tcp
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/init"]
```

注意：debian 的 `nodejs` 版本較舊，改用 nodesource 安裝 Node 20：把 `nodejs` 從 apt 清單拿掉，加：

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends curl gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*
```

- [ ] **Step 2: s6 服務定義**

`docker/rootfs/etc/s6-overlay/s6-rc.d/rsyslogd/type`：`longrun`
`docker/rootfs/etc/s6-overlay/s6-rc.d/rsyslogd/run`：

```sh
#!/command/execlineb -P
foreground { if { test -f /data/rsyslog/live.conf } }
importas -D /etc/rsyslog-bootstrap.conf CONF CONF
/usr/sbin/rsyslogd -n -f /data/rsyslog/live.conf
```

上面 execline 寫法容易出錯，改用 shell 腳本（`#!/bin/sh` 亦可為 s6 run 檔）：

```sh
#!/bin/sh
CONF=/data/rsyslog/live.conf
[ -f "$CONF" ] || CONF=/etc/rsyslog-bootstrap.conf
exec /usr/sbin/rsyslogd -n -f "$CONF"
```

`docker/rootfs/etc/rsyslog-bootstrap.conf`（空殼：不監聽任何埠，只讓程序存活等待第一次套用）：

```
global(workDirectory="/data/queues")
```

`fanout-server/type`：`longrun`；`fanout-server/run`：

```sh
#!/bin/sh
cd /app/server
exec node dist/index.js
```

`user/contents.d/` 下建立空檔 `rsyslogd`、`fanout-server`（宣告兩服務開機啟動）。所有 `run` 檔 `chmod +x`。

- [ ] **Step 3: docker-compose.yml**

```yaml
services:
  fanout:
    build: { context: .., dockerfile: docker/Dockerfile }
    image: rsyslog-fanout
    container_name: rsyslog-fanout
    restart: unless-stopped
    environment:
      FANOUT_ADMIN_PASSWORD: ${FANOUT_ADMIN_PASSWORD:?請設定初始管理密碼}
      FANOUT_PORT_RANGE: "514,5140-5199"
    ports:
      - "8080:8080"
      - "514:514/udp"
      - "514:514/tcp"
      - "5140-5199:5140-5199/udp"
      - "5140-5199:5140-5199/tcp"
    volumes:
      - fanout-data:/data
volumes:
  fanout-data:
```

- [ ] **Step 4: 手動驗證**

```bash
cd docker && FANOUT_ADMIN_PASSWORD=devpass docker compose up -d --build
docker ps                                  # 預期 healthy
curl -s localhost:8080/api/health          # 預期 {"status":"ok"}
# 瀏覽器開 localhost:8080 → 登入 → 建 input(udp 514) + destination + route → 套用
logger -d -n 127.0.0.1 -P 514 "hello fanout"   # macOS/Linux 測試
```

- [ ] **Step 5: Commit**——`git add docker .dockerignore && git commit -m "feat: Docker image、s6-overlay 服務與 compose"`

---

### Task 17: E2E——透明轉發驗證 + Playwright UI 流程

**Files:**
- Create: `e2e/package.json`, `e2e/playwright.config.ts`, `e2e/tests/ui.spec.ts`
- Create: `e2e/scripts/transparency-test.sh`

**Interfaces:**
- Consumes: 運行中的容器（Task 16）、web UI 的 `data-test` 標記（Task 13/14）。
- Produces: 可在 CI 與本機重複執行的 E2E 驗證。

- [ ] **Step 1: 透明轉發位元組級驗證腳本**

`e2e/scripts/transparency-test.sh`（核心驗證：raw 模式下游收到的位元組與來源送出完全一致）：

```bash
#!/usr/bin/env bash
set -euo pipefail
# 前置：容器已啟動，且已透過 UI/API 設定 input(udp:514) → destination(udp:127.0.0.1:19999, raw) 並套用
MSG='<134>Aug 11 13:00:00 testhost myapp[123]: transparency check 唯一標記'
OUT=$(mktemp)
# 目的地模擬器：收 1 個 UDP 封包寫檔
( timeout 10 nc -u -l 19999 > "$OUT" & ) ; sleep 1
printf '%s' "$MSG" | nc -u -w1 127.0.0.1 514
sleep 2
RECEIVED=$(cat "$OUT")
if [ "$RECEIVED" = "$MSG" ]; then
  echo "PASS: 位元組級透明轉發驗證通過"
else
  echo "FAIL: 收到內容與來源不一致"; printf '送出: %s\n收到: %s\n' "$MSG" "$RECEIVED"; exit 1
fi
```

（destination host 設 `host.docker.internal`（mac/win）或 compose 加 `extra_hosts: ["host.docker.internal:host-gateway"]` 供 Linux——把這行加進 Task 16 的 compose。）

- [ ] **Step 2: Playwright 設定與 UI 流程測試**

```bash
mkdir e2e && cd e2e && npm init -y && npm i -D @playwright/test && npx playwright install chromium
```

`e2e/playwright.config.ts`：

```ts
import { defineConfig } from '@playwright/test'
export default defineConfig({
  use: { baseURL: 'http://localhost:8080', testIdAttribute: 'data-test' },
  retries: 1,
})
```

`e2e/tests/ui.spec.ts`：

```ts
import { test, expect } from '@playwright/test'

test.describe.serial('主流程', () => {
  test('登入 → 建立 input/destination/route → 套用 → tail 看到訊息', async ({ page }) => {
    await page.goto('/login')
    await page.getByPlaceholder('管理密碼').fill(process.env.FANOUT_ADMIN_PASSWORD ?? 'devpass')
    await page.getByRole('button', { name: '登入' }).click()
    await expect(page).toHaveURL('/')

    await page.goto('/inputs')
    await page.getByTestId('add').click()
    await page.getByTestId('name').fill('e2e-in')
    await page.getByTestId('port').fill('5150')
    await page.locator('form').press('Enter')
    await expect(page.getByText('e2e-in')).toBeVisible()

    await page.goto('/forwarding')
    await page.getByTestId('add-dest').click()
    await page.getByTestId('dest-name').fill('e2e-dest')
    await page.getByTestId('dest-host').fill('host.docker.internal')
    await page.getByTestId('dest-port').fill('19999')
    await page.locator('form').press('Enter')
    await page.locator('[data-test^="cell-"] input[type=checkbox]').first().check()
    await page.getByTestId('apply').click()
    await expect(page.getByText('套用成功')).toBeVisible({ timeout: 15000 })

    // 打一筆 log 進 5150，Live Tail 應看到
    // （由 CI 步驟或本機另開 shell 執行 send；測試內用 request 觸發輔助端點不可行——改由 exec）
    const { execSync } = await import('node:child_process')
    execSync(`printf '<134>e2e tail check' | nc -u -w1 127.0.0.1 5150`)
    await page.goto('/tail')
    await expect(page.getByText('e2e tail check')).toBeVisible({ timeout: 10000 })
  })
})
```

- [ ] **Step 3: 本機執行驗證**

```bash
cd docker && FANOUT_ADMIN_PASSWORD=devpass docker compose up -d --build && cd ..
npx --prefix e2e playwright test
bash e2e/scripts/transparency-test.sh   # 先用 UI 把 19999 目的地與 route 設好套用
```

預期：Playwright 綠、transparency PASS。

- [ ] **Step 4: 補視覺回歸截圖**——依全域 web 測試規範，於 `ui.spec.ts` 加 `await page.screenshot()` 於 Dashboard/Forwarding，viewport 1440 與 768 各一，存 `e2e/screenshots/`（gitignore，僅 CI artifact）。
- [ ] **Step 5: Commit**——`git add e2e docker && git commit -m "test: E2E 透明轉發驗證與 Playwright UI 流程"`

---

### Task 18: CI + README

**Files:**
- Create: `.github/workflows/ci.yml`, `README.md`, `README.zh-TW.md`, `LICENSE`（MIT）, `.gitignore`

**Interfaces:**
- Consumes: 全部前置任務的測試指令。
- Produces: push/PR 自動驗證；公開專案門面。

- [ ] **Step 1: CI workflow**

`.github/workflows/ci.yml`：

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:
jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci --prefix server && npm run --prefix server test:coverage
      - run: npm ci --prefix web && npx --prefix web vitest run && npm run --prefix web build
  e2e:
    runs-on: ubuntu-latest
    needs: unit
    steps:
      - uses: actions/checkout@v4
      - run: cd docker && FANOUT_ADMIN_PASSWORD=citestpw docker compose up -d --build
      - run: |
          for i in $(seq 1 30); do
            curl -sf localhost:8080/api/health && break; sleep 2; done
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci --prefix e2e && npx --prefix e2e playwright install --with-deps chromium
      - run: FANOUT_ADMIN_PASSWORD=citestpw npx --prefix e2e playwright test
      - run: FANOUT_ADMIN_PASSWORD=citestpw bash e2e/scripts/transparency-test.sh
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: e2e-artifacts, path: e2e/screenshots }
```

- [ ] **Step 2: README（英文為主檔，繁中為 README.zh-TW.md）**

兩份內容同構，必含章節：
1. 專案一句話（syslog fan-out with WebUI — transparent relay by default）+ 截圖（Dashboard）
2. Quick Start（三行：clone、設密碼、`docker compose up -d`）
3. 核心概念（Inputs / Destinations / Routes、raw vs standard 表頭模式）
4. 埠範圍限制說明（`FANOUT_PORT_RANGE` 與 compose ports 需一致、如何修改）
5. 已知限制：套用設定時 rsyslogd 重啟 <1s（UDP 瞬間封包遺失）、relay 封包來源 IP 為本工具 IP、TLS/RELP 尚未支援（roadmap）
6. 環境變數表、volume 說明、開發指南（server/web 分別 `npm run dev`）、License

- [ ] **Step 3: .gitignore**——`node_modules/`、`dist/`、`e2e/screenshots/`、`*.db`、`.DS_Store`。

- [ ] **Step 4: 本機最終驗證**

```bash
npm run --prefix server test:coverage    # ≥80%
npx --prefix web vitest run && npm run --prefix web build
cd docker && FANOUT_ADMIN_PASSWORD=devpass docker compose up -d --build && cd ..
npx --prefix e2e playwright test
```

- [ ] **Step 5: Commit**——`git add . && git commit -m "ci: GitHub Actions 與專案 README"`

---

## 完成定義（DoD）

- [ ] 全部單元/整合測試綠、server 覆蓋率 ≥80%
- [ ] `docker compose up -d` 後：登入 → 設定 input/destination/route → 套用 → 透明轉發位元組級驗證 PASS
- [ ] Playwright 主流程綠；Dashboard 顯示非零速率；Live Tail 即時看到測試訊息
- [ ] CI 兩個 job 全綠
- [ ] README（en/zh-TW）完整，含已知限制章節
