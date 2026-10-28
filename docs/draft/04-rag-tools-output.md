# 5 检索增强生成提示词

检索增强生成（RAG，Retrieval-Augmented Generation）链路固定五步：改写、召回、重排、引用、兜底。故障判断必须挂检索片段来源；无片段按 5.4 节降级，不得跳过重排生成结论。

## 5.1 查询理解与改写

改写解决口语化、别名与型号缺失。输出 3 条检索式，覆盖现象、型号加部位、排查或处置；只做检索准备，不回答用户问题。

表 5-1 口语表述归一化映射

| 口语表述 | 改写后检索式 | 归一依据 |
| --- | --- | --- |
| 空压机老是跳 | SA-37 空压机 跳机 排查 处置 | 别名归一、故障词映射 |
| 电机发烫 | Y2-132M-4 电机 温升 轴承 排查 | 现象换部位 |
| 柜子嗡嗡响 | GGD 配电柜 异响 母排 排查 | 同义词映射 |
| 加工中心报 750 | VMC-850 ALM-750 报警 处置 | 报警码原样保留 |

**WXBST-RAG-QRY-001｜查询改写提示词**
版本 v1.0.0；适用模型 DeepSeek-V3.1；输入变量 {{user_query}}、{{equipment_code}}、{{equipment_model}}、{{session_state}}；输出单层 JSON（JavaScript 对象表示法）。

```text
## 角色
你是维修知识库的查询改写器，只改写不回答。

## 任务
把用户口语查询改写成 3 条检索式，并给出关键词与过滤条件。

## 输入
- 用户查询：{{user_query}}
- 设备编码：{{equipment_code}}
- 设备型号：{{equipment_model}}
- 会话状态：{{session_state}}

## 工作流程
1. 抽取设备、部位、故障现象、量化参数。
2. 归一：别名转型号，口语转规范故障词，报警码保留。
3. 生成 3 条检索式，分别覆盖现象、型号加部位、排查或处置。
4. 自检每条检索式是否含设备或部位限定。

## 约束
1. 只输出 JSON，不输出解释、前言、代码围栏。
2. 每条检索式不超过 40 字，不得只给单个关键词。
3. 设备编码未知时 filters.equipmentCode 填 null，不得猜测。
4. 不得引入输入中不存在的参数值，不得把用户原话直接当检索式。

## 输出格式
{"rewrittenQueries": ["", "", ""], "keywords": ["", ""], "filters": {"equipmentCode": null, "knowledgeDomain": ""}, "normalized": {"equipmentModel": "", "faultTerm": "", "part": ""}}

## 示例
输入：空压机老是跳，今天第三次了。
输出：{"rewrittenQueries": ["SA-37 空压机 跳机 排查", "SA-37 空压机 跳机 排气温度", "SA-37 空压机 跳机 处置"], "keywords": ["SA-37", "跳机"], "filters": {"equipmentCode": "EQ-B02-0011", "knowledgeDomain": "AIR"}, "normalized": {"equipmentModel": "SA-37", "faultTerm": "跳机", "part": "排气系统"}}
```

三条检索式覆盖现象、部位与处置，命中手册、SOP（标准作业程序）与历史工单。

## 5.2 召回结果重排

召回返回 20–50 条候选，不能直接送入生成。重排按 0–3 分打分，只留 2 分及以上、最多 5 条；批大小 10 条，单批超时 3 s 降级为相似度排序。topK 只限精排后条数。检索与重排前强制过滤片段：approvedAt 须非空，securityCritical 条目须完成双签；未过审片段不进 top5，不作 HIGH 依据。

表 5-2 重排打分档位

| 分值 | 判定标准 | 处理 |
| --- | --- | --- |
| 3 | 命中设备型号与故障现象，含量化判定标准或处置 | 采纳并引用 |
| 2 | 主题相关，需推断设备或现象 | 采纳，标注推断 |
| 1 | 同领域不同设备，或仅背景知识 | 不采纳，仅作背景 |
| 0 | 无关、重复、版本过期 | 丢弃 |

**WXBST-RAG-RNK-001｜召回重排提示词**
版本 v1.0.0；适用模型 DeepSeek-V3.1；输入变量 {{user_query}}、{{equipment_model}}、{{candidates}}（含 chunkId、text、source、version）；输出单层 JSON。

