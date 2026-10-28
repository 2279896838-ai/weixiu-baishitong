# 维修百事通 · 设备故障诊断与点检引导助手

> **项目负责人 / 著作权人**：张庆涛（日照职业技术大学 智能冶金系 工业互联网）
>
> **指导教师**：张海波　**团队成员**：刘宝硕、刘信泽
>
> 本仓库为**私有项目**。未经书面许可，不得复制、下载后重新上传、转载或用于商业用途；详见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。

面向**实训车间、智能冶金系与中小企业设备维护**场景：把设备说明书、维修手册与教师口述故障案例沉淀为知识库，提供故障现象问答（原因排序 + 排查步骤）、电子点检清单生成与填报、点检异常看板，以及工单流转与知识回流，实现"老师傅经验"的结构化留存与传承。

本仓库同时是**赛事提交作品**：可运行作品（本地服务 + 单文件离线版 + 局域网二维码）、设计说明书 PDF、提示词工程规范、实训数据包与演示源码。

## 产品化工程（R1 基线）

当前目标已切换为**可生产部署的产品化工程**，不再以提示词资产或离线演示为交付目标。R1 已落地“配置 + SQLite 持久化 + Token 鉴权 + 指标 + 部署基线”：

| 能力 | 落地 |
| --- | --- |
| 配置与校验 | [demo/config.py](demo/config.py)：WXBST_ENV/STORAGE/AUTH_MODE/API_TOKENS/TRUST_PROXY/HSTS，生产启动校验 |
| 数据持久化 | [demo/storage.py](demo/storage.py)：SQLite WAL + 事务 + schema_migrations + audit_log；旧 JSONL 自动迁移；jsonl 可回退 |
| 安全 | Token API 鉴权 + 角色（viewer/student/teacher/admin）；写接口仅 teacher/admin；401/403；请求 ID；HSTS；可信代理 |
| 可观测 | /api/ready、/api/metrics、/api/health（storage/config/authMode）、审计入库、JSON 访问日志 |
| 备份/恢复 | [scripts/backup_db.py](scripts/backup_db.py)、[scripts/restore_db.py](scripts/restore_db.py)、systemd backup timer |
| 部署 | [Dockerfile.prod](Dockerfile.prod)、[docker-compose.prod.yml](docker-compose.prod.yml)、[nginx 配置](deploy/nginx/wxbst.conf)、[systemd 单元](deploy/systemd/wxbst.service) |
| 验证 | [scripts/test-production.py](scripts/test-production.py)：**31/31 通过**；旧冒烟与工业门禁不回归 |

**关键入口**

~~~bash
python demo/server.py --port 8787          # 本地（SQLite）
python scripts/test-production.py          # 生产基础验收
cp .env.prod.example .env.prod             # 生产变量
docker compose -f docker-compose.prod.yml up -d --build
~~~

> 端口说明：本地服务固定为 **8787**；生产 compose 的 nginx 入口是 **8080**，需要 Docker Desktop/daemon 启动后才会监听。当前机器 daemon 未启动时 8080 会拒绝连接；本地调试可运行 python scripts/dev_redirect.py --port 8080 将 8080 以 302 跳转到 8787，生产环境不要使用该脚本。

**文档**

- [产品化基线盘点](design/productization-baseline.md)：代码结构、运行入口、现有边界与风险
- [R1 复盘与缺口](design/productization-round1.md)：改造清单、证据、R2 计划
- [生产部署与运维指南](docs/productization.md)：配置、Docker/systemd、备份恢复、安全与可观测

**已知边界（R2 优先）**：应用级登录/RBAC 与登录页、PostgreSQL/多实例、CI 生产门禁与镜像供应链、Prometheus/告警、压测与 SLO。当前生产访问由 nginx basic auth + Token API 保护；无应用登录页。

## 一、赛事提交材料

