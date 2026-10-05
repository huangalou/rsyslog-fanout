#!/usr/bin/env bash
set -euo pipefail

# TLS 收、送端到端驗證。一條迴路同時涵蓋 TLS input、TLS destination 與憑證名稱驗證：
#
#   openssl s_client ──TLS──▶ input A ──▶ destination D1 ──TLS(verify, localhost)──▶ input B ──▶ destination D2 ──明文 UDP──▶ nc
#                              (tcp/5170)                                            (tcp/5171)   (host.docker.internal:19998)
#
# D1 連回同一個容器的 input B，所以不需要額外架 TLS 接收端。驗證三件事：
#   1. 未掛憑證時，套用會以 TLS_CERT_MISSING 被擋下
#   2. 掛上憑證後，訊息經兩段 TLS 仍 byte-identical 送達
#   3. D1 的憑證名稱改成不符的值後，訊息不會送達（名稱驗證確實生效）
#
# 腳本會把測試用憑證放進容器的 /data/tls，結束時連同建立的 input / destination / route 一併清除。
# 為了不覆蓋真實憑證，容器內若已有 TLS 檔案會直接中止。
#
# 依賴：curl、jq、nc、openssl、docker。

BASE_URL="${BASE_URL:-http://localhost:8080}"
ADMIN_PASSWORD="${FANOUT_ADMIN_PASSWORD:-devpass}"
CONTAINER="${FANOUT_CONTAINER:-rsyslog-fanout}"
INPUT_A_PORT=5170                                         # 容器內的監聽埠（API 用）
INPUT_B_PORT=5171
CONNECT_PORT="${TLS_TEST_CONNECT_PORT:-$INPUT_A_PORT}"    # 主機端連到 input A 的埠（埠對映不同時覆寫）
SINK_PORT=19998
SINK_HOST="host.docker.internal"
TLS_DIR=/data/tls

for bin in curl jq nc openssl docker; do
  command -v "$bin" >/dev/null 2>&1 || { echo "缺少依賴指令: $bin" >&2; exit 1; }
done

WORK=$(mktemp -d)
JAR="$WORK/cookies"
CERTS_INSTALLED=0

api() {
  # api <method> <path> [json-body]
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -b "$JAR" -c "$JAR" -X "$method" -H 'Content-Type: application/json' -d "$body" "$BASE_URL$path"
  else
    curl -sS -b "$JAR" -c "$JAR" -X "$method" "$BASE_URL$path"
  fi
}

delete_by_name() {
  # delete_by_name <inputs|destinations> <name>：刪除時其 route 會連帶刪除（FK cascade）
  local kind="$1" name="$2" id
  id=$(api GET "/api/$kind" | jq -r --arg n "$name" '.data[] | select(.name==$n) | .id' | head -1)
  [ -z "$id" ] || api DELETE "/api/$kind/$id" >/dev/null
}

cleanup() {
  local status=$?
  set +e
  if [ -s "$JAR" ]; then
    delete_by_name inputs e2e-tls-in-a
    delete_by_name inputs e2e-tls-in-b
    delete_by_name destinations e2e-tls-loop
    delete_by_name destinations e2e-tls-sink
    api POST /api/config/apply >/dev/null
  fi
  if [ "$CERTS_INSTALLED" = "1" ]; then
    docker exec "$CONTAINER" rm -f "$TLS_DIR/ca.pem" "$TLS_DIR/cert.pem" "$TLS_DIR/key.pem"
  fi
  rm -rf "$WORK"
  exit "$status"
}
trap cleanup EXIT

listen_udp() {
  # listen_udp <outfile>：背景收 UDP 寫檔，10 秒後自行結束。nc 的 -l 語法差異說明見 transparency-test.sh。
  local out="$1"
  if [ "$(uname -s)" != "Darwin" ] && nc -h 2>&1 | grep -qE -- '-l[[:space:]]+-p'; then
    ( timeout 10 nc -u -l -p "$SINK_PORT" > "$out" & )
  else
    ( timeout 10 nc -u -l "$SINK_PORT" > "$out" & )
  fi
  sleep 1
}

send_tls() {
  # send_tls <message>：以 TLS 連到 input A，並驗證伺服器憑證由測試 CA 簽發
  # -quiet 隱含 -ign_eof（stdin 結束後仍掛著連線），加 -no_ign_eof 讓它送完就正常關閉
  printf '%s\n' "$1" | timeout 10 openssl s_client -connect "localhost:$CONNECT_PORT" \
    -CAfile "$WORK/ca.pem" -verify_return_error -quiet -no_ign_eof >/dev/null 2>"$WORK/s_client.err"
}

apply_ok() {
  local res
  res=$(api POST /api/config/apply)
  [ "$(echo "$res" | jq -r '.success')" = "true" ] || { echo "套用失敗: $res" >&2; exit 1; }
  sleep 1
}

echo "== 登入 =="
LOGIN_RES=$(api POST /api/auth/login "$(jq -nc --arg p "$ADMIN_PASSWORD" '{password:$p}')")
[ "$(echo "$LOGIN_RES" | jq -r '.success')" = "true" ] || { echo "登入失敗: $LOGIN_RES" >&2; exit 1; }