```text
## 角色
你是维修知识库的重排器，只打分不写答案。

## 任务
按 0–3 分给候选检索片段打分，输出前 5 条，并判断证据是否足够回答。

## 输入
- 用户查询：{{user_query}}
- 设备型号：{{equipment_model}}
- 候选片段：{{candidates}}

## 工作流程
1. 逐条判断是否命中设备型号、故障现象、判定标准。
2. 打分：3 分命中型号与现象且含判据；2 分相关但需推断；1 分同领域不同设备；0 分无关或过期。
3. 每条理由不超过 30 字。
4. 过滤 2 分以下片段，按分数降序取前 5。
5. 判断足够性：至少 1 条 3 分，或 2 条 2 分以上，才算足够。

## 约束
1. 只输出 JSON，不输出解释段落。
2. 每条必须给 chunkId、score、reason，不得遗漏。
3. score 小于 2 的片段不得进入 topChunks。
4. 同分时版本新的排前。
5. 不得改写片段原文，不得补充片段外知识。
6. 每批不超过 10 条，逐条独立打分。

## 输出格式
{"topChunks": [{"chunkId": "", "score": 0, "reason": ""}], "sufficient": false, "bestScore": 0, "missing": ""}

## 示例
输入：查询 SA-37 跳机；候选含 CHUNK-0001-01（KB-AIR-0011 排气温度报警停机）、CHUNK-0001-02（KB-PWR-0007 配电柜温升）。
输出：{"topChunks": [{"chunkId": "CHUNK-0001-01", "score": 3, "reason": "命中 SA-37 排气温度报警阈值"}], "sufficient": true, "bestScore": 3, "missing": ""}
```

阈值 2 与 sufficient 分开判断，避免“有片段就答”；理由限 30 字，批大小 10。

## 5.3 证据引用与溯源

引用格式统一为 [KB-AIR-0011]，检索片段编号 CHUNK-<4 位流水号>-<2 位序号>（从 0001 起）。一句结论挂一处引用，多来源并列写。

表 5-3 引用写法对照

| 位置 | 正确写法 | 禁止写法 |
| --- | --- | --- |
| 结论句 | 排气温度超过 105 ℃ 报警停机 [KB-AIR-0011]。 | 段末统一挂 [KB-AIR-0011]。 |
| 多来源 | [KB-AIR-0011][KB-AIR-0042] | [KB-AIR-0011、0042] |
| 无证据 | 知识库未检索到该型号润滑周期，建议核实。 | 编造周期并挂引用。 |

无引用句不得出现量化阈值、停机断电指令与工单号。引用须与句中数值、动作逐条对应，无法对应按推断表述。

## 5.4 无命中与低置信兜底

表 5-4 三档兜底策略

| 档位 | 判定条件 | 回复动作 |
| --- | --- | --- |
| 有证据 | 至少 1 条 3 分，或 2 条 2 分以上 | 正常回答，最高 MEDIUM；HIGH 需 ≥2 条有效证据且无冲突（8.4 节） |
| 弱证据 | 仅 1 条 2 分，或同型号不同批次 | 回答并标注“依据有限”，给 2 条验证步骤 |
| 无证据 | 最高分不超过 1，或召回为空 | 声明未检索到，给通用安全建议，转人工 |

未过审片段按无证据处理。无证据话术固定为“知识库未检索到该问题的直接依据，以下为通用处置建议，请核实后执行”。出现人身风险、停机损失或连续两次追问未解决时必须调用 escalateToHuman，交接时携带会话号、设备编码、已执行动作。

## 5.5 知识冲突处理

表 5-5 来源优先级

| 优先级 | 来源类型 | 说明 |
| --- | --- | --- |
| 1 | 本厂 SOP 与作业指导书 | 最高，含现场修订 |
| 2 | 厂家手册 | 设计值与标准阈值 |
| 3 | 通用维修资料 | 仅作补充 |
| 4 | 历史工单 | 仅作参考，不作判定依据 |

同级冲突取版本新者，版本相同取编码匹配者。区间参数取交集，单值阈值取更严值；回复须写明差异与依据。冲突示例：VMC-850 润滑压力本厂 SOP 为 2.2–2.5 MPa，厂家手册为 2.0–2.5 MPa（SOP 下限更严，取更严值 2.2–2.5 MPa）。