| 提交项 | 文件 / 方式 | 说明 |
| --- | --- | --- |
| 可运行作品①：本地服务 | 双击 [启动维修百事通.bat](启动维修百事通.bat) | 自动启动 http://127.0.0.1:8787 并打开浏览器 |
| 可运行作品②：单文件离线版 | [deliverables/维修百事通-离线演示.html](deliverables/维修百事通-离线演示.html) | 约 991 KB，双击即用；四功能，第 01 页签“智能体问答”（原故障问答，推荐评委体验） |
| 可运行作品③：智能体问答 | [deliverables/维修百事通-智能体问答.html](deliverables/维修百事通-智能体问答.html) | 约 350 KB 单文件；或服务版访问 http://127.0.0.1:8787/agent |
| 可运行作品③：局域网二维码 | [design/images/qr-access.png](design/images/qr-access.png) | 扫描访问本机 8787 端口；需与演示电脑同一局域网 |
| 设计说明书（PDF） | [deliverables/维修百事通-设计说明书.pdf](deliverables/维修百事通-设计说明书.pdf) | 21 页：业务场景、功能架构、工作流程、知识库与提示词、智能体与工业级就绪、测试记录 |
| 设计说明书（Word） | [design/设计说明书.docx](design/设计说明书.docx) | 可编辑源稿 |
| 提示词工程规范 | [deliverables/维修百事通-提示词工程规范-v1.0.docx](deliverables/维修百事通-提示词工程规范-v1.0.docx) / [.pdf](deliverables/维修百事通-提示词工程规范-v1.0.pdf) | 13 章、82 页、15 个提示词资产 |
| 演示源码与数据 | [demo/](demo/) / [data/](data/) | Python 标准库引擎、单页前端、构建脚本、实训数据包 |
| 在线演示（GitHub Pages） | https://2279896838-ai.github.io/weixiu-baishitong/ | 浏览器直接打开，单文件离线演示，无需安装 |
| 项目方案（报名用） | [deliverables/维修百事通-项目方案.pdf](deliverables/维修百事通-项目方案.pdf) / [.docx](deliverables/维修百事通-项目方案.docx) | 4 页，可直接上传到大赛“项目方案”附件；填写稿见 [design/报名表填写稿.md](design/报名表填写稿.md) |

> 说明：当前未部署公网固定地址。离线版是单文件 HTML，可上传任意静态托管获得公网链接；本地服务版适合答辩现场；二维码用于同一局域网的多设备体验。二维码中的 IP 以启动窗口显示的地址为准，可运行 python scripts/make-qr.py 重新生成。

## 二、访问与运行

### 2.1 本地服务版（答辩现场推荐）

~~~text
# 方式 A：双击 启动维修百事通.bat（自动开浏览器）
# 方式 B：命令行
python demo/server.py --port 8787
# 浏览器打开 http://127.0.0.1:8787
~~~

> 若访问 /agent 返回 `静态文件不存在: /agent`，说明 8787 端口仍由旧版服务占用。新版 `启动维修百事通.bat` 会先结束旧监听；也可运行 `停止维修百事通.bat` 后再启动。确认 GET /api/health 返回 version=1.1.0 后，再访问 /agent。

可选接入大模型（不设置则离线检索 + 结构化合成，功能完整）：

~~~text
set LLM_API_BASE=https://api.deepseek.com
set LLM_API_KEY=sk-xxx
set LLM_MODEL=deepseek-chat
python demo/server.py --port 8787
~~~

### 2.2 智能体问答（推荐演示）

服务版访问 http://127.0.0.1:8787/agent，或双击 deliverables/维修百事通-智能体问答.html。

智能体已**内嵌在主离线演示的第 01 页签“智能体问答”**（原故障问答）（服务版点击顶栏“智能体问答”或访问 /agent；也可单独打开 deliverables/维修百事通-智能体问答.html）。它把自然语言请求路由到本地工具：知识库诊断、排查引导、点检清单、异常看板、工单流转、设备台账；回答中显示工具调用轨迹、原因排序、处置步骤、风险与引用。可直接问：

- “连铸机结晶器液面老是波动，铸坯表面都乱了，什么原因？”
- “板坯连铸机日点检要做哪些项目？”
- “连铸结晶器液面波动，带我一步步排查”
- “看一下异常看板”

