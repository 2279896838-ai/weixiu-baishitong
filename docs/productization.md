# 维修百事通 · 产品化部署与运维指南

## 1 配置

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| WXBST_ENV | development | production 启用生产校验/告警 |
| WXBST_STORAGE | sqlite | sqlite（生产） / jsonl（兼容） |
| WXBST_DB_PATH | runtime/wxbst.db | SQLite 路径；容器内 /data/wxbst.db |
| WXBST_AUTH_MODE | off | token：API 需 Bearer Token |
| WXBST_API_TOKENS | 空 | token:role,...；role ∈ viewer/student/teacher/admin |
| WXBST_TRUST_PROXY | 1 | 是否信任 X-Forwarded-For（经 nginx 时开启） |
| WXBST_HSTS | 0 | HTTPS 下开启 HSTS |
| WXBST_AUDIT_RETENTION_DAYS | 30 | 启动时清理过期审计 |
| WXBST_LOG_FORMAT | text | json 输出结构化访问日志 |
| WXBST_PROMPTS_DIR | 项目/prompts | 提示词资产目录 |
| LLM_* / EMBED_* | 空 | 可选模型与远端向量；不配则离线 |

## 2 本地运行（SQLite）

~~~bash
python demo/server.py --port 8787
curl -s http://127.0.0.1:8787/api/health
curl -s http://127.0.0.1:8787/api/metrics
~~~
首次启动会把旧的 runtime/*.jsonl 自动导入 SQLite；旧文件保留只读，可人工清理。

## 3 Docker 生产

~~~bash
cp .env.prod.example .env.prod
python -c "import secrets; print(secrets.token_urlsafe(32))"
htpasswd -c deploy/nginx/.htpasswd admin
docker compose -f docker-compose.prod.yml up -d --build
curl -s http://127.0.0.1:8080/api/health
~~~
- 应用不暴露端口，只经 nginx；nginx 监听 127.0.0.1:8080，TLS 由宿主机/负载均衡终止。
- 生产 compose 使用只读根文件系统、tmpfs、cap_drop、非 root、/data 持久卷。
- 浏览器访问受 nginx basic auth 保护；API 可用 Token（WXBST_AUTH_MODE=token）。

> 端口：本地开发用 8787；生产 compose 的 nginx 入口为 8080（需 Docker daemon）。若只做本机演示，可运行 python scripts/dev_redirect.py --port 8080，把 8080 302 到 8787；生产不要使用该脚本。

## 4 systemd（非容器）

- 将代码放 /opt/wxbst，/etc/wxbst.env 写入生产变量；
- 安装 deploy/systemd/wxbst.service 与 wxbst-backup.timer；
- systemctl enable --now wxbst.service wxbst-backup.timer。

## 5 备份与恢复

~~~bash
python scripts/backup_db.py --db /data/wxbst.db --out /data/backups --keep 14
python scripts/restore_db.py --backup /data/backups/wxbst-....db --db /data/wxbst.db --force
~~~
- 备份使用 SQLite 在线 backup，输出 sha256 与 integrity_check；恢复前必须停服务。
- systemd timer 每日 03:15 执行；生产建议再同步到对象存储/异地并加密。

## 6 安全模型

- 接入层：nginx basic auth/SSO、TLS、限流、请求体限制；
- 应用层：Token 鉴权 + 角色；写接口 teacher/admin；请求 ID、HSTS、CSP、nosniff、X-Frame-Options；
- 数据层：SQLite WAL + 事务 + 审计入库；不记录密钥；密钥只放在环境/secret；
- 供应链：生产镜像建议固定 digest、扫描、生成 SBOM（R2 落地）。

## 7 可观测

- /api/health：status/mode/version/storage/config/authMode/vector/llm/stats；
- /api/ready：就绪探针（存储可用）；
- /api/metrics：Prometheus 文本（请求/错误/运行时长/存储行/知识条目/LLM 开关）；
- audit_log 表：request_id/method/path/status/duration/ip/user/role；
- WXBST_LOG_FORMAT=json 输出结构化访问日志。

## 8 已知边界（R1）

单实例 SQLite；无应用登录页（依赖代理 basic auth/Token）；无 Kubernetes/多副本；无 Prometheus 服务端配置与告警；知识管理 UI 与版本发布未完成。R2 优先应用登录/RBAC、CI 生产门禁、镜像供应链与压测。