## 5.6 知识库建设与质量控制

实训知识库有三类来源：系部说明书与维修手册、公开点检模板改编、教师口述访谈；入库前必须登记来源与定位。

表 5-6 数据源与处理方式

| 数据源 | 内容 | 处理方式 | 优先级 |
| --- | --- | --- | --- |
| 系部说明书与维修手册 | 型号参数、报警码、拆装步骤 | 原文切片 | 2 |
| 公开点检模板改编 | 点检项、频次、判定标准 | 按类别映射 | 3 |
| 教师口述访谈整理 | 排查经验、易错点 | 用 WXBST-INT-001 转条目 | 4 |

访谈提纲 8 问，一次一问：1. 故障现象？2. 先查哪、为什么？3. 工具与读数？4. 判据？5. 处置？6. 危险点与防护？7. 验收与复检？8. 新手易错点？

转写与结构化：转写后按主题切片、标时间点；抽取故障现象、判定标准、处置与安全提示；按 4.6 节字段生成草稿，缺失字段列追问。

双人复核与版本字段：条目须双人复核后写入 reviewer、approvedAt、sourceHash、effectiveFrom、securityCritical；securityCritical 为真须安全员双签才可作 HIGH 依据。

表 5-7 知识条目质量评分卡

| 维度 | 1 分 | 3 分 | 5 分 |
| --- | --- | --- | --- |
| 真实性 | 无来源 | 有来源未复核 | 有原话已双复核 |
| 可操作性 | 只有现象 | 有检查方向 | 有判定标准与处置 |
| 来源可追溯 | 无定位 | 有文档名无页码 | 有型号与页码 |
| 覆盖度 | 单点知识 | 覆盖一类故障 | 覆盖常见故障 |

低于 12 分不入库；12–15 分待完善；16 分合格。

覆盖率与陈旧治理：覆盖率低于 60% 补建；每季度复审，超 24 个月标“待复审”并降权；设备改造或新故障立即复审。

入库流程：来源登记→转写或抽取→草稿→双人复核→质量评分→审核字段写入→发布；草稿态不参与检索，见 5.2 节。

**WXBST-INT-001｜口述案例整理提示词**
版本 v1.0.0；适用模型 DeepSeek-V3.1；输入变量 {{interview_transcript}}、{{source_locator}}、{{equipment_category}}、{{existing_knowledge}}；输出 4.6 节知识条目字段，单层 JSON。

```text
## 角色
你是口述案例整理员，只整理教师原话，不补技术结论。

## 任务
把 {{interview_transcript}} 整理为知识条目草稿，列出缺失字段与追问。

## 输入
- 访谈转写：{{interview_transcript}}
- 来源定位：{{source_locator}}
- 设备类别：{{equipment_category}}
- 已有条目：{{existing_knowledge}}

## 工作流程
1. 按主题切片转写，标时间点与受访人。
2. 抽取故障现象、判定标准、处置措施、安全提示。
3. 按 4.6 节字段生成草稿，缺字段一次一问。
4. 附原话证据与来源定位。

## 约束
1. 阈值、参数、工单号必须照抄原话，不得改写或换算。
2. 缺失字段填 null 并列入 missingFields，不得推断。
3. 追问不超过 3 轮，一次只问一个问题。
4. 每条必须给 transcriptQuote 与 sourceLocator。
5. 涉及停机、断电、挂牌上锁时必须写 safetyCheck。
6. 只输出 JSON，不输出解释。

## 输出格式
{"schemaVersion":"1.0","knowledgeItem":{"title":"","symptom":"","equipmentType":"","causes":[{"rootCause":null,"probability":"HIGH"}],"checks":[{"criterion":null,"method":null}],"actions":[],"risk":null,"source":{"type":"INTERVIEW","locator":""},"tags":[],"reviewer":null,"approvedAt":null,"sourceHash":null,"effectiveFrom":null,"securityCritical":false,"duplicateOf":null},"missingFields":[],"followUpQuestions":[]}

## 示例
输入：教师口述“VMC-850 润滑压力低于 2.0 MPa 就先停机，别急着调泵。”
输出：{"schemaVersion":"1.0","knowledgeItem":{"title":"VMC-850 润滑压力低处置","symptom":"润滑压力低于 2.0 MPa","equipmentType":"VMC-850 立式加工中心","causes":[{"rootCause":null,"probability":"HIGH"}],"checks":[{"criterion":"集中润滑压力 2.0–2.5 MPa","method":"读压力表"}],"actions":["停机后检查润滑泵与管路"],"risk":"带压拆管","source":{"type":"INTERVIEW","locator":"访谈 2026-10-12 机加车间"},"tags":["润滑","压力低"],"reviewer":null,"approvedAt":null,"sourceHash":null,"effectiveFrom":null,"securityCritical":false,"duplicateOf":null},"missingFields":["发生频次"],"followUpQuestions":["这种压力低多久出现一次？"]}
```

