# 维修百事通 · 产品化改造 R1 复盘

- 日期：2026-10-27
- 版本：1.1.0
- 主题：生产部署、安全、数据持久化的最小闭环

## 1 本轮改造

| 能力 | 落地 |
| --- | --- |
| 配置中心 | demo/config.py：WXBST_ENV/STORAGE/AUTH_MODE/API_TOKENS/TRUST_PROXY/HSTS；启动校验，生产告警/错误 |
| 持久化 | demo/storage.py：SQLite WAL、事务、schema_migrations、streams/state_store/audit_log；旧 JSONL 自动导入；WXBST_STORAGE=jsonl 可回退 |
| 引擎接入 | Engine 自动读写 SQLite；序列状态入库；重启后工单/点检/异常/审计保持 |
| 安全 | Token 鉴权（viewer/student/teacher/admin）；写接口仅 teacher/admin；401/403；请求 ID；HSTS；可信代理 |
| 可观测 | /api/ready、/api/metrics；health 增加 storage/config/authMode；审计入库；JSON 访问日志开关 |
| 数据保护 | scripts/backup_db.py（在线备份 + sha256 + integrity_check + 保留）、restore_db.py、systemd backup timer；审计保留天数 |
| 部署 | Dockerfile.prod（非 root/只读根/健康检查）、docker-compose.prod、nginx 反向代理/basic auth/限流、systemd 单元、.env.prod 示例 |
| 验证 | scripts/test-production.py：31 项配置/存储/迁移/鉴权/指标/备份检查 |

## 2 验证证据

| 检查 | 结果 |
| --- | --- |
| python scripts/test-production.py | 31/31 通过（SQLite、迁移、重启持久化、Token 401/403、metrics、ready、audit、backup） |
| python demo/test_smoke.py | 全通过（JSONL 兼容） |
| python scripts/industrial-check.py | 53/53 通过（旧门禁未回归） |
| 实际 SQLite | demo/runtime/wxbst.db；health storage.backend=sqlite，schemaVersion=1 |
| 备份 | 生成 wxbst-*.db + .sha256，integrity=ok |

## 3 缺口（下一轮输入）

1. 应用级登录/RBAC 未完成：当前生产靠 nginx basic auth + Token API；无浏览器登录、会话、CSRF、用户表/权限管理。
2. 数据库规模化：SQLite 适合单实例；多实例/读扩展需 PostgreSQL 适配与连接池；迁移只有 v1，无 down migration/校验工具。
3. 可观测闭环：有 metrics 端点但无 Prometheus 抓取配置、告警规则、仪表盘、Tracing；访问日志尚未统一 JSON。
4. 部署硬化：镜像构建/扫描/SBOM、TLS 证书管理、secrets manager、备份异地/加密、蓝绿/回滚演练未做。
5. 数据治理：知识版本、审核发布、灰度、回滚；管理端 UI；导入校验；审计查询界面。
6. 前端产品化：登录态、401 跳转、CSRF、组织/角色；离线演示与产品模式需分层。
7. 测试与 SLO：生产 UI E2E、并发/长稳压测、SLO/错误预算、故障演练。

## 4 下一轮（R2）计划

- 用户表 + 登录/登出/会话 Cookie + CSRF + RBAC 中间件与登录页；Token 作为服务账号保留。
- CI 增加 test-production.py、compose config 校验、镜像构建；产出入门级 SBOM。
- 浏览器端 401 跳转与权限提示；管理端最小用户/角色管理。
- 将 audit_log 查询与保留策略做成运维脚本；增加 Prometheus 抓取示例与告警草案。