### 2.3 单文件离线版（评委随时体验）

直接双击 deliverables/维修百事通-离线演示.html。文件已内嵌 16 台设备、63 条知识、119 项点检、5 棵决策树与智能体问答页签，并用离线 API 垫片在浏览器端复现问答、引导、点检、看板、工单与智能体工具编排；数据保存在 localStorage，清空浏览器数据即可重置。

### 2.4 局域网二维码

服务启动后，扫描二维码即可在手机/平板访问（需同一局域网，且防火墙允许 8787 端口）。若本机 IP 变化：

~~~text
python scripts/make-qr.py 8787
~~~

### 2.5 公网部署建议

离线版是单文件 HTML，可直接上传到校园服务器、对象存储或任意静态托管，获得公网链接后生成二维码；不依赖后端，访问量不受服务器并发限制。

### 2.6 大模型与向量检索（可选）

系统默认完全离线也能用：

- **混合检索**：关键词 BM25 + 512 维字符哈希向量（63 条知识，开机构建索引）；离线无需 API Key。
- **远端向量**：配置 `EMBED_API_BASE` / `EMBED_API_KEY` / `EMBED_MODEL` 后调用 OpenAI 兼容 `/embeddings`，失败自动回退哈希向量。
- **大模型生成**：配置 `LLM_API_BASE` / `LLM_API_KEY` / `LLM_MODEL` 后启用；system prompt 由提示词运行时加载 WXBST-SYS-001 + WXBST-QA-001 渲染；调用失败自动回退离线合成。
- 是否启用不影响证据过滤、危险拦截与引用校验；`/api/health` 会返回 `vector` 与 `llm` 状态。

~~~text
set EMBED_API_BASE=https://api.deepseek.com
set EMBED_API_KEY=sk-xxx
set EMBED_MODEL=text-embedding-3-small
set LLM_API_BASE=https://api.deepseek.com
set LLM_API_KEY=sk-xxx
set LLM_MODEL=deepseek-chat
~~~

### 2.7 本机自定义模型 Z（与 DSH 同源）

本机已接入与当前 DSH 会话相同的自定义 provider **z**：

- 接口：OpenAI 兼容 `https://api.ap-sub.top/v1`
- 模型：`deepseek-v4.1-flash`
- 配置：项目根目录 `.env.local`（已被 `.gitignore` 排除，**不要随作品提交**）；服务启动时自动加载
- 实测：健康检查显示 `llm.enabled=true`、`llm.model=deepseek-v4.1-flash`；单次问答约 13–37 s，失败/超时自动回退离线
- 换用其他模型：修改 `.env.local` 的 `LLM_API_BASE / LLM_API_KEY / LLM_MODEL` 即可

> 提交或打包时请删除 `.env.local`，或将 Key 换成你自己的；没有 Key 的评委机器仍以离线模式完整运行。

### 2.8 回答渐进呈现

问答结论采用打字机式逐字呈现（约 2.2 s 内显示完，长答案按比例加速），点击结论可立即展开全部内容；随后依次显示原因/要点、处置步骤、风险与引用。在线、离线单文件行为一致。

## 三、功能与赛事任务对照