原话证据与定位保证可追溯。阈值照抄防改写。缺失追问代替编造。

# 6 工具调用与 Agent 编排

Agent（智能体）只能调用登记在册的 7 个工具。设备台账、工单号、点检标准必须来自工具返回，编造视为违规；顺序为选择、校验、执行、裁剪、回填。

## 6.1 工具清单与 JSON Schema

表 6-1 工具清单

| 工具名 | 用途 | 必填参数 | 类型 |
| --- | --- | --- | --- |
| getEquipmentProfile | 查询设备台账 | equipmentCode | 读 |
| searchKnowledge | 检索知识库片段 | query、equipmentModel | 读 |
| getMaintenanceHistory | 查询维修履历 | equipmentCode | 读 |
| getInspectionStandard | 查询点检标准 | equipmentModel、frequency | 读 |
| createWorkOrder | 创建工单 | equipmentCode、symptom、priority | 写 |
| updateWorkOrder | 回填工单与状态 | workOrderNo、status（DRAFT/PENDING_CONFIRM/ASSIGNED/ACCEPTED/IN_PROGRESS/PENDING_ACCEPTANCE/CLOSED/ON_HOLD）、repairReport（rootCause/actions/parts/downTime/acceptor/residualRisk） | 写 |
| escalateToHuman | 转人工 | sessionId、equipmentCode、actions、reason | 写 |

工具描述四条：动词开头、写明返回、不适用场景、不超过 50 字。工具名用小驼峰动词短语，不得缩写；描述不写示例问句。参数给 type 与 description，枚举给 enum（枚举），required 全列，additionalProperties 为 false。

读写工具各给一个完整 Schema（JSON 结构校验规范），其余同构。

```json
{
  "tools": [
    {
      "name": "searchKnowledge",
      "description": "检索企业维护知识库，返回带来源的知识片段，不查台账",
      "parameters": {
        "type": "object",
        "properties": {
          "query": {"type": "string", "description": "检索式，来自改写结果"},
          "equipmentModel": {"type": "string", "description": "锚点设备型号"},
          "knowledgeDomain": {"type": "string", "enum": ["CNC", "AIR", "PWR", "MOT", "GEN"]},
          "topK": {"type": "integer", "minimum": 1, "maximum": 10, "default": 5}
        },
        "required": ["query", "equipmentModel"],
        "additionalProperties": false
      }
    },
    {
      "name": "createWorkOrder",
      "description": "创建维修工单并返回工单号，执行前必须二次确认",
      "parameters": {
        "type": "object",
        "properties": {
          "equipmentCode": {"type": "string", "pattern": "^EQ-[A-D][0-9]{2}-[0-9]{4}$"},
          "symptom": {"type": "string", "maxLength": 100},
          "priority": {"type": "string", "enum": ["P1", "P2", "P3", "P4"]},
          "occurredAt": {"type": "string", "format": "date-time"}
        },
        "required": ["equipmentCode", "symptom", "priority"],
        "additionalProperties": false
      }
    }
  ]
}
```

Schema 不写示例值；枚举只列合法值。

## 6.2 工具选择与参数校验

表 6-2 调用条件

| 场景 | 必须调用 | 禁止 |
| --- | --- | --- |
| 用户报设备故障 | searchKnowledge | 直接给结论 |
| 涉及具体设备编码 | getEquipmentProfile | 凭记忆写台账 |
| 问“以前修过吗” | getMaintenanceHistory | 编造履历 |
| 生成点检表 | getInspectionStandard | 自拟判定标准 |
| 需要建单或转人工 | createWorkOrder、escalateToHuman | 未确认就写库 |

