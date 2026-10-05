#!/usr/bin/env bash
set -euo pipefail

# TLS 收、送端到端驗證。一條迴路同時涵蓋 TLS input、TLS destination 與憑證名稱驗證：
#
#   openssl s_client ──TLS──▶ input A ──▶ destination D1 ──TLS(verify, localhost)──▶ input B ──▶ destination D2 ──明文 UDP──▶ nc
#                              (tcp/5170)                                            (tcp/5171)   (host.docker.internal:19998)
#
# D1 連回同一個容器的 input B，所以不需要額外架 TLS 接收端。驗證四件事：
#   1. 未掛憑證時，套用會以 TLS_CERT_MISSING 被擋下
#   2. 掛上憑證後，訊息經兩段 TLS 仍 byte-identical 送達
#   3. D1 的憑證名稱改成不符的值後，訊息不會送達（名稱驗證確實生效）
#   4. 名稱改回來後又能送達（證明 3 的「不送達」是名稱驗證造成的，不是通路壞了）
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
LISTENER_PID=""

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

stop_listener() {
  [ -n "$LISTENER_PID" ] || return 0
  kill "$LISTENER_PID" 2>/dev/null || true
  wait "$LISTENER_PID" 2>/dev/null || true
  LISTENER_PID=""
}

cleanup() {
  local status=$?
  set +e
  stop_listener
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
  # listen_udp <outfile>：背景收 UDP 寫檔（最多 30 秒），用完以 stop_listener 收掉。
  # nc 的 -l 語法差異說明見 transparency-test.sh。
  local out="$1"
  stop_listener
  if [ "$(uname -s)" != "Darwin" ] && nc -h 2>&1 | grep -qE -- '-l[[:space:]]+-p'; then
    timeout 30 nc -u -l -p "$SINK_PORT" > "$out" &
  else
    timeout 30 nc -u -l "$SINK_PORT" > "$out" &
  fi
  LISTENER_PID=$!
  sleep 1
}

wait_for_content() {
  # wait_for_content <file> <fixed-string> <seconds>：輪詢到檔案出現該字串為止
  local file="$1" needle="$2" tries="$3" i
  for i in $(seq 1 "$tries"); do
    grep -qF -- "$needle" "$file" 2>/dev/null && return 0
    sleep 1
  done
  return 1
}

wait_for_input_a() {
  # 套用會重啟 rsyslogd；等 input A 的埠重新接受連線再送，避免送進還沒起來的監聽埠
  local i
  for i in $(seq 1 20); do
    nc -z localhost "$CONNECT_PORT" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "FAIL: input A (localhost:$CONNECT_PORT) 在 20 秒內未就緒" >&2
  return 1
}

send_tls() {
  # send_tls <message>：以 TLS 連到 input A，並驗證伺服器憑證由測試 CA 簽發
  # -quiet 隱含 -ign_eof（stdin 結束後仍掛著連線），加 -no_ign_eof 讓它送完就正常關閉
  printf '%s\n' "$1" | timeout 10 openssl s_client -connect "localhost:$CONNECT_PORT" \
    -CAfile "$WORK/ca.pem" -verify_return_error -quiet -no_ign_eof >/dev/null 2>"$WORK/s_client.err" \
    || { echo "FAIL: TLS 連線到 input A 失敗" >&2; cat "$WORK/s_client.err" >&2; return 1; }
}

apply_ok() {
  local res
  res=$(api POST /api/config/apply)
  [ "$(echo "$res" | jq -r '.success')" = "true" ] || { echo "套用失敗: $res" >&2; exit 1; }
  wait_for_input_a
}

create() {
  # create <kind> <json-body>：建立資源並印出 id；失敗時把 API 回應印到 stderr
  local res id
  res=$(api POST "/api/$1" "$2")
  id=$(echo "$res" | jq -r '.data.id // empty')
  [ -n "$id" ] || { echo "建立 $1 失敗: $res" >&2; return 1; }
  echo "$id"
}

