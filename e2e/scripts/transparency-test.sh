#!/usr/bin/env bash
set -euo pipefail

# 透明轉發位元組級驗證：raw 模式下游收到的位元組須與來源送出完全一致。
#
# 前置設定（input(udp:514) → destination(udp:host.docker.internal:19999, raw) → route，並套用）
# 依 task-17-brief 可用 UI 或 API 完成；本腳本用 curl 打 API 自行完成前置設定，
# 這樣腳本可獨立重複執行（不必依賴先跑過 Playwright），且對已存在的資源具備冪等性
# （重跑時會重用同名/同埠的既有 input/destination/route，不會建立重複資源或因埠號衝突而失敗）。
#
# 依賴：curl、jq、nc（BSD 或 GNU 皆可，見下方 OS 判斷）。

BASE_URL="${BASE_URL:-http://localhost:8080}"
ADMIN_PASSWORD="${FANOUT_ADMIN_PASSWORD:-devpass}"
INPUT_PORT=514
DEST_PORT=19999
DEST_HOST="host.docker.internal"

for bin in curl jq nc; do
  command -v "$bin" >/dev/null 2>&1 || { echo "缺少依賴指令: $bin" >&2; exit 1; }
done

JAR=$(mktemp)
OUT=$(mktemp)
cleanup() { rm -f "$JAR" "$OUT"; }
trap cleanup EXIT

api() {
  # api <method> <path> [json-body]
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -b "$JAR" -c "$JAR" -X "$method" -H 'Content-Type: application/json' -d "$body" "$BASE_URL$path"
  else
    curl -sS -b "$JAR" -c "$JAR" -X "$method" "$BASE_URL$path"
  fi
}

echo "== 登入 =="
LOGIN_RES=$(api POST /api/auth/login "$(jq -nc --arg p "$ADMIN_PASSWORD" '{password:$p}')")
[ "$(echo "$LOGIN_RES" | jq -r '.success')" = "true" ] || { echo "登入失敗: $LOGIN_RES" >&2; exit 1; }

echo "== 確保 input(udp:$INPUT_PORT) 存在 =="
INPUT_ID=$(api GET /api/inputs | jq -r --argjson port "$INPUT_PORT" \
  '.data[] | select(.protocol=="udp" and .port==$port) | .id' | head -1)
if [ -z "$INPUT_ID" ]; then
  INPUT_ID=$(api POST /api/inputs "$(jq -nc --argjson port "$INPUT_PORT" \
    '{name:"e2e-transparency-in", protocol:"udp", port:$port, enabled:true}')" | jq -r '.data.id')
fi
echo "input id=$INPUT_ID"

echo "== 確保 destination(udp:$DEST_HOST:$DEST_PORT, raw) 存在 =="
DEST_ID=$(api GET /api/destinations | jq -r --arg host "$DEST_HOST" --argjson port "$DEST_PORT" \
  '.data[] | select(.protocol=="udp" and .host==$host and .port==$port and .headerMode=="raw") | .id' | head -1)
if [ -z "$DEST_ID" ]; then
  DEST_ID=$(api POST /api/destinations "$(jq -nc --arg host "$DEST_HOST" --argjson port "$DEST_PORT" \
    '{name:"e2e-transparency-dest", protocol:"udp", host:$host, port:$port, headerMode:"raw", enabled:true}')" | jq -r '.data.id')
fi
echo "destination id=$DEST_ID"

echo "== 確保 route(input=$INPUT_ID → destination=$DEST_ID) 存在 =="
ROUTE_EXISTS=$(api GET /api/routes | jq -r --argjson i "$INPUT_ID" --argjson d "$DEST_ID" \
  '.data[] | select(.inputId==$i and .destinationId==$d) | .id' | head -1)
if [ -z "$ROUTE_EXISTS" ]; then
  api POST /api/routes "$(jq -nc --argjson i "$INPUT_ID" --argjson d "$DEST_ID" \
    '{inputId:$i, destinationId:$d, sourceFilter:null, facilities:null, maxSeverity:null}')" >/dev/null
fi

echo "== 套用設定 =="
APPLY_RES=$(api POST /api/config/apply)
[ "$(echo "$APPLY_RES" | jq -r '.success')" = "true" ] || { echo "套用失敗: $APPLY_RES" >&2; exit 1; }
echo "套用成功"
sleep 1

echo "== 透明轉發驗證 =="
MSG='<134>Aug 11 13:00:00 testhost myapp[123]: transparency check 唯一標記'

# 目的地模擬器：收 1 個 UDP 封包寫檔。macOS 的 nc（BSD 版）與 GNU netcat 的 -l 語法不同：
# BSD: nc -u -l <port>／GNU netcat-traditional: nc -u -l -p <port>。依 OS 分支選擇語法。
if [ "$(uname -s)" = "Darwin" ]; then
  ( timeout 10 nc -u -l "$DEST_PORT" > "$OUT" & )
else
  if nc -h 2>&1 | grep -q -- '-p'; then
    ( timeout 10 nc -u -l -p "$DEST_PORT" > "$OUT" & )
  else
    ( timeout 10 nc -u -l "$DEST_PORT" > "$OUT" & )
  fi
fi
sleep 1

printf '%s' "$MSG" | nc -u -w1 127.0.0.1 "$INPUT_PORT"
sleep 2

RECEIVED=$(cat "$OUT")
if [ "$RECEIVED" = "$MSG" ]; then
  echo "PASS: 位元組級透明轉發驗證通過"
else
  echo "FAIL: 收到內容與來源不一致"
  printf '送出: %s\n收到: %s\n' "$MSG" "$RECEIVED"
  exit 1
fi