echo "== 確認容器內沒有既有的 TLS 檔案 =="
if docker exec "$CONTAINER" sh -c "ls $TLS_DIR/ca.pem $TLS_DIR/cert.pem $TLS_DIR/key.pem 2>/dev/null" | grep -q .; then
  echo "容器 $CONTAINER 的 $TLS_DIR 已有 TLS 檔案；為避免覆蓋，請改用乾淨的容器執行本測試" >&2
  exit 1
fi

echo "== 建立 TLS input A (tcp/$INPUT_A_PORT) =="
INPUT_A=$(api POST /api/inputs "$(jq -nc --argjson port "$INPUT_A_PORT" \
  '{name:"e2e-tls-in-a", protocol:"tcp", port:$port, enabled:true, tls:true}')" | jq -r '.data.id')
[ "$INPUT_A" != "null" ] && [ -n "$INPUT_A" ] || { echo "建立 input A 失敗" >&2; exit 1; }

echo "== 檢查 1：未掛憑證時套用須以 TLS_CERT_MISSING 被擋下 =="
APPLY_RES=$(api POST /api/config/apply)
CODE=$(echo "$APPLY_RES" | jq -r '.error.code')
[ "$CODE" = "TLS_CERT_MISSING" ] || { echo "FAIL: 預期 TLS_CERT_MISSING，實際: $APPLY_RES" >&2; exit 1; }
echo "PASS: 未掛憑證時套用被擋下"

echo "== 產生測試 CA 與 localhost 憑證，放進容器 =="
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -keyout "$WORK/ca-key.pem" -out "$WORK/ca.pem" \
  -subj "/CN=FanOut E2E CA" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -keyout "$WORK/key.pem" -out "$WORK/csr.pem" -subj "/CN=localhost" 2>/dev/null
printf 'subjectAltName=DNS:localhost\n' > "$WORK/ext.cnf"
openssl x509 -req -in "$WORK/csr.pem" -CA "$WORK/ca.pem" -CAkey "$WORK/ca-key.pem" -CAcreateserial \
  -days 2 -out "$WORK/cert.pem" -extfile "$WORK/ext.cnf" 2>/dev/null
CERTS_INSTALLED=1
for f in ca.pem cert.pem key.pem; do docker cp "$WORK/$f" "$CONTAINER:$TLS_DIR/$f" >/dev/null; done
[ "$(api GET /api/tls/status | jq -r '.data.serverCert.ready')" = "true" ] || { echo "FAIL: /api/tls/status 未回報憑證就緒" >&2; exit 1; }

echo "== 建立迴路：input B、destination D1（TLS verify → localhost）、D2（明文 UDP）與路由 =="
INPUT_B=$(api POST /api/inputs "$(jq -nc --argjson port "$INPUT_B_PORT" \
  '{name:"e2e-tls-in-b", protocol:"tcp", port:$port, enabled:true, tls:true}')" | jq -r '.data.id')
LOOP_BODY=$(jq -nc --argjson port "$INPUT_B_PORT" \
  '{name:"e2e-tls-loop", protocol:"tcp", host:"localhost", port:$port, headerMode:"raw", enabled:true, tlsMode:"verify", tlsPeerName:null}')
DEST_LOOP=$(api POST /api/destinations "$LOOP_BODY" | jq -r '.data.id')
DEST_SINK=$(api POST /api/destinations "$(jq -nc --arg host "$SINK_HOST" --argjson port "$SINK_PORT" \
  '{name:"e2e-tls-sink", protocol:"udp", host:$host, port:$port, headerMode:"raw", enabled:true}')" | jq -r '.data.id')
for pair in "$INPUT_A:$DEST_LOOP" "$INPUT_B:$DEST_SINK"; do
  api POST /api/routes "$(jq -nc --argjson i "${pair%%:*}" --argjson d "${pair##*:}" \
    '{inputId:$i, destinationId:$d, sourceFilter:null, facilities:null, maxSeverity:null}')" >/dev/null
done
apply_ok

echo "== 檢查 2：訊息經兩段 TLS 後 byte-identical 送達 =="
MSG='<134>Oct  5 13:00:00 testhost myapp[123]: tls loop check 唯一標記'
listen_udp "$WORK/out1"
send_tls "$MSG" || { echo "FAIL: TLS 連線到 input A 失敗"; cat "$WORK/s_client.err"; exit 1; }
sleep 3
RECEIVED=$(cat "$WORK/out1")
if [ "$RECEIVED" != "$MSG" ]; then
  echo "FAIL: 收到內容與來源不一致"
  printf '送出: %s\n收到: %s\n' "$MSG" "$RECEIVED"
  exit 1
fi
echo "PASS: TLS 收、送與名稱驗證（相符）通過"

echo "== 檢查 3：D1 的憑證名稱不符時，訊息不得送達 =="
api PUT "/api/destinations/$DEST_LOOP" "$(echo "$LOOP_BODY" | jq -c '.tlsPeerName="wrong.example"')" >/dev/null
apply_ok
while pgrep -f "nc -u -l.*$SINK_PORT" >/dev/null; do sleep 1; done   # 等檢查 2 的 nc（10 秒逾時）釋放埠
listen_udp "$WORK/out2"
send_tls '<134>Oct  5 13:00:01 testhost myapp[123]: must not arrive' || true
sleep 4
if [ -s "$WORK/out2" ]; then
  echo "FAIL: 憑證名稱不符，訊息卻送達了: $(cat "$WORK/out2")"
  exit 1
fi
echo "PASS: 憑證名稱不符時訊息未送達"