echo "== 登入 =="
LOGIN_RES=$(api POST /api/auth/login "$(jq -nc --arg p "$ADMIN_PASSWORD" '{password:$p}')")
[ "$(echo "$LOGIN_RES" | jq -r '.success')" = "true" ] || { echo "登入失敗: $LOGIN_RES" >&2; exit 1; }

echo "== 確認容器內沒有既有的 TLS 檔案 =="
docker inspect "$CONTAINER" >/dev/null 2>&1 || { echo "找不到容器 $CONTAINER（可用 FANOUT_CONTAINER 指定）" >&2; exit 1; }
EXISTING=$(docker exec "$CONTAINER" sh -c "ls $TLS_DIR/ca.pem $TLS_DIR/cert.pem $TLS_DIR/key.pem 2>/dev/null || true")
if [ -n "$EXISTING" ]; then
  echo "容器 $CONTAINER 的 $TLS_DIR 已有 TLS 檔案；為避免覆蓋，請改用乾淨的容器執行本測試" >&2
  exit 1
fi

echo "== 建立 TLS input A (tcp/$INPUT_A_PORT) =="
INPUT_A=$(create inputs "$(jq -nc --argjson port "$INPUT_A_PORT" \
  '{name:"e2e-tls-in-a", protocol:"tcp", port:$port, enabled:true, tls:true}')")

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
INPUT_B=$(create inputs "$(jq -nc --argjson port "$INPUT_B_PORT" \
  '{name:"e2e-tls-in-b", protocol:"tcp", port:$port, enabled:true, tls:true}')")
LOOP_BODY=$(jq -nc --argjson port "$INPUT_B_PORT" \
  '{name:"e2e-tls-loop", protocol:"tcp", host:"localhost", port:$port, headerMode:"raw", enabled:true, tlsMode:"verify", tlsPeerName:null}')
DEST_LOOP=$(create destinations "$LOOP_BODY")
DEST_SINK=$(create destinations "$(jq -nc --arg host "$SINK_HOST" --argjson port "$SINK_PORT" \
  '{name:"e2e-tls-sink", protocol:"udp", host:$host, port:$port, headerMode:"raw", enabled:true}')")
for pair in "$INPUT_A:$DEST_LOOP" "$INPUT_B:$DEST_SINK"; do
  create routes "$(jq -nc --argjson i "${pair%%:*}" --argjson d "${pair##*:}" \
    '{inputId:$i, destinationId:$d, sourceFilter:null, facilities:null, maxSeverity:null}')" >/dev/null
done
apply_ok

echo "== 檢查 2：訊息經兩段 TLS 後 byte-identical 送達 =="
MSG='<134>Oct  5 13:00:00 testhost myapp[123]: tls loop check 唯一標記'
listen_udp "$WORK/out1"
send_tls "$MSG"
wait_for_content "$WORK/out1" "唯一標記" 15 || true   # 逾時就讓下面的比對報出實際收到的內容
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
listen_udp "$WORK/out2"
send_tls '<134>Oct  5 13:00:01 testhost myapp[123]: sent while name mismatched'   # 送進 input A 必須成功
sleep 6   # 「沒有送達」無法輪詢，只能等一段比檢查 2 實際耗時長的時間
if [ -s "$WORK/out2" ]; then
  echo "FAIL: 憑證名稱不符，訊息卻送達了: $(cat "$WORK/out2")"
  exit 1
fi
echo "PASS: 憑證名稱不符時訊息未送達"

echo "== 檢查 4：憑證名稱改回來後恢復送達 =="
api PUT "/api/destinations/$DEST_LOOP" "$LOOP_BODY" >/dev/null
apply_ok
listen_udp "$WORK/out3"
send_tls '<134>Oct  5 13:00:02 testhost myapp[123]: after-fix-marker'
# 檢查 3 那筆還留在 D1 的佇列裡，名稱修正後可能一併補送，所以只比對本次的標記
if ! wait_for_content "$WORK/out3" "after-fix-marker" 15; then
  echo "FAIL: 憑證名稱改回後訊息仍未送達；檢查 3 的結果可能是通路問題而非名稱驗證"
  printf '收到: %s\n' "$(cat "$WORK/out3")"
  exit 1
fi
echo "PASS: 憑證名稱修正後恢復送達"