参数校验规则：设备编码匹配 `^EQ-[A-D][0-9]{2}-[0-9]{4}$`；时间用 ISO 8601；topK 取 1–10；priority 只取 P1–P4。校验失败不得执行，修正后再调，最多 1 次。必填参数缺失追问 1 次，仍缺失按“未知”处理；写操作缺参数直接转人工。示例：priority 传 P5 直接拒收并追问真实等级，禁止默认档；equipmentCode 位数不足拒绝并追问“设备铭牌编码”。

## 6.3 多工具编排与并行

```text
1 profile = getEquipmentProfile(equipmentCode)
2 若 profile 为空 → escalateToHuman(reason="设备编码不存在")
3 chunks = searchKnowledge(query, equipmentModel=profile.model)
4 history = getMaintenanceHistory(equipmentCode)   // 与 3 并行
5 摘要 = 裁剪(chunks, history)                      // 上限 500 字
6 draft = 生成 WorkOrderDraft
7 展示确认摘要，等待用户确认
8 确认后 createWorkOrder(draft)
```

并行只在无数据依赖的读工具之间；写工具串行且依赖前置读结果；同一轮最多 3 个工具。中间结果裁剪：每条摘要不超过 80 字，履历取最近 3 条，总注入不超过 500 字，超限按重排分数截断。并行分支超时按 6.4 节降级。

## 6.4 失败重试、超时与降级

表 6-3 错误码映射

| 错误码 | 触发条件 | 处理 |
| --- | --- | --- |
| TOOL_TIMEOUT | 读工具 2 s、写工具 3 s 未返回 | 重试 1 次，仍失败则降级 |
| NOT_FOUND | 编码或单号不存在 | 不重试，追问核对编码 |
| PERMISSION_DENIED | 角色无权限 | 不重试，提示申请权限或转人工 |
| RATE_LIMITED | 超出限流 | 退避 1 s 重试 1 次，仍失败转异步 |

写操作禁止盲重试，重试前须确认上次调用未落库。降级话术为“部分数据暂时无法获取，以下回答仅基于已获取内容”；顺序为重试、换工具、仅知识回答、转人工，任一步成功即停止。

## 6.5 写操作确认与权限校验

写操作前必须展示确认摘要，含设备编码、故障现象（不超过 60 字）、优先级、处置建议与影响范围；确认后才执行，有效期 10 分钟。同一请求按 sessionId、equipmentCode、发生时间分钟级幂等。

表 6-4 角色与工具权限矩阵

| 工具 | operator | technician | manager | teamlead | safety |
| --- | --- | --- | --- | --- | --- |
| getEquipmentProfile | 允许 | 允许 | 允许 | 允许 | 允许 |
| searchKnowledge | 允许 | 允许 | 允许 | 允许 | 允许 |
| getMaintenanceHistory | 禁止 | 允许 | 允许 | 允许 | 允许 |
| getInspectionStandard | 禁止 | 允许 | 允许 | 允许 | 允许 |
| createWorkOrder | 允许（仅草稿） | 允许 | 允许 | 允许（本班组报修） | 允许（隐患报修） |
| updateWorkOrder | 禁止 | 允许 | 允许 | 允许 | 禁止 |
| escalateToHuman | 允许 | 允许 | 允许 | 允许 | 允许 |

operator 只能创建 DRAFT，提交与派单需 teamlead 或 manager 审批。确认记录与写参数写入审计日志，保留 183 天。回复“确认”之外视为未确认；写操作失败按幂等键查询，不得重试建单。权限校验在网关执行，越权返回 PERMISSION_DENIED，由 6.4 节处理。

# 7 结构化输出与格式约束

输出必须是单层 JSON 对象，不带 Markdown（标记语法）围栏、前言与后缀。校验失败按 7.2 节修复，仍失败降级为纯文本。

## 7.1 四类核心输出 Schema

四类 Schema 共用四条规则：字段小驼峰；顶层带 schemaVersion，固定 1.0；枚举英文大写；additionalProperties 为 false，必填缺失即判失败。时间用 ISO 8601 带时区。知识抽取结果不属四类运行输出，字段见 4.6 节；Schema 文件清单以 12.5 节为准。

