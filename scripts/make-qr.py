# -*- coding: utf-8 -*-
"""生成局域网访问二维码：python scripts/make-qr.py [端口] [输出路径]

自动探测本机局域网 IPv4，调用 api.qrserver.com 生成 520x520 二维码 PNG。
若本机无法联网，可改为手动把 URL 转成二维码图片。
"""
import os
import socket
import sys
import urllib.parse
import urllib.request

PORT = sys.argv[1] if len(sys.argv) > 1 else "8787"
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join("design", "images", "qr-access.png")

def lan_ip():
    candidates = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith("127.") and not ip.startswith("169.254."):
                candidates.append(ip)
    except Exception:
        pass
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(("8.8.8.8", 80))
        candidates.insert(0, sock.getsockname()[0])
        sock.close()
    except Exception:
        pass
    return candidates[0] if candidates else "127.0.0.1"

ip = lan_ip()
url = "http://%s:%s" % (ip, PORT)
api = "https://api.qrserver.com/v1/create-qr-code/?size=520x520&margin=16&data=" + urllib.parse.quote(url, safe="")
os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
try:
    with urllib.request.urlopen(api, timeout=20) as resp:
        data = resp.read()
    with open(OUT, "wb") as fh:
        fh.write(data)
    print("二维码已生成：%s" % OUT)
    print("访问地址：%s" % url)
except Exception as exc:
    print("二维码生成失败：%s" % exc)
    print("请手动为以下地址生成二维码：%s" % url)
    sys.exit(1)
