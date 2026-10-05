"""演練用 UDP 探針：recv 模式當下游 SIEM 接收端，proxy 模式記錄送出內容後原樣轉送。

每個 datagram 寫一行 JSONL：{"t": 收到時的 epoch 秒, "hex": payload 十六進位}
"""
import json
import socket
import sys
import time


def main() -> None:
    mode, port, out_path = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    forward = (sys.argv[4], int(sys.argv[5])) if mode == "proxy" else None

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4 * 1024 * 1024)
    sock.bind(("0.0.0.0", port))
    out_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM) if forward else None

    with open(out_path, "a", buffering=1) as out:
        while True:
            data, _ = sock.recvfrom(65535)
            received_at = time.time()
            if out_sock is not None:
                out_sock.sendto(data, forward)
            out.write(json.dumps({"t": received_at, "hex": data.hex()}) + "\n")


if __name__ == "__main__":
    main()