| 赛事要求 | 实现 | 入口 |
| --- | --- | --- |
| 故障现象问答（原因排序 + 排查步骤） | 检索知识条目 → 原因按概率排序（含依据与验证方法）→ 处置步骤（含安全确认）→ 引用来源 | 问答页；POST /api/chat |
| 电子点检清单生成与填报 | 按设备类别/频次生成 8 项清单，逐项 OK/异常/不适用 + 备注，提交后自动判定异常 | 点检页；/api/checklists/generate、/submit |
| 点检异常自动汇总看板 | 提交/异常/高风险/未闭环工单汇总，按类别分布、Top 设备、最近异常 | 看板页；GET /api/dashboard |
| 工单流转与知识回流（可选） | 异常建单 → 状态机（草稿→待确认→已派单→已受理→维修中→待验收→已闭环）→ 结案根因写入知识候选池 | 工单页；/api/workorders |
| 诊断推理树与多轮追问（进阶档） | 5 棵决策树（车床异响、加工中心刀轴、打印/激光、连铸液面、轧机振动），S0 现象→S1 安全确认→S2 分支→S3 结论，一次一问 | 问答页"进入排查引导"；/api/troubleshoot/answer |
| 知识库质量（考察亮点） | 63 条知识（含 28 条智能冶金 + 14 条通用设备）含 9 条教师口述（录音时间定位）、审核字段、质量评分卡 | data/knowledge.jsonl；docs/数据包说明.md |
| 智能体问答（Agent） | 自然语言 → 工具编排（知识诊断/排查引导/点检/看板/工单/台账），显示工具调用轨迹 | 顶栏“智能体问答”或 /agent；单文件离线版 |
| 智能冶金扩展（本轮新增） | 连铸机/加热炉/轧机/除尘风机/液压站/电弧炉 6 类设备、18 条知识、48 项点检、2 棵决策树；熔融金属/煤气/蒸汽/起重四类安全红线 | 问答页选"连铸机 CCM-1200"；data/ |
| 提示词工程化 | 15 个提示词资产启动时加载、版本与占位符校验，LLM 模式用 SYS-001+QA-001 渲染 system prompt | GET /api/prompts；demo/prompt_runtime.py |

## 四、目录结构

~~~text
data/                      实训数据包
  equipment.json           16 台设备（7 类实训 + 连铸/加热炉/轧机/除尘/液压/电弧炉/球磨机/回转窑/浓密机）
  knowledge.jsonl          63 条知识（17 类 × 3 条（ROL 4 条、GEN 14 条），9 条来自教师访谈）
  checklists.json          119 项点检（13 类日检各 8 项 + 3 类周检各 5 项）
  trees.json               5 棵排查决策树（63 个节点）
  eval_cases*.jsonl        78 条评测用例（16 基线 + 38 工程扩展 + 24 冶金/通用）
  interviews/              3 篇教师口述访谈整理稿
demo/                      离线演示源码（Python 标准库 + 原生前端）
  engine.py                检索、问答、引导、点检、看板、工单、知识回流
  server.py                HTTP API 与静态文件服务
  static/                  单页前端 + 智能体问答页（agent.html/css/js）；offline-shim.js 为单文件离线垫片
  build-offline.mjs        生成单文件离线演示
  build-agent-offline.mjs  生成单文件智能体问答
  test_smoke.py            端到端冒烟测试
design/                    设计说明书源稿、架构图、流程图、界面截图、二维码
deliverables/              提交文件（设计说明书 PDF、提示词规范、离线演示 HTML）
prompts/                   15 个提示词资产（按编号拆分，registry.yaml 登记）
scripts/                   装配、校验、抽取、离线验证、二维码生成脚本
docs/                      写作规范、数据与 API 契约、数据包说明、需求对照
templates/                 Word 样式模板
~~~

## 五、文档与数据规模

| 项目 | 规模 |
| --- | --- |
| 提示词工程规范 | 13 章、82 页（PDF 约 87 页）、中文 28,289 字（Word 计数 36,529）、83 张表格、14 个 JSON 块 |
| 提示词资产 | 15 个（WXBST-SYS/RTR/QA/TRG/CHK-001/CHK-002/DASH/WO/EXT/INT/RAG-QRY/RAG-RNK/FIX/SEC/EVL） |
| 设计说明书 | 21 页（含智能体问答、工业级就绪、5 张界面截图、二维码、测试记录） |
| 数据包 | 16 台设备、63 条知识、119 项点检、5 棵树 63 节点、78 条评测、3 篇访谈 |
| 离线演示 | 单文件约 991 KB，内嵌全部数据、离线 API 垫片与智能体问答页签 |
| 智能体问答 | 单文件约 350 KB，工具编排；服务器路由 /agent；在线/离线各 12 项自动验证 |
| 提示词运行时 | 启动加载 15 个资产（registry + 正文），/api/prompts 可查版本、哈希与占位符 |

