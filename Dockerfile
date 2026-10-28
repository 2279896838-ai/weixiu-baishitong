FROM python:3.12-slim

LABEL org.opencontainers.image.title="weixiu-baishitong" \
      org.opencontainers.image.version="1.0.0" \
      org.opencontainers.image.description="设备故障诊断与点检引导智能体（离线引擎 + 工具编排）"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8787

WORKDIR /app
COPY . /app

RUN mkdir -p /app/demo/runtime && chmod -R 755 /app/demo/runtime

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8787/api/health', timeout=3)"

CMD ["python", "demo/server.py", "--host", "0.0.0.0", "--port", "8787"]
