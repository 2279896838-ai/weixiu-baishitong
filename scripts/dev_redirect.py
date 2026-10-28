#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""本地开发便利：把 8080 跳转到 8787。

生产环境由 nginx 反向代理（docker-compose.prod.yml）监听 8080，不使用本脚本。
"""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    server_version = "WXBST-DevRedirect/1.0"

    def _redirect(self):
        host = (self.headers.get("Host") or "127.0.0.1:8080").split(":")[0]
        target = "http://%s:8787%s" % (host, self.path or "/")
        body = b"redirecting to " + target.encode("utf-8")
        self.send_response(302)
        self.send_header("Location", target)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_GET = _redirect
    do_HEAD = _redirect
    do_POST = _redirect
    do_PATCH = _redirect

    def log_message(self, fmt, *args):
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    httpd = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    print("dev redirect: http://127.0.0.1:%d -> http://127.0.0.1:8787" % args.port)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
