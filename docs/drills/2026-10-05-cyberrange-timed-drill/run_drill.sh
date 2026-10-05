#!/bin/bash
# 演練腳本：背景流量（FortiOS 2 筆/秒 × 330 秒）+ 攻擊時間軸（SSH 暴力破解 burst 8/120s × 2，間隔 60s）
# 前置：udp_tap.py 的 2 個 recv（19101、19102）與 2 個 proxy（19110、19111 → FanOut input）已啟動，
#       FanOut 已建好 input / destination / route 並套用。細節見同目錄 README.md。
set -u
D="${DRILL_OUT:-$(cd "$(dirname "$0")" && pwd)/out}"
CR="${CYBERRANGE_BIN:-cyberrange}"
mkdir -p "$D"
date -u +%FT%TZ > "$D/t-start"
"$CR" gen --vendor fortinet --product fortios --version 7.4 --log-type traffic.forward \
  --count 660 --rate 2 --sink udp://127.0.0.1:19110 > "$D/gen-fortios.log" 2>&1 &
BG=$!
sleep 15
"$CR" gen --vendor linux --product openssh --version 9.x --log-type auth.failure \
  --burst 8/120s --repeat 2 --gap 60s \
  --param 'kind_weights={"invalid_user": 1}' --param src_pool=203.0.113.5 \
  --sink udp://127.0.0.1:19111 > "$D/gen-ssh.log" 2>&1
echo "ssh exit=$?" >> "$D/gen-ssh.log"
wait $BG; echo "fortios exit=$?" >> "$D/gen-fortios.log"
date -u +%FT%TZ > "$D/t-end"
