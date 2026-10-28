# 维修百事通 · 运维手册（Ops Runbook）

适用版本：v1.0.0　｜　更新日期：2026-10-27　｜　Owner：设备维护智能体项目组

## 1 系统概览

| 项 | 内容 |
| --- | --- |
| 形态 | 单进程 Python 标准库 HTTP 服务（无第三方依赖）+ 原生单页前端 + 单文件离线版 |
| 数据 | `data/` 只读数据包；`demo/runtime/` 运行数据（JSONL：工单、提交、异常、知识候选、审计日志） |
| 外部依赖 | 可选 OpenAI 兼容 LLM（`LLM_API_BASE/KEY/MODEL`），未配置时纯离线运行 |
| 端口 | 8787（`PORT` 可覆盖） |
| 健康检查 | `GET /api/health`（含版本、运行时长、请求数、错误数、提示词状态） |
| 审计日志 | `demo/runtime/audit.jsonl`，每请求一行 JSON |
| 版本 | `VERSION`；变更记录 `CHANGELOG.md` |

## 2 部署

### 2.1 Windows（答辩/演示）

1. 安装 Python 3.10+（勾选 Add to PATH）。
2. 双击 `启动维修百事通.bat`，浏览器打开 http://127.0.0.1:8787。
3. 智能体问答：http://127.0.0.1:8787/agent。
4. 停止：关闭“维修百事通服务”窗口。

### 2.2 Linux 服务器

```bash
python3 demo/server.py --host 0.0.0.0 --port 8787
# 建议 systemd 托管（示例）
sudo tee /etc/systemd/system/weixiu.service >/dev/null <<'EOF'
[Unit]
Description=Weixiu Baishitong
After=network.target
[Service]
WorkingDirectory=/opt/weixiu
ExecStart=/usr/bin/python3 demo/server.py --host 0.0.0.0 --port 8787
Restart=always
RestartSec=3
Environment=PORT=8787
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now weixiu
```

### 2.3 Docker / Compose

```bash
docker compose up -d --build
curl -fsS http://127.0.0.1:8787/api/health | python3 -m json.tool
```

挂载 `./demo/runtime` 持久化运行数据；容器已配置 HEALTHCHECK 与日志轮转。

## 3 配置

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| PORT | 8787 | 监听端口 |
| LLM_API_BASE / LLM_API_KEY / LLM_MODEL | 空 | 三者齐全才启用在线生成；失败自动回退离线 |
| WXBST_PROMPTS_DIR | <项目根>/prompts | 提示词资产目录 |
| EMBED_API_BASE / EMBED_API_KEY / EMBED_MODEL | 空 | 可选远端 Embedding（OpenAI 兼容 /embeddings）；未配置用离线哈希向量 |
| LLM_API_BASE / LLM_API_KEY / LLM_MODEL | 空 | 可选大模型生成；失败自动回退离线 |

安全限制（服务端常量）：请求体 ≤256 KB、message/reply ≤2000 字符、单 IP 600 请求/分钟；响应带 nosniff、Referrer-Policy、X-Frame-Options、HTML 页面 CSP。

## 4 监控与告警

- **健康检查**：每 30 s 调用 `GET /api/health`，非 200 或 `status!=ok` 告警。
- **关键指标**：`requests`、`errors`、`uptimeSec`；audit.jsonl 中 `status>=400` 比例。
- **SLO 建议**：可用性 ≥99.5%/月；问答 p95 ≤300 ms（离线）；5xx 比例 <0.5%。
- **日志**：stderr 访问日志 + audit.jsonl；容器日志按 10 MB×3 轮转。
- **磁盘**：runtime JSONL 按月归档；audit 日志建议每日切割、保留 90 天。

## 5 备份与恢复

- 备份对象：`data/`（只读知识包）、`demo/runtime/*.jsonl`、`prompts/`、`VERSION`。
- 低频备份：`tar czf backup-$(date +%F).tgz data prompts demo/runtime VERSION`。
- 恢复：停服 → 解包覆盖 → 启动 → 健康检查 → 抽查问答/点检/工单链路。
- 回滚：保留上一版本 `VERSION` 与镜像 tag；Docker `docker compose down && docker compose up -d --build` 指定 tag。

## 6 故障处置（On-call）

| 现象 | 排查 | 处置 |
| --- | --- | --- |
| 服务启动失败，端口占用 | `netstat -ano | findstr 8787` / `ss -lntp` | 停止占用进程或改 `--port` |
| /api/health 500 | 查看 stderr 与 `demo/runtime` 权限 | 修复权限/数据文件后重启 |
| 问答返回“离线知识库不可用” | 检查服务进程、端口、CSP 控制台 | 重启服务；确认前端与 API 同源 |
| 数据加载警告（warnings 非空） | 检查 data JSON/JSONL 与交叉引用 | 修复数据；`python scripts/validate-data.py` |
| 提示词资产缺失 | 检查 `prompts/registry.yaml` 与 15 个文件 | 运行 `python scripts/test-prompts.py` |
| 请求 413/400 | 请求体/消息超限或 JSON 非法 | 客户端减小负载或修正 JSON |
| 请求 429 | 触发限流 | 降低频率或调整 `RATE_PER_MINUTE` |
| 审计日志缺失 | runtime 目录不可写 | 修复目录权限并重启 |

## 7 数据与知识治理

- 数据变更流程：采集/访谈 → 结构化 → 双人复核 → 更新 `approvedAt` → `python scripts/validate-data.py` → 回归 `python demo/evaluate_loop.py` → 发布。
- 知识候选：工单结案写入 `runtime/knowledge_candidates.jsonl`，由教师/管理员复核后进入 `data/knowledge.jsonl`。
- 安全关键条目（securityCritical）须安全员会签；危险场景变更必须补充评测用例。
- 示例数据仅用于教学与演示，生产使用前替换为真实手册与访谈。

## 8 发布检查清单（Release Checklist）

1. `VERSION` 与 `CHANGELOG.md` 更新。
2. `python demo/test_smoke.py` 通过。
3. `python demo/evaluate_loop.py` 70/70 且门禁全绿。
4. `python scripts/test-prompts.py` 通过。
5. `node scripts/verify-offline.mjs` 35 项通过。
6. `python scripts/industrial-check.py` 全绿并更新 `design/industrial-report.md`。
7. 重新构建两个单文件 HTML，Chrome 目检并更新截图。
8. 重新导出设计说明书 PDF，页面渲染检查。
9. 备份当前 runtime 与数据包，记录发布 tag。

## 9 安全说明

- 不存储个人敏感信息；会话仅保存在内存，工单/审计为本地文件。
- 提示词注入：外部文本只作证据；智能体拒答注入请求，危险请求先拦截。
- 不提供带电/带压/熔融金属/煤气等危险操作步骤；始终给停机断电挂牌上锁与转人工路径。
- 生产部署建议置于反向代理之后，启用 HTTPS、访问控制与统一日志。

## 本机大模型配置

- 项目根 `.env.local` 由服务启动时自动加载，已被 `.gitignore` 排除；当前配置 provider z（OpenAI 兼容）与 `deepseek-v4.1-flash`。
- 提交/打包前删除 `.env.local`，避免泄露 Key；无 Key 环境自动回退离线模式。
- 自定义网关证书链不完整时可设 `LLM_SSL_VERIFY=false`（仅本机可信网关使用）。