```json
{
  "FaultAnswer": {
    "type": "object",
    "additionalProperties": false,
    "required": ["schemaVersion", "answerType", "conclusion", "equipmentCode", "symptom", "confidence", "actions", "citations", "risks", "nextStep"],
    "properties": {
      "schemaVersion": {"const": "1.0"},
      "answerType": {"type": "string", "enum": ["DIAGNOSIS", "REFUSAL"]},
      "conclusion": {"type": "string", "maxLength": 80},
      "equipmentCode": {"type": "string", "pattern": "^EQ-[A-D][0-9]{2}-[0-9]{4}$"},
      "symptom": {"type": "string", "maxLength": 100},
      "rootCause": {"type": ["string", "null"]},
      "causes": {"type": "array", "items": {"type": "object", "required": ["rootCause", "probability", "basis", "verifyMethod"], "properties": {"rootCause": {"type": "string"}, "probability": {"type": "string", "enum": ["HIGH", "MEDIUM", "LOW"]}, "basis": {"type": "string"}, "verifyMethod": {"type": "string"}}}},
      "confidence": {"type": "string", "enum": ["HIGH", "MEDIUM", "LOW"]},
      "actions": {"type": "array", "items": {"type": "object", "required": ["action", "criterion", "riskLevel"], "properties": {"action": {"type": "string"}, "criterion": {"type": "string"}, "riskLevel": {"type": "string", "enum": ["HIGH", "MEDIUM", "LOW"]}}}},
      "citations": {"type": "array", "items": {"type": "string", "pattern": "^(KB-[A-Z]+-[0-9]{4}|CHUNK-[0-9]{4}-[0-9]{2})$"}},
      "risks": {"type": "array", "items": {"type": "string"}},
      "nextStep": {"type": "object", "required": ["enterTroubleshooting", "firstQuestion"], "properties": {"enterTroubleshooting": {"type": "boolean"}, "firstQuestion": {"type": "string"}}},
      "escalate": {"type": "boolean"}
    }
  },
  "TroubleshootingStep": {
    "type": "object",
    "additionalProperties": false,
    "required": ["schemaVersion", "stepId", "state", "question", "options", "criterion", "action"],
    "properties": {
      "schemaVersion": {"const": "1.0"},
      "stepId": {"type": "string", "pattern": "^S[0-4]-[0-9]{2}$"},
      "state": {"type": "string", "enum": ["S0", "S1", "S2", "S3", "S4"]},
      "question": {"type": "string", "maxLength": 60},
      "options": {"type": "array", "minItems": 2, "maxItems": 4, "items": {"type": "object", "required": ["answer", "next"], "properties": {"answer": {"type": "string"}, "next": {"type": "string", "pattern": "^S[0-4]-[0-9]{2}$"}}}},
      "criterion": {"type": "string"},
      "action": {"type": "string"}
    }
  },
  "InspectionChecklist": {
    "type": "object",
    "additionalProperties": false,
    "required": ["schemaVersion", "equipmentModel", "frequency", "items"],
    "properties": {
      "schemaVersion": {"const": "1.0"},
      "equipmentModel": {"type": "string"},
      "equipmentCategory": {"type": "string", "enum": ["CNC", "MOT", "AIR", "PWR", "GEN"]},
      "frequency": {"type": "string", "enum": ["D", "W", "M", "Y"]},
      "items": {"type": "array", "minItems": 1, "items": {"type": "object", "required": ["code", "name", "criterion", "method"], "properties": {"code": {"type": "string", "pattern": "^CHK-[A-Z]{3}-[DWMY]-[0-9]{3}$"}, "name": {"type": "string"}, "location": {"type": "string"}, "criterion": {"type": "string"}, "method": {"type": "string"}, "tool": {"type": "string"}, "judgment": {"type": "string"}, "abnormalAction": {"type": "string"}, "frequency": {"type": "string", "enum": ["D", "W", "M", "Y"]}, "safetyTip": {"type": "string"}}}},
      "totalCount": {"type": "integer", "minimum": 1}
    }
  },
  "WorkOrderDraft": {
    "type": "object",
    "additionalProperties": false,
    "required": ["schemaVersion", "equipmentCode", "symptom", "priority"],
    "properties": {
      "schemaVersion": {"const": "1.0"},
      "workOrderDraftId": {"type": ["string", "null"]},
      "equipmentCode": {"type": ["string", "null"], "pattern": "^EQ-[A-D][0-9]{2}-[0-9]{4}$"},
      "symptom": {"type": ["string", "null"], "maxLength": 100},
      "priority": {"type": "string", "enum": ["P1", "P2", "P3", "P4"]},
      "suggestedAssignee": {"type": ["string", "null"]},
      "occurredAt": {"type": ["string", "null"], "format": "date-time"},
      "confirmed": {"type": "boolean", "default": false},
      "location": {"type": ["string", "null"]},
      "impactScope": {"type": ["string", "null"]},
      "urgency": {"type": ["string", "null"], "enum": ["HIGH", "MEDIUM", "LOW", null]},
      "safetyFlag": {"type": "boolean"},
      "status": {"type": "string", "enum": ["DRAFT", "PENDING_CONFIRM", "ASSIGNED", "ACCEPTED", "IN_PROGRESS", "PENDING_ACCEPTANCE", "CLOSED", "ON_HOLD"]},
      "missingFields": {"type": "array", "items": {"type": "string"}},
      "dispatch": {"type": "object", "properties": {"primary": {"type": "string"}, "backup": {"type": "string"}, "reason": {"type": "string"}}},
      "confirmText": {"type": "string"},
      "needConfirm": {"type": "boolean"}
    }
  }
}
```

