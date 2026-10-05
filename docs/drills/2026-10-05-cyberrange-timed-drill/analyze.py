"""演練驗收分析：比對送出與兩個目的地收到的內容、時間軸與轉發延遲。"""
import json
import statistics
import sys
from collections import Counter
from pathlib import Path

D = Path(sys.argv[1])


def load(name):
    rows = [json.loads(line) for line in (D / f"{name}.jsonl").read_text().splitlines() if line]
    return [(r["t"], bytes.fromhex(r["hex"])) for r in rows]


sent_fortios, sent_ssh = load("sent-fortios"), load("sent-ssh")
siem_a, siem_b = load("siem-a"), load("siem-b")
sent_all = sent_fortios + sent_ssh
print(f"sent: fortios={len(sent_fortios)} ssh={len(sent_ssh)} total={len(sent_all)}")
print(f"recv: siem-a={len(siem_a)} siem-b={len(siem_b)}")

payloads = lambda rows: [p for _, p in rows]
check = lambda label, ok: print(f"[{'PASS' if ok else 'FAIL'}] {label}")

check("siem-a 收到的內容與全部送出內容 byte-identical（multiset）",
      Counter(payloads(siem_a)) == Counter(payloads(sent_all)))
check("siem-a 內各串流順序與送出順序一致",
      [p for p in payloads(siem_a) if p.startswith(b"<189>")] == payloads(sent_fortios)
      and [p for p in payloads(siem_a) if p.startswith(b"<86>")] == payloads(sent_ssh))
check("siem-b 只收到 SSH 串流，且依序 byte-identical", payloads(siem_b) == payloads(sent_ssh))
check("siem-b 沒有任何 FortiOS（local7）日誌", not any(p.startswith(b"<189>") for p in payloads(siem_b)))
check("送出內容無重複 payload（延遲配對前提）", len(set(payloads(sent_all))) == len(sent_all))

sent_at = {p: t for t, p in sent_all}
for name, rows in (("siem-a", siem_a), ("siem-b", siem_b)):
    lat = sorted((t - sent_at[p]) * 1000 for t, p in rows if p in sent_at)
    print(f"{name} 轉發延遲 ms: p50={statistics.median(lat):.2f} p95={lat[int(len(lat) * 0.95) - 1]:.2f} max={lat[-1]:.2f}")

t0 = sent_fortios[0][0]
print("SSH 時間軸（相對演練開始秒數；送出 → siem-b 收到）:")
recv_b = {p: t for t, p in siem_b}
for i, (t, p) in enumerate(sent_ssh):
    print(f"  #{i + 1:02d} sent={t - t0:7.2f}s recv={recv_b.get(p, float('nan')) - t0:7.2f}s")
gaps_sent = [b[0] - a[0] for a, b in zip(sent_ssh, sent_ssh[1:])]
gaps_recv = [b[0] - a[0] for a, b in zip(siem_b, siem_b[1:])]
print("SSH 送出間隔 s:", [round(g, 3) for g in gaps_sent])
print("siem-b 收到間隔 s:", [round(g, 3) for g in gaps_recv])
print(f"間隔最大偏差 ms: {max(abs(a - b) for a, b in zip(gaps_sent, gaps_recv)) * 1000:.2f}")
fg = [b[0] - a[0] for a, b in zip(sent_fortios, sent_fortios[1:])]
print(f"FortiOS 背景流量: 持續 {sent_fortios[-1][0] - t0:.1f}s, 平均間隔 {statistics.mean(fg) * 1000:.1f}ms")