## 六、验证记录

| 验证项 | 命令 | 结果 |
| --- | --- | --- |
| 端到端冒烟 | python demo/test_smoke.py | ALL SMOKE CHECKS PASSED（14 项：问答/危险拦截/点检/看板/工单/回流） |
| 扩展评测 | python demo/evaluate_loop.py | 78/78 通过；8 项门禁 100%（含注入/绕过/多轮/越界/智能冶金） |
| 提示词运行时 | python scripts/test-prompts.py | 15 个资产加载、版本/占位符/LLM system prompt 校验全部通过 |
| 评测集回归 | python demo/evaluate.py | 16/16 通过；意图/关键词/引用/危险拦截/结构 5 项 100%（详见 design/eval-report.md） |
| 离线垫片单测 | node scripts/verify-offline.mjs | ALL OFFLINE SHIM CHECKS PASSED（43 项，含绕过表达、注入拒答、连铸/液压问答与冶金安全拦截） |
| 单文件构建 | node demo/build-offline.mjs | 设备 16 / 知识 63 / 点检 119 / 树 5；产物约 991 KB |
| 浏览器渲染 | Chrome 打开离线 HTML | 标题、设备下拉、离线徽标、四页签正常；DOM 含 16 台设备编码 |
| 智能体问答验证 | node scripts/agent-smoke.mjs | 12/12 通过（在线 /agent 与离线单文件各跑一次：诊断/点检/引导/看板/工具轨迹） |
| 内嵌页签验证 | node scripts/embed-smoke.mjs | 5/5 通过（在线 / 与离线主演示第 01 页签各一次：iframe 加载、16 台设备、智能体回答） |
| 工业级就绪门禁 | python scripts/industrial-check.py | 53/53 通过（健康/API/校验/安全/审计/性能/数据/提示词/产物/文档；首轮 48/53，修复后全绿） |
| 静态服务 | GET /、/static/app.js、/static/style.css | 均 200 |
| 数据校验 | python scripts/validate-data.py | 0 错误（id/编号/访谈引用/mustCite 交叉校验） |
| 文档校验 | node scripts/validate.mjs | 标题树/JSON/表格/引用全部通过 |

## 七、生产与自迭代记录

1. **基线**：6 名撰写人按统一设定并行起草第 1–12 章，1 名一致性审计员全篇对账，总编合并修复跨章冲突。
2. **R1 评审**（提示词工程 / 维修 / 安全 / 编辑 4 视角）：修复安全红线、LOTO、空滤压差量级、水冷机理、Schema 与输出契约、置信度口径等 40+ 处。
3. **压缩与 R2**：压缩 2,700 字冗余；R2 四路核验修复输出契约、注入隔离、投毒过滤、safetyAck 等 9 条 P1。
4. **赛事对齐**：补 1.6 需求对照、2.7 实施路线、4.8 点检看板、5.6 知识库建设、11.6 实训全链路示例与 3 个新资产。
5. **工程化**：数据包、离线引擎、四页签前端、冒烟测试、单文件离线版与设计说明书；离线垫片按"构建—单测—浏览器渲染"循环迭代，修复 file:// 下 /api 路径解析问题后 23 项全部通过。
6. **排版**：Word 目录更新、表格列宽归一化、PDF 导出、页面渲染目检（设计说明书 21 页、规范 82 页）。
7. **R7 智能体内嵌离线演示**：把主演示原“故障问答”页签改为“智能体问答”并内嵌，离线构建把智能体单文件以 base64 + srcdoc 内嵌，在线用同源 iframe；嵌入模式自动隐藏智能体页头；新增 embed-smoke 5 项验证（在线/离线各一次）。
8. **R6 工业级加固**：新增审计日志、请求 ID、速率限制、请求体/消息上限、安全响应头（nosniff/Referrer-Policy/X-Frame-Options/CSP）、健康检查版本与指标、OpenAPI、运维手册、Docker 与 CI；工业级门禁 53 项首轮 48/53，修复 EngineError 字段、审计时序后 53/53 全绿。
8. **R5 智能体问答**：新增工具型智能体页面（在线 /agent + 单文件离线版），把知识诊断、排查引导、点检、看板、工单、台账封装为可审计工具；新增 12 项端到端验证（在线/离线各一次），主界面增加“智能体问答”入口，设计说明书补充智能体架构与截图。
8. **R4 智能冶金扩展**：新增连铸机、加热炉、精轧机、除尘风机、液压站、电弧炉 6 类设备与 18 条知识、48 项点检、2 棵决策树、16 条冶金评测；后续扩到 8 类、25 条知识与 20 条冶金评测；修复「精轧机」被误判为液压站、HYD 关键词过窄两处问题；同步离线垫片（43 项）、界面截图与设计说明书。
8. **R3 提示词工程化迭代**：新增提示词运行时（15 资产加载/校验/渲染/API），扩展 38 条评测用例（注入、绕过、多轮、越界）；评测基线 88.9%→修复意图误判、危险绕过表达、提示词泄漏后 **54/54 全通过**；同步离线垫片并新增 6 项验证，重建单文件与设计说明书。