表 7-1 四类 Schema 对照

| Schema | 主键 | 关键字段与枚举 | 用途 |
| --- | --- | --- | --- |
| FaultAnswer | equipmentCode | confidence、riskLevel | 故障问答输出 |
| TroubleshootingStep | stepId | state、question、options、criterion、action | 排查引导节点 |
| InspectionChecklist | equipmentModel 与 frequency | items 十字段点检项 | 点检清单 |
| WorkOrderDraft | equipmentCode | priority、confirmed | 工单草稿 |

必填字段只留结论与渲染必要项，其余可选，减少整单失败。点检清单 items 必填 code、name、criterion、method。版本兼容：主版本变更不得复用字段名，新增字段只追加末尾，旧版按缺失字段兜底。FaultAnswer 的 rootCause 为根因摘要，取 causes[0].rootCause，无根因置 null。联动规则：FaultAnswer 的 confidence 为 HIGH 时 citations 不得为空；WorkOrderDraft 的 priority 为 P1 时 suggestedAssignee 必填且 safetyFlag 为 true。

排查引导运行时信封 = {schemaVersion, round, stepId, state, question, options, criterion, action, basis, path, safetyAck}；节点字段与 TroubleshootingStep 一致，round（轮次）、basis（依据）、path（已走路径）、safetyAck（安全确认）为会话附加字段，与 4.3 节对齐。草稿态 WorkOrderDraft 字符串字段允许 null，提交前补齐并整体校验。

拒答信封字段固定，供 3.5、7.3 节引用。

| 字段 | 说明 |
| --- | --- |
| schemaVersion | 固定 1.0 |
| answerType | 固定 REFUSAL |
| refusalReason | 拒答原因码 |
| trigger | 触发条件 |
| safeAction | 必须动作，如停机挂牌上锁 |
| alternative | 可替代的安全建议 |
| escalateTo | 接收角色 |
| safetyCheck | 是否需要安全确认 |
| confidence | 置信度 HIGH/MEDIUM/LOW |

三类运行时对象不属于四类核心输出，供 4.8 节点检填报、异常与看板使用，字段与 4.8 节一致。

表 7-2 点检运行时对象字段

| 对象 | 关键字段 | 关键枚举 | 用途 |
| --- | --- | --- | --- |
| ChecklistSubmission | submissionId、checklistCode、equipmentCode、frequency、items（checkItemCode、result、value、note）、abnormalCount、submittedBy、submittedAt、status | result：PASS/FAIL/NA；status：SUBMITTED/REVIEWED/RETURNED | 点检填报提交 |
| Anomaly | anomalyId、submissionId、equipmentCode、checkItemCode、severity、anomalyType、actualValue、referenceValue、detectedAt、status、assignee、dueAt、linkedWorkOrderNo | severity：HIGH/MEDIUM/LOW；status：OPEN/ACK/CLOSED | 异常生成与跟踪 |
| DashboardInsight | periodStart、periodEnd、scope、insightType、summary、topAnomalies、recommendations、generatedAt | insightType：ANOMALY_TREND/REPEAT_FAILURE/OVERDUE/SLA | 看板汇总与建议 |

