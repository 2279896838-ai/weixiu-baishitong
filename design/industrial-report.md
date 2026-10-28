# 维修百事通 · 工业级就绪报告

- 生成时间：2026-10-27T16:05:05+0800
- 版本：1.1.0
- 门禁：53/53 通过
- 说明：R16 产品化 R1 收尾：版本/日志/审计保留

## 1 门禁结果

| 门禁项 | 结论 | 详情 |
| --- | --- | --- |
| server: startup | 通过 | 28697 |
| health: 200 | 通过 | 200 |
| health: version | 通过 | 1.1.0 |
| health: uptime | 通过 | 0.5 |
| health: requests | 通过 | 1 |
| health: limits | 通过 | {'maxBodyBytes': 262144, 'maxMessageChars': 2000, 'ratePerMinute': 600} |
| health: data stats | 通过 | {'equipment': 16, 'knowledge': 63, 'checklistCategories': 13, 'checklistTemplates': 16, 'checklistItems': 119, 'trees': 5, 'vector': {'docs': 63, 'dim': 512, 'backend': 'hash', 'model': '', 'error': ''}} |
| health: prompts | 通过 | {'count': 15, 'expected': 15, 'errors': 0} |
| api: equipment | 通过 | 16 |
| api: chat QA | 通过 | ['QA', 4] |
| api: danger refusal | 通过 | DANGER |
| api: checklist | 通过 | 8 |
| api: dashboard | 通过 | ['days', 'generatedAt', 'summary', 'byCategory'] |
| api: workorder 404 | 通过 | 404 |
| api: prompts list | 通过 | 15 |
| api: prompt asset | 通过 | WXBST-QA-001 |
| validation: message length | 通过 | 400 |
| validation: bad json | 通过 | 400 |
| validation: body limit | 通过 | 413 |
| validation: unknown api | 通过 | 404 |
| validation: method mismatch | 通过 | 404 |
| security: nosniff | 通过 | nosniff |
| security: referrer | 通过 |  |
| security: frame | 通过 |  |
| security: html 200 | 通过 | 200 |
| security: csp | 通过 | default-src 'self'; script-src 'self'; s |
| security: agent page | 通过 | 200 |
| security: traversal blocked | 通过 | 403 |
| performance: sequential errors | 通过 | 0 |
| performance: p95 < 800ms | 通过 | 24.0 |
| performance: max < 3000ms | 通过 | 27.7 |
| performance: concurrency | 通过 | [200, 200, 200, 200, 200, 200, 200, 200, 200, 200] |
| audit: rows | 通过 | 110 |
| audit: fields | 通过 | [] |
| audit: tool header | 通过 | 1 |
| audit: health requests | 通过 | [110, 110] |
| data: counts | 通过 | [16, 63, 5, 78] |
| data: equipment fields | 通过 | [] |
| data: equipment codes unique | 通过 | 16 |
| data: knowledge fields | 通过 | [] |
| data: knowledge ids unique | 通过 | 63 |
| data: knowledge richness | 通过 | [] |
| data: probabilities | 通过 | [] |
| data: checklists | 通过 | [13, 119] |
| data: trees | 通过 | [] |
| data: eval cases | 通过 | [] |
| prompts: assets | 通过 | [15, []] |
| artifacts: offline demo | 通过 | 1014391 |
| artifacts: agent demo | 通过 | 358528 |
| artifacts: design pdf | 通过 | 923333 |
| artifacts: offline shim + agent embed | 通过 | 905417 |
| artifacts: agent shim | 通过 | 255677 |
| docs: release files | 通过 | [] |

## 2 性能指标

| 指标 | 数值 |
| --- | --- |
| p50_ms | 15.1 |
| p95_ms | 24.0 |
| max_ms | 27.7 |
| sequential_errors | 0 |
| concurrent_requests | 30 |
| concurrent_seconds | 0.55 |

## 3 迭代记录

| 轮次 | 说明 | 门禁通过 |
| --- | --- | --- |
| 1 | R6-基线：工业级就绪首轮 | 48/53 |
| 2 | R6-第2轮：修复 EngineError.message、审计时序与阈值 | 53/53 |
| 3 | R6-最终：全部门禁通过，工业级 1.0.0 | 53/53 |
| 4 | R7-内嵌智能体页签：主离线演示集成智能体，53 项门禁保持全绿 | 52/53 |
| 5 | R7-最终：内嵌智能体页签与 53 项工业门禁全绿 | 53/53 |
| 6 | R8 最终：故障问答升级为智能体问答（第 01 页签），53 项门禁全绿 | 53/53 |
| 7 | R9 轧钢问答修复后工业门禁 | 53/53 |
| 8 | R10 球磨/回转窑工艺问答后工业门禁 | 52/53 |
| 9 | R10 最终：球磨/回转窑工艺问答与 53 项门禁全绿 | 53/53 |
| 10 | R11 浓密机工艺问答后工业门禁 | 53/53 |
| 11 | R12 向量混合检索与通用设备知识后工业门禁 | 53/53 |
| 13 | R13 概念问答后工业门禁（重跑） | 53/53 |
| 14 | R14 接入自定义模型 Z、渐进打字与概念问答 | 53/53 |
| 15 | R15 产品化基础：SQLite/鉴权/指标/部署 | 53/53 |
| 16 | R16 产品化 R1 收尾：版本/日志/审计保留 | 53/53 |
