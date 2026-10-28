# 维修百事通 · MVP 契约（数据 / API / 引擎接口）

> 并行开发必须严格遵循本契约：Python 3 仅标准库，不得引入第三方包；UTF-8；默认离线可用（LLM 可选）。

## 1 目录与职责

~~~text
data/                    数据包（数据智能体产出，其他人只读）
  equipment.json         设备台账（数组）
  knowledge.jsonl        知识条目（每行一个 JSON）
  checklists.json        点检模板（按设备类别与频次索引）
  trees.json             排查决策树
  eval_cases.jsonl       评测用例
  interviews/*.md        教师口述访谈原始整理稿（样例 3 篇）
docs/数据包说明.md         数据来源、采集与审核说明
demo/
  engine.py              检索、问答、排查引导、点检、看板、工单、知识回流
  server.py              stdlib HTTP 服务：REST API + 静态文件
  static/index.html      单页应用（问答 / 点检 / 看板 / 工单）
  static/app.js
  static/style.css
  runtime/               运行时数据（自动创建）
~~~

## 2 数据结构（字段名固定，camelCase）

### 2.1 equipment.json（数组）

~~~json
{"equipmentCode":"EQ-TR01-0001","name":"数控车床 CK6140","category":"LATHE","location":"实训楼 A101 车工区","brand":"大连机床","specs":{"最大回转直径":"400 mm","主轴转速":"50–2000 r/min"},"commonFaults":["主轴异响"],"safetyRules":["断电挂牌后开防护门"]}
~~~

category 取值：LATHE、MILL、PRN、LSR、CMP、MOT、PWR（数控车床、加工中心、3D 打印机、激光切割机、空压机、电机、配电柜）。设备至少 7 台，覆盖全部类别。

### 2.2 knowledge.jsonl（每行一个对象）

~~~json
{"id":"KB-LATHE-0001","title":"数控车床主轴异响（轴承磨损）","equipmentCategory":"LATHE","equipmentCodes":["EQ-TR01-0001"],"symptom":"主轴旋转时发出连续咔啦异响，转速越高越明显","symptomKeywords":["主轴异响","咔啦","主轴"],"causes":[{"rootCause":"主轴前轴承磨损","probability":"HIGH","basis":"转速升高异响加剧","verifyMethod":"断电挂牌后手动盘车听声"}],"checks":[{"step":"断电挂牌上锁后打开主轴箱盖","criterion":"轴承滚道无剥落"}],"actions":["停机断电挂牌上锁","联系实训教师与维修人员拆检","更换同型号轴承并复测跳动"],"risk":"主轴未停稳禁止触碰；拆检须教师在场","source":{"type":"TEACHER_INTERVIEW","title":"王老师口述 2026-09-18","locator":"访谈录音 03:12-05:40"},"reviewer":"实训室管理员","approvedAt":"2026-10-08","effectiveFrom":"2026-10-08","securityCritical":false,"tags":["车床","主轴","异响"]}
~~~

要求：至少 15 条，覆盖 7 个类别；每条 causes ≥2（带 probability）、checks ≥1、actions ≥2；source.type 取 MANUAL / TEMPLATE / TEACHER_INTERVIEW / WORKORDER；approvedAt 非空；至少 6 条 source.type=TEACHER_INTERVIEW。

### 2.3 checklists.json（按类别索引）

~~~json
{"LATHE":{"D":[{"code":"CHK-LATHE-D-001","name":"主轴异响","location":"主轴箱","criterion":"无异响","method":"听音","tool":"耳听","judgment":"无异常声响","abnormalAction":"立即停机并报教师","frequency":"D","safetyTip":"运行中禁止开防护门"}],"W":[]}}
~~~

每个类别至少 D 档 8 项；LATHE、MILL、PRN、LSR、CMP、MOT、PWR 均要有 D；至少 3 个类别有 W 档 5 项。

### 2.4 trees.json

~~~json
{"TREE-LATHE-NOISE":{"name":"数控车床主轴异响排查","equipmentCategory":"LATHE","root":"S0-01","nodes":{"S0-01":{"state":"S0","question":"异响是否只在主轴旋转时出现？","options":[{"answer":"是","next":"S1-01"},{"answer":"否","next":"S1-02"},{"answer":"不确定","next":"S1-03"}],"criterion":"观察主轴启停与异响关系","action":"记录现象"},"S1-01":{"state":"S1","question":"是否已停机断电并挂牌上锁？","options":[{"answer":"是","next":"S2-01"},{"answer":"否","next":"S1-99"},{"answer":"不确定","next":"S1-99"}],"criterion":"安全确认","action":"未确认不得继续"},"S1-99":{"state":"S1","question":"请先完成停机、断电、挂牌上锁，完成后回复「已确认」。","options":[{"answer":"已确认","next":"S2-01"}],"criterion":"安全确认","action":"暂停引导"},"S2-01":{"state":"S2","question":"手动盘车是否有卡滞或异响？","options":[{"answer":"是","next":"S3-01"},{"answer":"否","next":"S3-02"},{"answer":"不确定","next":"S3-03"}],"criterion":"断电盘车手感与声音","action":"记录"},"S3-01":{"state":"S3","isLeaf":true,"conclusion":"主轴轴承或机械损伤","actions":["停机断电挂牌","联系教师与维修人员拆检"]},"S3-02":{"state":"S3","isLeaf":true,"conclusion":"排除主轴机械故障，转查刀具与切削参数","actions":["检查刀具装夹","复核切削参数"]},"S3-03":{"state":"S3","isLeaf":true,"conclusion":"无法判定，转人工","actions":["转实训教师"]}}}
~~~

至少 3 棵树（车床异响、加工中心刀库或主轴报警、3D 打印堵头或激光不出光）；节点字段固定：state/question/options[{answer,next}]/criterion/action，叶节点加 isLeaf/conclusion/actions。

### 2.5 eval_cases.jsonl

~~~json
{"id":"EV-001","kind":"QA","input":"数控车床主轴转起来咔啦咔啦响，是什么原因？","expected":{"intent":"QA","mustInclude":["轴承","停机"],"mustCite":["KB-LATHE-0001"],"maxCauses":5}}
~~~

至少 12 条，覆盖 QA / CHECKLIST / TROUBLESHOOT / DANGER 四类。

## 3 引擎公开接口（demo/engine.py，server.py 只调用这些）

~~~python
class Engine:
    def __init__(self, data_dir: str, runtime_dir: str): ...
    def list_equipment(self, query: str = "") -> list[dict]
    def get_knowledge(self, entry_id: str) -> dict | None
    def chat(self, session_id: str, message: str, role: str = "student", equipment_code: str | None = None) -> dict
    def start_tree(self, session_id: str, tree_id: str) -> dict
    def answer_tree(self, session_id: str, reply: str) -> dict
    def generate_checklist(self, equipment_code: str, frequency: str = "D", operator: str = "") -> dict
    def submit_checklist(self, checklist: dict, items: list[dict], operator: str, note: str = "") -> dict
    def dashboard(self, days: int = 30) -> dict
    def create_workorder(self, anomaly_id: str, note: str = "", operator: str = "") -> dict
    def list_workorders(self, status: str | None = None) -> list[dict]
    def update_workorder(self, workorder_id: str, status: str, repair_report: dict | None = None, operator: str = "") -> dict
~~~

chat 返回结构：
~~~json
{"sessionId":"SESS-xxxx","intent":"QA","answerType":"DIAGNOSIS","conclusion":"...","confidence":"HIGH","causes":[{"rootCause":"","probability":"HIGH","basis":"","verifyMethod":""}],"actions":[{"action":"","criterion":"","riskLevel":"HIGH"}],"risks":"","citations":["KB-LATHE-0001"],"nextStep":{"enterTroubleshooting":false,"firstQuestion":""},"clarify":null,"escalate":false,"text":"渲染后的中文回答","sources":[{"id":"KB-LATHE-0001","title":"..."}]}
~~~
intent 取 QA / TRG / CHK / WO / CHAT / DANGER / UNKNOWN；无命中返回 answerType=REFUSAL、clarify 给出追问或 escalate=true。start_tree/answer_tree 返回节点对象：treeId、nodeId、state、question、options、isLeaf、conclusion、actions、safetyAck。

submit_checklist 入参 items 每项 {"code","result":"OK|ABNORMAL|NA","note","severity":"LOW|MEDIUM|HIGH"}；返回 submissionId、equipmentCode、checkedAt、anomalies（含 anomalyId、severity、code、name、note、equipmentCode）、summary。

约束：离线模式必须可用；有环境变量 LLM_API_BASE / LLM_API_KEY / LLM_MODEL 时可选调用 OpenAI 兼容接口，失败回退离线。中文检索用关键词 + 二元组打分；无命中时 REFUSAL。

## 4 HTTP API（demo/server.py）

统一 JSON；错误 {"error":{"code":"...","message":"..."}}；默认端口 8787；支持 python demo/server.py --port 8787。

| 方法 | 路径 | 请求体 | 说明 |
| --- | --- | --- | --- |
| GET | /api/health | — | {"status":"ok","mode":"offline"} |
| GET | /api/equipment?query= | — | 设备列表 |
| POST | /api/chat | {"sessionId","message","role","equipmentCode"} | 问答/引导入口 |
| POST | /api/troubleshoot/answer | {"sessionId","reply"} | 引导作答 |
| POST | /api/checklists/generate | {"equipmentCode","frequency"} | 生成点检清单 |
| POST | /api/checklists/submit | {"checklist","items","operator","note"} | 填报提交 |
| GET | /api/dashboard?days=30 | — | 看板数据 |
| GET | /api/workorders?status= | — | 工单列表 |
| POST | /api/workorders | {"anomalyId","note","operator"} | 由异常创建工单 |
| PATCH | /api/workorders/{id} | {"status","repairReport","operator"} | 更新/结案 |
| GET | / | — | 返回 static/index.html |
| GET | /static/* | — | 静态文件 |

## 5 验收

1. python demo/server.py --port 8787 直接启动，无第三方依赖，打印数据统计。
2. curl 链路：health → chat（主轴异响，返回排序原因与 citations）→ 点检生成（车床 D）→ 提交（含 1 条 ABNORMAL）→ dashboard（anomalies ≥1）→ 工单创建并结案（runtime/knowledge_candidates.jsonl 新增 1 行）。
3. 前端四页签可用：问答有引用与原因排序；点检可勾选提交；看板有汇总卡片与条状图；工单可创建与结案。
4. 无 Key 时全部功能可用；有 Key 时问答走 LLM 并回退兜底。
5. 不得修改 data/ 原始数据；运行时只写 demo/runtime/。