## 八、再生成命令

~~~text
node scripts/assemble.mjs            # 合并规范源稿
node scripts/validate.mjs            # 结构/JSON/表格校验
node scripts/extract-prompts.mjs     # 抽取 15 个提示词资产
node demo/build-agent-offline.mjs    # 生成单文件智能体问答（主离线演示内嵌它，先构建）
node demo/build-offline.mjs          # 生成单文件离线演示（内嵌智能体问答）
node scripts/agent-smoke.mjs          # 智能体端到端验证（需先启动服务）
node scripts/embed-smoke.mjs          # 主应用内嵌智能体页签验证（需先启动服务）
python scripts/industrial-check.py    # 工业级就绪门禁（53 项）
node scripts/verify-offline.mjs      # 离线垫片单测
python scripts/test-prompts.py       # 提示词运行时自检
python demo/evaluate_loop.py         # 78 条扩展评测与门禁
python demo/test_smoke.py            # 端到端冒烟
pandoc design/设计说明书.md -f markdown -t docx --resource-path=design --reference-doc=templates/reference.docx -o design/设计说明书.docx
# 再用 LibreOffice Kit 将 docx 转为 PDF，并用 python scripts/fix-design-footer.py 修正页脚
~~~

## 九、工业级交付说明

| 项 | 内容 |
| --- | --- |
| 版本 | [VERSION](VERSION) = 1.0.0，变更见 [CHANGELOG.md](CHANGELOG.md) |
| 容器化 | [Dockerfile](Dockerfile)、[docker-compose.yml](docker-compose.yml)、[.env.example](.env.example)；`docker compose up -d --build` |
| 运维 | [docs/ops-runbook.md](docs/ops-runbook.md)：部署、监控、备份恢复、回滚、On-call、发布检查清单 |
| API 契约 | [docs/openapi.yaml](docs/openapi.yaml)；健康检查含版本/uptime/requests/errors/limits |
| 可观测 | 每请求审计 `demo/runtime/audit.jsonl`（requestId/method/path/status/durationMs/session/tool） |
| 安全 | 请求体 ≤256 KB、message ≤2000 字符、600 请求/分钟/IP、CSP 与安全响应头 |
| CI | [.github/workflows/ci.yml](.github/workflows/ci.yml)：数据、提示词、评测、离线垫片、构建、工业门禁 |

## 十、已知限制

- 未部署公网固定地址；单文件离线版可上传静态托管获得公网链接。
- 接入大模型需自备 OpenAI 兼容 API Key；未配置时使用离线检索与模板合成。
- 设备型号、手册条目与教师访谈为可替换样例，落地时按 docs/数据包说明.md 替换为系部真实资料。
- 看板与工单初始为空，需先完成一次点检异常提交才能看到完整闭环。
