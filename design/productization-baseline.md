# 维修百事通 · 产品化基线盘点（R1 起点）

- 盘点时间：2026-10-27
- 目标：从“比赛演示/提示词资产交付”转为“可部署、可鉴权、可持久化、可运维”的产品化工程

## 1 代码结构与运行入口

| 层 | 位置 | 职责 | 现状 |
| --- | --- | --- | --- |
| HTTP 入口 | demo/server.py | 标准库 ThreadingHTTPServer，静态资源 + JSON API | 单进程；无优雅停机/多实例 |
| 领域引擎 | demo/engine.py（约 3800 行） | 检索、问答、引导、点检、看板、工单、知识候选 | 领域逻辑完整；运行时状态原为 JSONL |
| 检索 | engine._build_retrieval_index + demo/vector_store.py | BM25 + 512 维哈希向量；可选远端 Embedding | 已具备混合检索 |
| 提示词 | demo/prompt_runtime.py + prompts/ | 15 个 WXBST 资产加载/渲染 | 演示交付的一部分，非产品核心 |
| 前端 | demo/static/ | 控制台（4 页签）+ 智能体页 + 离线单文件构建 | 无登录态 UI；与离线构建耦合 |
| 数据 | data/*.json(l) | 设备 16、知识 63、点检 119、树 5、评测 76 | 只读数据包，无版本化发布流程 |
| 运行时 | demo/runtime/ | submissions/anomalies/workorders/knowledge_candidates JSONL + audit | 无事务、无 schema、无迁移 |
| 脚本 | scripts/、demo/*.mjs | 构建、评测、截图、工业门禁、冒烟 | 面向演示，不是生产测试 |
| 部署 | Dockerfile、docker-compose.yml | 单容器开发/演示 | 无反向代理、TLS、只读根、备份 |

**入口**

1. 本地：启动维修百事通.bat → python demo/server.py --port 8787
2. 直接：python demo/server.py --host 0.0.0.0 --port 8787
3. 容器：docker compose up -d --build（开发）
4. 健康：GET /api/health；页面：/、/agent

## 2 现有边界与生产风险

| 风险 | 说明 | 影响 |
| --- | --- | --- |
| 存储非事务 | JSONL 追加 + 原子写 state；多线程靠进程锁 | 崩溃/并发可能不一致；无法多实例 |
| 无 schema/迁移 | runtime 文件无版本，字段漂移不可控 | 升级不可回滚，数据治理困难 |
| 无应用鉴权 | 仅 IP 限流 + 安全响应头；无登录/RBAC | 生产不可直接暴露 |
| 配置分散 | 环境变量散落 server/engine/build | 部署易错，无启动校验 |
| 单进程 HTTP | ThreadingHTTPServer；无 drain/健康就绪区分 | 重启丢请求、不能水平扩展 |
| 部署原始 | 单 Dockerfile、无 nginx/TLS/备份/只读 FS | 不满足生产基线 |
| 可观测不足 | 审计 JSONL + 健康；无 metrics/ready/结构化日志 | 无法接入监控与告警 |
| 前端耦合 | localStorage 为离线演示；无登录态/CSRF | 产品化 UI 需改造 |
| 数据发布 | data 目录直接拷贝，无版本/审核发布 | 知识更新不可审计 |

## 3 目标架构（R1 范围）

- 接入层：nginx（TLS 终止、basic auth/SSO、限流、body 限制）→ 应用
- 应用层：Python 标准库 HTTP，Token API 鉴权 + 角色；请求 ID、结构化访问日志
- 数据层：SQLite WAL（运行时事务、schema_migrations、旧 JSONL 自动导入）；/data 持久卷；在线备份 + 定时备份
- 可观测：/api/health（存储/配置/鉴权/LLM/向量）、/api/ready、/api/metrics（Prometheus 文本）、audit_log 入库
- 部署：Dockerfile.prod（非 root、只读根、健康检查）、docker-compose.prod、systemd 单元、.env.prod 示例

## 4 轮次计划

| 轮次 | 主题 | 完成标准 |
| --- | --- | --- |
| R1 | 配置 + SQLite 持久化 + Token 鉴权 + 指标 + 部署基线 | test-production 31 项通过；旧冒烟/工业门禁不回归 |
| R2 | 应用级登录/RBAC + 管理端 + CI 生产门禁 | 浏览器登录、角色权限、CSRF、CI 跑生产测试 |
| R3 | 数据治理与规模化 | 知识版本/审核发布、PostgreSQL 适配、备份异地、压测与 SLO |