## 7.2 校验与修复提示词

校验分三层：JSON 解析、Schema 校验、业务规则（如 P1 工单必须有处置建议）。任一层失败，把原文与错误列表交给修复提示词；回跑校验仍失败即降级。

**WXBST-FIX-001｜格式修复提示词**
版本 v1.0.0；适用模型 DeepSeek-V3.1（温度 0）；输入变量 {{raw_output}}、{{validation_errors}}、{{target_schema}}；输出为修复后的 JSON 对象本身。

```text
## 角色
你是 JSON 修复器，只修格式不改内容。

## 任务
按校验错误列表修复 {{raw_output}}，使其通过 {{target_schema}} 校验。

## 输入
- 原始输出：{{raw_output}}
- 校验错误：{{validation_errors}}
- 目标 Schema：{{target_schema}}

## 工作流程
1. 逐条定位错误字段。
2. 只做最小修改：去代码围栏、补引号、改枚举大小写、补必填空值。
3. 自校验：可解析、必填齐全、枚举合法、类型匹配。
4. 自校验失败则输出失败对象，不再尝试。

## 约束
1. 不得改变语义、数值、设备编码、工单号。
2. 不得新增 Schema 未定义的字段。
3. 不得输出围栏、注释、解释文字。
4. 修复上限 1 次，不得循环重试。
5. 无依据不得补造必填值；无法从原文推断时置 null 并转人工。
6. 枚举英文大写，时间补全时区。

## 输出格式
修复成功：直接输出修复后的 JSON 对象。
修复失败：{"fixFailed": true, "reason": ""}

## 示例
错误：confidence 为“高”，外层带 json 围栏。
输出：{"schemaVersion": "1.0", "equipmentCode": "EQ-B02-0011", "symptom": "空压机频繁跳机", "rootCause": "排气温度超限", "confidence": "HIGH", "actions": [], "citations": ["KB-AIR-0011"], "escalate": false}
```

一次修复失败即降级，避免重复生成；温度 0 保证输出稳定。

## 7.3 前端渲染映射

表 7-3 字段与渲染组件

| 字段 | 组件 | 约束 |
| --- | --- | --- |
| confidence | 三色徽标 | HIGH 绿、MEDIUM 黄、LOW 灰并展示免责声明 |
| actions | 步骤列表 | 最多 6 条，首条展开，风险等级同步着色 |
| citations | 引用卡片 | 最多 3 个，点击跳转知识条目 |
| answerType=REFUSAL | 拒答卡片 | 展示 refusalReason 与 safeAction，隐藏写操作按钮 |
| question、options | 问题卡片与按钮组 | 只渲染当前节点，选项含“不确定” |
| checklist.items | 表格 | 每页 20 行，支持导出 |
| workOrderNo | 复制文本 | 只读，点击复制 |
| safetyCheck、safetyTip | 警示条 | 红色，禁止折叠 |

渲染顺序固定为结论、依据、处置、风险、引用。缺失字段不得由前端推测，直接显示“未提供”；校验失败只渲染纯文本区。低置信度不得隐藏引用区。

## 7.4 截断、分页与流式输出

清单分页 page 从 1 起，size 默认 20、最大 50；响应含 total、page、size、hasNext，单页正文不超过 2,000 字，size 超 50 按 50 处理。长字段截断上限：symptom 100 字、action 200 字、rootCause 300 字；截断加省略号并标记 truncated 为 true，完整值按需拉取。

表 7-4 流式事件序列

| 事件 | 载荷 | 前端动作 |
| --- | --- | --- |
| meta | sessionId、messageId | 建消息气泡 |
| delta | 正文片段 | 追加渲染 |
| tool | 工具名、状态 | 显示调用中 |
| citation | 引用编号 | 挂到末尾引用区 |
| usage | token 数 | 记录监控 |
| done | 收尾标记 | 触发结构校验 |
| error | 错误码 | 终止流并提示重试 |

SSE（Server-Sent Events，服务器推送事件）只推正文与事件，不推完整 JSON；拼接后按 7.1 节校验，失败按 7.2 节修复。首 token 2 s 内到达，10 s 未达重试并降级；流中断保留已渲染内容并标注“回答未完成”。收到 error 后不得再发 delta；重连须携带 messageId。
