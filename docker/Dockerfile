FROM node:22-slim AS web-build
WORKDIR /build
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-slim AS server-build
WORKDIR /build
# better-sqlite3 含 binding.gyp，npm ci 仍會跑 node-gyp 的 configure 階段（即使最終用 bundled prebuild、不需真的編譯），
# node-gyp 本身仍需要 python3 才能執行，否則 npm ci 會直接失敗
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build && npm prune --omit=dev

FROM debian:bookworm-slim
ARG S6_OVERLAY_VERSION=3.2.0.2
ARG TARGETARCH

# debian bookworm 內建的 nodejs 套件版本過舊，改用 nodesource 安裝 Node（不用 apt 的 nodejs）。
# 版本用 22 而非 brief 原訂的 20：server 的 better-sqlite3@13.0.3 package.json 宣告 engines.node >=22，
# 其官方 prebuild 二進位在 Node 20 下實測會 segfault（在乾淨的 node:20-slim 容器裡就能重現，
# 與本專案的 s6/nodesource 設定無關），換成 Node 22 後即正常，且仍滿足 server/package.json 的 engines >=20。
RUN apt-get update && apt-get install -y --no-install-recommends \
      rsyslog xz-utils ca-certificates curl gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

# s6-overlay 官方 release 只提供 x86_64 / aarch64 兩種 arch tarball，依 buildx 的 TARGETARCH 對應下載
RUN case "${TARGETARCH}" in \
      amd64) S6_ARCH=x86_64 ;; \
      arm64) S6_ARCH=aarch64 ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac && \
    curl -fsSL -o /tmp/s6-overlay-noarch.tar.xz "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz" && \
    curl -fsSL -o /tmp/s6-overlay-arch.tar.xz "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-${S6_ARCH}.tar.xz" && \
    tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz && \
    tar -C / -Jxpf /tmp/s6-overlay-arch.tar.xz && \
    rm -rf /tmp/*.tar.xz

COPY docker/rootfs/ /
COPY --from=server-build /build/dist /app/server/dist
COPY --from=server-build /build/node_modules /app/server/node_modules
COPY --from=server-build /build/package.json /app/server/package.json
COPY --from=web-build /build/dist /app/web/dist

# s6-overlay 預設會清空容器環境變數再啟動被監督的服務，需明確保留才能讓 FANOUT_* 傳進 fanout-server
ENV S6_KEEP_ENV=1
ENV FANOUT_DATA_DIR=/data
EXPOSE 8080 514/udp 514/tcp
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/init"]
