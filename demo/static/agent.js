/* 维修百事通 · 智能体问答前端
   工具型智能体：路由 → 调用本地 API（知识问答/点检/看板/工单/引导）→ 结构化回答。
   不依赖第三方库；在线服务与单文件离线版共用同一套 API（离线版由 offline-shim 提供）。 */
(function () {
  'use strict';

  var state = {
    sessionId: 'SESS-AGT-' + Date.now().toString(36).toUpperCase(),
    currentTool: '',
    equipmentCode: '',
    equipment: [],
    guide: null,
    busy: false,
    toolCalls: 0
  };

  var TOOL_META = {
    fault_qa: { name: '知识库诊断', desc: '检索知识库，输出原因排序、处置步骤、风险与引用' },
    guide: { name: '排查引导', desc: '按决策树逐轮提问，安全确认未完成不进入测量节点' },
    guide_answer: { name: '引导作答', desc: '提交当前排查问题的现场答案并推进节点' },
    checklist: { name: '点检清单', desc: '按设备与频次生成电子点检清单' },
    dashboard: { name: '异常看板', desc: '汇总点检提交、异常分布与未闭环工单' },
    workorder: { name: '工单流转', desc: '由异常编号创建维修工单并跟踪状态' },
    equipment: { name: '设备台账', desc: '按名称或编码查询设备参数与安全规则' },
    calculator: { name: '工艺计算', desc: '矿浆体积、矿浆密度、浓密机底流流量网页自算' }
  };

  var dom = {};
  var activeTypewriter = null;

  function typewriter(node, text, done) {
    if (activeTypewriter && activeTypewriter.cancel) { activeTypewriter.cancel(); }
    text = String(text || '');
    var token = { cancelled: false, finished: false };
    var timer = null;
    var finish = function () {
      if (token.finished) { return; }
      token.finished = true;
      if (timer) { clearTimeout(timer); }
      node.textContent = text;
      node.classList.remove('typing');
      if (activeTypewriter === token) { activeTypewriter = null; }
      if (done) { done(); }
    };
    token.cancel = finish;
    activeTypewriter = token;
    if (!text) { finish(); return; }
    node.classList.add('typing');
    var index = 0;
    var length = text.length;
    var delay = Math.max(7, Math.min(32, 2200 / Math.max(1, length)));
    var step = function () {
      if (token.finished) { return; }
      index += 1;
      node.textContent = text.slice(0, index);
      if (index < length) { timer = setTimeout(step, delay); }
      else { finish(); }
    };
    timer = setTimeout(step, delay);
    node.addEventListener('click', finish, { once: true });
  }

  function byId(id) { return document.getElementById(id); }
  function el(tag, className, textValue) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (textValue !== undefined && textValue !== null) { node.textContent = String(textValue); }
    return node;
  }
  function shortSession(value) {
    var text = String(value || '');
    return text.length > 14 ? text.slice(0, 6) + '…' + text.slice(-4) : text;
  }

  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  async function api(path, options) {
    options = options || {};
    var timeoutMs = options.timeout || 60000;
    var attempt = 0;
    while (true) {
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
      try {
        var headers = { 'Content-Type': 'application/json', 'X-WXBST-Session': state.sessionId };
        if (state.currentTool) { headers['X-WXBST-Tool'] = state.currentTool; }
        var init = {
          method: options.method || 'GET',
          headers: headers,
          credentials: 'same-origin',
          signal: controller.signal
        };
        if (options.body !== undefined) { init.body = JSON.stringify(options.body); }
        var response = await fetch(path, init);
        var raw = await response.text();
        var data = null;
        if (raw) {
          try { data = JSON.parse(raw); }
          catch (error) { throw new Error('服务返回无法解析的数据（HTTP ' + response.status + '）'); }
        }
        if (!response.ok || (data && data.error)) {
          var message = data && data.error && data.error.message ? data.error.message : ('请求失败（HTTP ' + response.status + '）');
          throw new Error(message);
        }
        return data;
      } catch (error) {
        var retryable = error && (error.name === 'AbortError' || error.name === 'TypeError');
        if (retryable && attempt < 1) {
          attempt += 1;
          await sleep(400);
          continue;
        }
        if (error && error.name === 'AbortError') { throw new Error('请求超时，请确认服务状态后重试。'); }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
  }

  function appendMessage(role, text) {
    var msg = el('div', 'msg ' + role);
    var avatar = el('div', 'msg-avatar', role === 'user' ? '我' : '智');
    var main = el('div', 'msg-main');
    var bubble = el('div', 'bubble');
    if (text) { bubble.appendChild(el('p', '', text)); }
    main.appendChild(bubble);
    msg.appendChild(avatar);
    msg.appendChild(main);
    dom.messages.appendChild(msg);
    hideEmpty();
    scrollToBottom();
    return { msg: msg, bubble: bubble, main: main };
  }

  function addAssistantShell() {
    var shell = appendMessage('assistant', '');
    shell.bubble.appendChild(el('p', '', '智能体正在规划工具调用…'));
    return shell;
  }

  function hideEmpty() {
    if (dom.chatEmpty) { dom.chatEmpty.style.display = 'none'; }
  }

  function scrollToBottom() {
    dom.chatBody.scrollTop = dom.chatBody.scrollHeight;
  }

  function toolChips(container, calls) {
    if (!calls || !calls.length) { return; }
    var row = el('div', 'tool-chips');
    calls.forEach(function (call) {
      var chip = el('span', 'tool-chip' + (call.ok === false ? ' err' : ' ok'));
      chip.textContent = '🔧 ' + (call.name || call.tool) + (call.detail ? ' · ' + call.detail : '');
      row.appendChild(chip);
    });
    container.appendChild(row);
  }

  function section(container, title) {
    var block = el('div', 'answer-block');
    block.appendChild(el('h4', '', title));
    container.appendChild(block);
    return block;
  }

  function renderDiagnosis(container, data, toolName) {
    var text = data.text || '';
    if (data.answerType === 'REFUSAL') {
      var refusal = section(container, data.intent === 'DANGER' ? '安全拦截' : '未命中可靠证据');
      refusal.appendChild(el('p', 'conclusion', data.conclusion || '暂不给出结论。'));
      if (data.clarify) { refusal.appendChild(el('p', '', '需要补充：' + data.clarify)); }
      (data.actions || []).forEach(function (action) {
        refusal.appendChild(el('p', '', '• ' + (action.action || action)));
      });
      if (data.risks) { refusal.appendChild(el('div', 'risk-text', data.risks)); }
      if (data.citations && data.citations.length) { citations(container, data); }
      return;
    }
    var isConcept = data.answerType === 'CONCEPT';
    var isProcess = data.answerType === 'PROCESS';
    var head = section(container, isConcept ? '知识要点' : (isProcess ? '工艺计算 / 选型' : '诊断结论'));
    var conclusionEl = el('p', 'conclusion typing');
    head.appendChild(conclusionEl);
    var detailsDone = false;
    var finish = function () {
      if (detailsDone) { return; }
      detailsDone = true;
      conclusionEl.classList.remove('typing');
      renderDetails();
    };
    conclusionEl.addEventListener('click', finish);
    var renderDetails = function () {
    var causes = data.causes || [];
    if (causes.length) {
      var block = section(container, isConcept ? '核心要点' : (isProcess ? '关键参数与公式' : '可能原因（按概率排序）'));
      var table = el('table', 'causes');
      var thead = el('thead');
      var headRow = el('tr');
      var headers = isConcept ? ['要点', '说明', '检查 / 验证'] : (isProcess ? ['关键参数', '权重', '说明'] : ['原因', '概率', '验证方法']);
      headers.forEach(function (title) { headRow.appendChild(el('th', '', title)); });
      thead.appendChild(headRow);
      table.appendChild(thead);
      var tbody = el('tbody');
      causes.forEach(function (cause) {
        var row = el('tr');
        row.appendChild(el('td', '', cause.rootCause || ''));
        var probCell = el('td');
        if (isConcept) {
          probCell.textContent = cause.basis || '';
        } else {
          var prob = el('span', 'prob ' + (cause.probability || 'MEDIUM'), cause.probability || 'MEDIUM');
          probCell.appendChild(prob);
        }
        row.appendChild(probCell);
        row.appendChild(el('td', '', isProcess && cause.basis ? cause.basis : (cause.verifyMethod || '—')));
        tbody.appendChild(row);
      });
      table.appendChild(tbody);
      block.appendChild(table);
    }
    var actions = data.actions || [];
    if (actions.length) {
      var actionBlock = section(container, isConcept ? '维护与检查要点' : (isProcess ? '计算与选型步骤' : '处置步骤'));
      var list = el('ol', 'actions');
      actions.forEach(function (action) {
        var item = el('li', '', action.action || '');
        var risk = el('span', 'risk ' + (action.riskLevel || 'MEDIUM'), action.riskLevel || 'MEDIUM');
        item.appendChild(risk);
        if (action.criterion) { item.appendChild(document.createTextNode('（判据：' + action.criterion + '）')); }
        list.appendChild(item);
      });
      actionBlock.appendChild(list);
    }
    if (data.risks) { section(container, '风险提示').appendChild(el('div', 'risk-text', data.risks)); }
    citations(container, data);
    addFollowups(container, [
      { label: '进入排查引导', prompt: '进入排查引导' },
      { label: '生成点检清单', prompt: '给 ' + (data.equipmentCode || state.equipmentCode || '当前设备') + ' 生成日点检清单' },
      { label: '查看异常看板', prompt: '看一下异常看板' }
    ]);
    };
    typewriter(conclusionEl, data.conclusion || '', finish);
  }

  function citations(container, data) {
    var sources = data.sources || [];
    var ids = data.citations || [];
    if (!ids.length) { return; }
    var block = section(container, '引用来源');
    var row = el('div', 'citations');
    ids.forEach(function (id) {
      var title = id;
      sources.forEach(function (source) { if (source.id === id) { title = id + ' · ' + source.title; } });
      row.appendChild(el('span', 'citation', title));
    });
    block.appendChild(row);
  }

  function renderGuide(container, data) {
    state.guide = {
      active: !data.isLeaf && !!data.question,
      treeId: data.treeId || '',
      nodeId: data.nodeId || ''
    };
    var block = section(container, '排查引导' + (data.treeName ? ' · ' + data.treeName : ''));
    if (data.isLeaf) {
      block.appendChild(el('p', 'conclusion', data.conclusion || '本轮排查结束。'));
      if (data.actions && data.actions.length) {
        var list = el('ol', 'actions');
        data.actions.forEach(function (action) { list.appendChild(el('li', '', action)); });
        block.appendChild(list);
      }
      addFollowups(container, [
        { label: '生成点检清单', prompt: '生成点检清单' },
        { label: '查看异常看板', prompt: '看一下异常看板' }
      ]);
      state.guide = null;
      return;
    }
    block.appendChild(el('p', 'guide-question', data.question || '请回答当前问题'));
    if (data.safetyAck) {
      var ack = data.safetyAck;
      var acked = !!(ack.stop || ack.loto || ack.source === 'session');
      block.appendChild(el('div', 'safety-line', acked ? '安全确认：已完成（停机 / 挂牌上锁）' : '安全确认：待确认（停机、断电、挂牌上锁）'));
    }
    var options = data.options || [];
    if (options.length) {
      var row = el('div', 'guide-options');
      options.forEach(function (option) {
        var button = el('button', '', option.answer);
        button.type = 'button';
        button.addEventListener('click', function () { sendMessage(option.answer); });
        row.appendChild(button);
      });
      block.appendChild(row);
    }
  }

  function renderChecklist(container, data) {
    var block = section(container, '点检清单 · ' + (data.equipmentName || ''));
    block.appendChild(el('p', 'conclusion', (data.categoryName || '') + ' · ' + (data.frequencyName || data.frequency) + ' · 共 ' + data.totalCount + ' 项 · ' + data.checklistId));
    var table = el('table', 'checklist-table');
    var head = el('tr');
    ['编号', '项目', '判定标准'].forEach(function (title) { head.appendChild(el('th', '', title)); });
    var thead = el('thead'); thead.appendChild(head); table.appendChild(thead);
    var tbody = el('tbody');
    (data.items || []).slice(0, 8).forEach(function (item) {
      var row = el('tr');
      row.appendChild(el('td', '', item.code));
      row.appendChild(el('td', '', item.name));
      row.appendChild(el('td', '', item.criterion || ''));
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    block.appendChild(table);
    if ((data.items || []).length > 8) {
      block.appendChild(el('p', '', '仅展示前 8 项，完整 ' + data.totalCount + ' 项请到「点检填报」页生成。'));
    }
    var link = el('a', 'citation', '去点检填报 →');
    link.href = '/';
    block.appendChild(link);
  }

  function renderDashboard(container, data) {
    var summary = data.summary || {};
    var block = section(container, '异常看板 · 近 7 天');
    var grid = el('div', 'stat-grid');
    [['点检提交', summary.submissions], ['异常项', summary.anomalies], ['高风险', summary.highRisk], ['未闭环工单', summary.openWorkOrders]].forEach(function (pair) {
      var cell = el('div', 'stat');
      cell.appendChild(el('b', '', pair[1] === undefined ? '—' : pair[1]));
      cell.appendChild(el('span', '', pair[0]));
      grid.appendChild(cell);
    });
    block.appendChild(grid);
    var categories = data.byCategory || [];
    if (categories.length) {
      var catBlock = section(container, '按类别分布');
      categories.forEach(function (item) {
        catBlock.appendChild(el('p', '', '• ' + (item.categoryName || item.category) + '：' + item.count + ' 项'));
      });
    }
    addFollowups(container, [{ label: '生成点检清单', prompt: '生成点检清单' }]);
  }

  function renderWorkorder(container, workorder) {
    var block = section(container, '工单');
    var card = el('div', 'wo-card');
    card.appendChild(el('p', '', '工单号：' + (workorder.workorderNo || workorder.workorderId || '—')));
    card.appendChild(el('p', '', '设备：' + (workorder.equipmentName || '—') + ' · 等级：' + (workorder.severity || '—')));
    card.appendChild(el('p', '', '状态：' + (workorder.status || '—') + (workorder.anomalyId ? ' · 来源异常：' + workorder.anomalyId : '')));
    block.appendChild(card);
  }

  function renderEquipment(container, list) {
    var block = section(container, '设备台账');
    if (!list.length) { block.appendChild(el('p', '', '未找到匹配设备。')); return; }
    list.slice(0, 8).forEach(function (equipment) {
      block.appendChild(el('p', '', '• ' + equipment.name + '（' + equipment.equipmentCode + '）· ' + (equipment.location || '')));
    });
    addFollowups(container, [{ label: '问这台设备的故障', prompt: '帮我看一下这台设备的常见故障' }]);
  }

  function addFollowups(container, items) {
    var row = el('div', 'followups');
    items.forEach(function (item) {
      var button = el('button', '', item.label);
      button.type = 'button';
      button.addEventListener('click', function () { sendMessage(item.prompt); });
      row.appendChild(button);
    });
    container.appendChild(row);
  }


  function parseCalcQuery(message) {
    var text = String(message || '');
    var num = function (regex) {
      var m = text.match(regex);
      return m ? Number(m[1]) : 0;
    };
    if (/底流/.test(text)) {
      var q = num(/(?:溢流流量|给矿量|处理量)\s*([\d.]+)/) || num(/([\d.]+)\s*m³\/h/);
      var range = text.match(/由\s*([\d.]+)\s*%\s*提升至\s*([\d.]+)\s*%/);
      var cf = range ? Number(range[1]) : num(/给矿浓度\s*([\d.]+)\s*%/);
      var cu = range ? Number(range[2]) : num(/底流浓度\s*([\d.]+)\s*%/);
      if (q && cf && cu) return { def: CALC_DEFS.underflow, values: { q: q, cf: cf, cu: cu } };
    }
    if (/密度/.test(text) && /固体密度|矿浆密度/.test(text)) {
      var c = num(/(?:矿浆)?浓度\s*([\d.]+)\s*%/);
      var rs = num(/固体密度\s*([\d.]+)/);
      var rw = num(/清水密度\s*([\d.]+)/) || 1;
      if (c && rs) return { def: CALC_DEFS.density, values: { c: c, rs: rs, rw: rw } };
    }
    if (/体积|处理量/.test(text)) {
      var qv = num(/处理量\s*([\d.]+)\s*t\/h/) || num(/([\d.]+)\s*t\/h/);
      var cv = num(/(?:原矿|矿浆|质量)?浓度\s*([\d.]+)\s*%/);
      var rho = num(/(?:矿浆)?密度\s*([\d.]+)\s*t\/m³/) || num(/密度\s*([\d.]+)/);
      if (qv && cv && rho) return { def: CALC_DEFS.volume, values: { q: qv, c: cv, rho: rho } };
    }
    return null;
  }

  function isGeneralKnowledgeQuery(text) {
    return /旋流器|浓密机|球磨机|浮选|渣浆泵|回转窑|给料机|真空|过滤|磨矿|选型|计算|求|多少|密度|浓度|压力|细度|溢流|底流|机理|原理|差别|区别|是什么/.test(String(text || "")) &&
      !/这台|当前设备|该设备|本设备/.test(String(text || ""));
  }

  function plan(message) {
    var text = String(message || '').trim();
    if (state.guide && state.guide.active && text.length <= 16 &&
        /^(是|否|不确定|已确认|已完成|完成|无法完成|正常|异常|有|没有|不能|可以|刀|气)/.test(text)) {
      return { tool: 'guide_answer', args: { reply: text } };
    }
    if (/点检|检查表|点检表|点检清单|巡检表|生成.*(清单|检查表)|来一份.*清单/.test(text)) { return { tool: 'checklist' }; }
    if (/工单|派单|报修|结案/.test(text)) { return { tool: 'workorder' }; }
    if (/看板|统计|汇总|异常分布|趋势/.test(text)) { return { tool: 'dashboard' }; }
    if (/一步步|逐步|引导|故障树|带我|进入排查/.test(text)) { return { tool: 'guide' }; }
    if (/\d/.test(text) && /(求|计算|算出|估算|换算|多少)/.test(text) && /(体积|密度|底流|矿浆)/.test(text)) { return { tool: 'calculator' }; }
    if (/选型|磨矿|处理量|分级|填充率|容积|控制参数|工艺计算|设备选型方案/.test(text)) { return { tool: 'fault_qa' }; }
    if (/设备(参数|台账|安全规则)|查一下设备|设备信息|设备清单/.test(text)) { return { tool: 'equipment' }; }
    return { tool: 'fault_qa' };
  }

  function findEquipment(text) {
    var codeMatch = String(text || '').match(/EQ-[A-Z0-9-]+/i);
    if (codeMatch) {
      var code = codeMatch[0].toUpperCase();
      for (var i = 0; i < state.equipment.length; i++) {
        if (state.equipment[i].equipmentCode === code) { return state.equipment[i]; }
      }
    }
    var low = String(text || '');
    for (var j = 0; j < state.equipment.length; j++) {
      var equipment = state.equipment[j];
      var tokens = [equipment.name, equipment.category]
        .concat(String(equipment.name || '').split(/[\s（）()、,，/]+/))
        .concat(equipment.aliases || [])
        .concat(equipment.commonFaults || []);
      for (var k = 0; k < tokens.length; k++) {
        var token = String(tokens[k] || '');
        if (token && token.length >= 2 && low.indexOf(token) !== -1) { return equipment; }
      }
    }
    if (state.equipmentCode) {
      for (var m = 0; m < state.equipment.length; m++) {
        if (state.equipment[m].equipmentCode === state.equipmentCode) { return state.equipment[m]; }
      }
    }
    return state.equipment[0] || null;
  }

  async function runTool(action, message) {
    var tool = action.tool;
    state.currentTool = tool;
    if (tool === 'guide_answer') {
      var answer = await api('/api/troubleshoot/answer', { method: 'POST', body: { sessionId: state.sessionId, reply: action.args.reply } });
      return { tool: tool, ok: true, detail: answer.nodeId || '', render: function (container) { renderGuide(container, answer); } };
    }
    if (tool === 'checklist') {
      var equipment = findEquipment(message);
      if (!equipment) { throw new Error('没有找到设备，请先选择设备或在问题里带设备编码。'); }
      var frequency = /周/.test(message) ? 'W' : (/月/.test(message) ? 'M' : 'D');
      var checklist = await api('/api/checklists/generate', { method: 'POST', body: { equipmentCode: equipment.equipmentCode, frequency: frequency } });
      return { tool: tool, ok: true, detail: equipment.equipmentCode, render: function (container) { renderChecklist(container, checklist); } };
    }
    if (tool === 'dashboard') {
      var dashboard = await api('/api/dashboard?days=7');
      return { tool: tool, ok: true, detail: '近 7 天', render: function (container) { renderDashboard(container, dashboard); } };
    }
    if (tool === 'workorder') {
      var anomalyMatch = String(message || '').match(/AN-\d{8}-\d{3,4}/i);
      if (!anomalyMatch) {
        return {
          tool: tool, ok: true, detail: '需要异常编号',
          render: function (container) {
            var block = section(container, '创建工单');
            block.appendChild(el('p', 'conclusion', '工单由点检异常生成。请先在「点检填报」提交一条异常，再把异常编号（如 AN-20261027-001）发给我。'));
            addFollowups(container, [{ label: '生成点检清单', prompt: '生成点检清单' }, { label: '查看异常看板', prompt: '看一下异常看板' }]);
          }
        };
      }
      var workorder = await api('/api/workorders', { method: 'POST', body: { anomalyId: anomalyMatch[0].toUpperCase(), note: message, operator: 'teacher' } });
      return { tool: tool, ok: true, detail: workorder.workorderNo || '', render: function (container) { renderWorkorder(container, workorder); } };
    }

    if (tool === 'calculator') {
      var calc = parseCalcQuery(message);
      if (!calc) {
        return {
          tool: 'calculator', ok: true, detail: '请在右侧计算器输入',
          render: function (container) {
            var block = section(container, '工艺计算');
            block.appendChild(el('p', 'conclusion', '已识别为工艺计算，请使用右侧“工艺计算器”输入参数；也可直接在消息中给出“处理量/浓度/密度/底流浓度”等数值。'));
          }
        };
      }
      var out = calc.def.compute(calc.values);
      return {
        tool: 'calculator', ok: true, detail: '网页自算',
        render: function (container) {
          var block = section(container, '工艺计算（网页自算）');
          if (!out) {
            block.appendChild(el('p', 'conclusion', '输入数值不完整，请在右侧计算器补充。'));
            return;
          }
          block.appendChild(el('p', 'conclusion', out.main));
          out.lines.forEach(function (line) { block.appendChild(el('div', 'kb-source-line', line)); });
          block.appendChild(el('div', 'kb-risk', '结果为简化静态计算，工程选型需用流量计/浓度计与试验数据复核。'));
        }
      };
    }
    if (tool === 'equipment') {
      var list = await api('/api/equipment');
      return { tool: tool, ok: true, detail: '13 台', render: function (container) { renderEquipment(container, list); } };
    }
    if (tool === 'guide') {
      var guide = await api('/api/chat', { method: 'POST', body: { sessionId: state.sessionId, message: message, role: 'student', equipmentCode: isGeneralKnowledgeQuery(message) ? "" : state.equipmentCode } });
      if (guide.tree) {
        return { tool: tool, ok: true, detail: guide.tree.treeId || '', render: function (container) { renderGuide(container, guide.tree); } };
      }
      return { tool: 'fault_qa', ok: true, detail: (guide.citations || []).length + ' 条引用', render: function (container) { renderDiagnosis(container, guide); } };
    }
    var diagnosis = await api('/api/chat', { method: 'POST', body: { sessionId: state.sessionId, message: message, role: 'student', equipmentCode: isGeneralKnowledgeQuery(message) ? '' : state.equipmentCode } });
    return {
      tool: 'fault_qa', ok: true,
      detail: (diagnosis.citations || []).length + ' 条引用',
      render: function (container) {
        if (diagnosis.tree) { renderGuide(container, diagnosis.tree); return; }
        renderDiagnosis(container, diagnosis);
      }
    };
  }

  async function sendMessage(rawMessage) {
    var message = String(rawMessage || '').trim();
    if (!message || state.busy) { return; }
    if (message.length > 2000) { message = message.slice(0, 2000); }
    state.busy = true;
    if (activeTypewriter) { activeTypewriter.cancel(); }
    dom.sendBtn.disabled = true;
    appendMessage('user', message);
    var shell = addAssistantShell();
    try {
      var action = plan(message);
      var outcome = await runTool(action, message);
      state.toolCalls += 1;
      dom.toolCount.textContent = state.toolCalls + ' 次';
      shell.bubble.textContent = '';
      toolChips(shell.bubble, [{
        name: TOOL_META[outcome.tool] ? TOOL_META[outcome.tool].name : outcome.tool,
        detail: outcome.detail,
        ok: outcome.ok !== false
      }]);
      outcome.render(shell.bubble);
      scrollToBottom();
    } catch (error) {
      shell.bubble.textContent = '';
      toolChips(shell.bubble, [{ tool: 'error', name: '工具调用失败', detail: error.message, ok: false }]);
      shell.bubble.appendChild(el('p', '', '刚才的工具调用没有成功：' + error.message));
      shell.bubble.appendChild(el('p', '', '请确认服务已启动，或换一种说法重试。'));
    } finally {
      state.busy = false;
      dom.sendBtn.disabled = false;
      dom.chatInput.focus();
    }
  }

  function renderToolList() {
    Object.keys(TOOL_META).filter(function (key) { return key !== 'guide_answer'; }).forEach(function (key) {
      var item = document.createElement('li');
      item.appendChild(el('b', '', TOOL_META[key].name));
      item.appendChild(el('span', '', TOOL_META[key].desc));
      dom.toolList.appendChild(item);
    });
  }

  function bindEvents() {
    dom.form.addEventListener('submit', function (event) {
      event.preventDefault();
      var value = dom.chatInput.value;
      dom.chatInput.value = '';
      updateCount();
      sendMessage(value);
    });
    dom.chatInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        dom.form.requestSubmit();
      }
    });
    dom.chatInput.addEventListener('input', updateCount);
    document.querySelectorAll('#suggestions button').forEach(function (button) {
      button.addEventListener('click', function () { sendMessage(button.getAttribute('data-prompt')); });
    });
    dom.equipmentSelect.addEventListener('change', function () {
      state.equipmentCode = dom.equipmentSelect.value;
    });
  }

  function updateCount() {
    dom.charCount.textContent = dom.chatInput.value.length + ' / 1000';
  }

  async function loadHealth() {
    try {
      var health = await api('/api/health');
      var offline = health.mode === 'offline';
      dom.modeBadge.className = 'mode-badge ' + (offline ? 'offline' : 'online');
      dom.modeText.textContent = offline ? '离线模式' : '在线模式';
      dom.runMode.textContent = offline ? '离线检索 + 工具编排' : 'LLM + 工具编排';
      var stats = health.stats || {};
      dom.kbMeta.textContent = (stats.knowledge || 0) + ' 条知识 / ' + (stats.equipment || 0) + ' 台设备';
    } catch (error) {
      dom.modeText.textContent = '服务未连接';
      dom.modeBadge.className = 'mode-badge';
    }
  }

  async function loadEquipment() {
    try {
      state.equipment = await api('/api/equipment');
      dom.equipmentSelect.textContent = '';
      state.equipment.forEach(function (equipment) {
        var option = document.createElement('option');
        option.value = equipment.equipmentCode;
        option.textContent = equipment.name + '（' + equipment.equipmentCode + '）';
        dom.equipmentSelect.appendChild(option);
      });
      if (state.equipment.length) {
        state.equipmentCode = state.equipment[0].equipmentCode;
        dom.equipmentSelect.value = state.equipmentCode;
      }
      dom.sessionMeta.textContent = shortSession(state.sessionId);
    } catch (error) {
      dom.sessionMeta.textContent = '设备加载失败';
    }
  }


  // ---------- 工艺计算器 ----------
  var CALC_DEFS = {
    volume: {
      fields: [
        { key: 'q', label: '干矿处理量 (t/h)', value: '50' },
        { key: 'c', label: '质量浓度 (%)', value: '70' },
        { key: 'rho', label: '矿浆密度 (t/m³)', value: '1.9' }
      ],
      compute: function (v) {
        if (!(v.q > 0 && v.c > 0 && v.c < 100 && v.rho > 0)) return null;
        var c = v.c / 100;
        var mass = v.q / c;
        var vol = mass / v.rho;
        var water = mass - v.q;
        return {
          main: '矿浆体积 ≈ ' + fmt(vol) + ' m³/h',
          lines: [
            '矿浆质量流量 = Q / C = ' + fmt(v.q) + ' / ' + fmt(c, 3) + ' = ' + fmt(mass) + ' t/h',
            '矿浆体积 = 质量流量 / 密度 = ' + fmt(mass) + ' / ' + fmt(v.rho) + ' = ' + fmt(vol) + ' m³/h',
            '其中水质量 ≈ ' + fmt(water) + ' t/h'
          ]
        };
      }
    },
    density: {
      fields: [
        { key: 'c', label: '质量浓度 (%)', value: '35' },
        { key: 'rs', label: '固体密度 (t/m³)', value: '2.7' },
        { key: 'rw', label: '清水密度 (t/m³)', value: '1' }
      ],
      compute: function (v) {
        if (!(v.c > 0 && v.c < 100 && v.rs > 0 && v.rw > 0)) return null;
        var c = v.c / 100;
        var inv = c / v.rs + (1 - c) / v.rw;
        var rho = 1 / inv;
        return {
          main: '矿浆密度 ≈ ' + fmt(rho) + ' t/m³',
          lines: [
            '1/ρ = C/ρs + (1-C)/ρw = ' + fmt(c, 3) + '/' + fmt(v.rs) + ' + ' + fmt(1 - c, 3) + '/' + fmt(v.rw),
            '1/ρ = ' + fmt(inv, 4) + '，ρ = ' + fmt(rho) + ' t/m³'
          ]
        };
      }
    },
    underflow: {
      fields: [
        { key: 'q', label: '给矿量 / 溢流量 (m³/h)', value: '180' },
        { key: 'cf', label: '给矿浓度 (%)', value: '40' },
        { key: 'cu', label: '目标底流浓度 (%)', value: '55' }
      ],
      compute: function (v) {
        if (!(v.q > 0 && v.cf > 0 && v.cu > 0 && v.cf < 100 && v.cu < 100)) return null;
        var cf = v.cf / 100, cu = v.cu / 100;
        var qu = v.q * cf / cu;
        var qo = v.q - qu;
        var lines = [
          '若 ' + fmt(v.q) + ' 为给矿量：Q底流 = Q给 × C给 / C底 = ' + fmt(qu) + ' m³/h',
          '对应溢流 ≈ ' + fmt(qo) + ' m³/h'
        ];
        if (cu > cf) {
          var alt = cf * v.q / (cu - cf);
          lines.push('若 ' + fmt(v.q) + ' 为溢流量：Q底流 ≈ ' + fmt(alt) + ' m³/h（给矿量 ≈ ' + fmt(alt + v.q) + ' m³/h）');
        }
        return { main: '底流流量估算：' + fmt(qu) + ' m³/h（按给矿量理解）', lines: lines };
      }
    }
  };

  function fmt(value, digits) {
    if (!isFinite(value)) return '—';
    var d = digits === undefined ? 2 : digits;
    return Number(value).toFixed(d);
  }
  function calcFieldValue(key) {
    var node = byId('calc_' + key);
    var value = node ? Number(node.value) : 0;
    return isFinite(value) ? value : 0;
  }
  function renderCalcFields() {
    var select = byId('calcType');
    var host = byId('calcFields');
    var result = byId('calcResult');
    if (!select || !host) return;
    var def = CALC_DEFS[select.value] || CALC_DEFS.volume;
    host.textContent = '';
    def.fields.forEach(function (field) {
      var label = el('label', 'calc-field');
      label.appendChild(el('span', '', field.label));
      var input = el('input', 'calc-input');
      input.id = 'calc_' + field.key;
      input.type = 'number';
      input.step = 'any';
      input.value = field.value;
      label.appendChild(input);
      host.appendChild(label);
    });
    if (result) { result.hidden = true; result.textContent = ''; }
  }
  function runCalc() {
    var select = byId('calcType');
    var result = byId('calcResult');
    if (!select || !result) return;
    var def = CALC_DEFS[select.value] || CALC_DEFS.volume;
    var values = {};
    def.fields.forEach(function (field) { values[field.key] = calcFieldValue(field.key); });
    var out = def.compute(values);
    result.textContent = '';
    if (!out) {
      result.appendChild(el('div', 'calc-error', '请输入有效数值（浓度 0–100，密度/处理量大于 0）。'));
    } else {
      result.appendChild(el('div', 'calc-main', out.main));
      out.lines.forEach(function (line) { result.appendChild(el('div', 'calc-line', line)); });
      result.appendChild(el('div', 'calc-note', '结果为简化静态计算，工程选型需用流量计/浓度计与试验数据复核。'));
    }
    result.hidden = false;
  }
  function initCalculator() {
    var select = byId('calcType');
    if (!select) return;
    renderCalcFields();
    select.addEventListener('change', renderCalcFields);
    var button = byId('calcBtn');
    if (button) button.addEventListener('click', runCalc);
  }

  function init() {
    if (window.self !== window.top) { document.body.classList.add('embedded'); }
    dom = {
      modeBadge: byId('modeBadge'),
      modeText: byId('modeText'),
      equipmentSelect: byId('equipmentSelect'),
      chatBody: byId('chatBody'),
      chatEmpty: byId('chatEmpty'),
      messages: byId('messages'),
      form: byId('chatForm'),
      chatInput: byId('chatInput'),
      charCount: byId('charCount'),
      sendBtn: byId('sendBtn'),
      toolList: byId('toolList'),
      sessionMeta: byId('sessionMeta'),
      runMode: byId('runMode'),
      kbMeta: byId('kbMeta'),
      toolCount: byId('toolCount')
    };
    renderToolList();
    bindEvents();
    initCalculator();
    updateCount();
    loadHealth();
    loadEquipment();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
