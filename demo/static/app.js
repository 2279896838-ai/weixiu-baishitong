/* =========================================================
   维修百事通 · 设备故障诊断助手
   纯原生 JS：问答 / 排查引导 / 点检 / 看板 / 工单
   动态内容统一使用 textContent，避免 XSS。
   ========================================================= */
(function () {
  'use strict';

  var CATEGORY_LABELS = {
    LATHE: '数控车床', MILL: '加工中心', PRN: '3D 打印机', LSR: '激光切割机',
    CMP: '空压机', MOT: '电机', PWR: '配电柜',
    CCM: '连铸机', FUR: '加热炉', ROL: '轧机', FAN: '除尘风机', HYD: '液压站', EAF: '电弧炉', BAL: '球磨机', KIL: '回转窑', THK: '浓密机', GEN: '通用设备',
    CNC: '数控机床', AIR: '空压机', GEN: '通用设备', OTHER: '其他类别'
  };
  var INTENT_LABELS = {
    QA: '故障诊断', TRG: '排查引导', CHK: '点检', WO: '工单',
    CHAT: '一般问答', DANGER: '安全告警', UNKNOWN: '未识别'
  };
  var PROB_RANK = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  var SEV_LABEL = { HIGH: '高', MEDIUM: '中', LOW: '低' };
  var ACK_LABELS = {
    stop: '停机', isolate: '断电', loto: '挂牌上锁', lockout: 'LOTO',
    verifyZero: '验电', depressurized: '泄压', ppe: '防护', ventilation: '通风',
    coolDown: '降温', zeroEnergy: '零能量'
  };
  var STATUS_META = {
    DRAFT: { label: '草稿', tone: 'gray', kind: 'open' },
    PENDING_CONFIRM: { label: '待确认', tone: 'amber', kind: 'open' },
    ASSIGNED: { label: '已派单', tone: 'blue', kind: 'open' },
    ACCEPTED: { label: '已接单', tone: 'blue', kind: 'open' },
    IN_PROGRESS: { label: '处理中', tone: 'amber', kind: 'progress' },
    PENDING_ACCEPTANCE: { label: '待验收', tone: 'purple', kind: 'open' },
    CLOSED: { label: '已结案', tone: 'green', kind: 'closed' },
    ON_HOLD: { label: '已挂起', tone: 'gray', kind: 'open' },
    OPEN: { label: '待处理', tone: 'amber', kind: 'open' },
    NEW: { label: '待处理', tone: 'amber', kind: 'open' },
    PROCESSING: { label: '处理中', tone: 'amber', kind: 'progress' },
    RESOLVED: { label: '已解决', tone: 'green', kind: 'closed' },
    DONE: { label: '已完成', tone: 'green', kind: 'closed' }
  };
  var STATUS_NEXT = {
    DRAFT: 'PENDING_CONFIRM', PENDING_CONFIRM: 'ASSIGNED', ASSIGNED: 'ACCEPTED',
    ACCEPTED: 'IN_PROGRESS', OPEN: 'IN_PROGRESS', NEW: 'IN_PROGRESS', ON_HOLD: 'IN_PROGRESS'
  };
  var STATUS_ACTION = {
    PENDING_CONFIRM: '提交确认', ASSIGNED: '确认派单', ACCEPTED: '确认接单', IN_PROGRESS: '开始处理'
  };

  function byId(id) { return document.getElementById(id); }

  var dom = {
    topProgress: byId('topProgress'), modeBadge: byId('modeBadge'), modeText: byId('modeText'),
    equipmentSelect: byId('equipmentSelect'), refreshEquipmentBtn: byId('refreshEquipmentBtn'),
    sessionMeta: byId('sessionMeta'), globalAlert: byId('globalAlert'),
    globalAlertTitle: byId('globalAlertTitle'), globalAlertText: byId('globalAlertText'),
    globalAlertRetry: byId('globalAlertRetry'),
    chatBody: byId('chatBody'), chatEmpty: byId('chatEmpty'), messages: byId('messages'),
    typingIndicator: byId('typingIndicator'), typingText: byId('typingText'),
    guideStatePill: byId('guideStatePill'), clearChatBtn: byId('clearChatBtn'),
    promptChips: byId('promptChips'), guideBanner: byId('guideBanner'),
    guideBannerText: byId('guideBannerText'), exitGuideBtn: byId('exitGuideBtn'),
    chatForm: byId('chatForm'), chatInput: byId('chatInput'), charCount: byId('charCount'),
    sendBtn: byId('sendBtn'), sendBtnText: byId('sendBtnText'),
    equipmentCategoryTag: byId('equipmentCategoryTag'), equipmentDetail: byId('equipmentDetail'),
    sideMeta: byId('sideMeta'),
    checkEquipment: byId('checkEquipment'), checkFrequency: byId('checkFrequency'),
    generateChecklistBtn: byId('generateChecklistBtn'), checklistAlert: byId('checklistAlert'),
    checklistEmpty: byId('checklistEmpty'), checklistLoading: byId('checklistLoading'),
    checklistWorkspace: byId('checklistWorkspace'), checklistTitle: byId('checklistTitle'),
    checklistMeta: byId('checklistMeta'), operatorInput: byId('operatorInput'),
    overallNote: byId('overallNote'), checklistTbody: byId('checklistTbody'),
    checklistCounts: byId('checklistCounts'), clearChecklistBtn: byId('clearChecklistBtn'),
    submitChecklistBtn: byId('submitChecklistBtn'), submissionResult: byId('submissionResult'),
    summaryGrid: byId('summaryGrid'), dashboardAlert: byId('dashboardAlert'),
    dashboardContent: byId('dashboardContent'), categoryChart: byId('categoryChart'),
    topEquipment: byId('topEquipment'), recentAnomalies: byId('recentAnomalies'),
    chartDaysBadge: byId('chartDaysBadge'), rangeSwitch: byId('rangeSwitch'),
    refreshDashboardBtn: byId('refreshDashboardBtn'),
    refreshDashboardInlineBtn: byId('refreshDashboardInlineBtn'),
    workorderNotice: byId('workorderNotice'), woFilterBar: byId('woFilterBar'),
    woCountAll: byId('woCountAll'), woCountOpen: byId('woCountOpen'),
    woCountClosed: byId('woCountClosed'), workorderList: byId('workorderList'),
    workorderEmpty: byId('workorderEmpty'), refreshWorkordersBtn: byId('refreshWorkordersBtn'),
    modalHost: byId('modalHost'), modalBackdrop: byId('modalBackdrop'),
    modalCloseBtn: byId('modalCloseBtn'), modalCancelBtn: byId('modalCancelBtn'),
    modalTitle: byId('modalTitle'), modalSubtitle: byId('modalSubtitle'),
    closeForm: byId('closeForm'), closeWoId: byId('closeWoId'),
    rootCauseInput: byId('rootCauseInput'), repairActionsInput: byId('repairActionsInput'),
    partsInput: byId('partsInput'), downTimeInput: byId('downTimeInput'),
    acceptorInput: byId('acceptorInput'), closeOperatorInput: byId('closeOperatorInput'),
    residualRiskInput: byId('residualRiskInput'), closeFormAlert: byId('closeFormAlert'),
    closeSubmitBtn: byId('closeSubmitBtn'), toastHost: byId('toastHost'),
    tabs: Array.prototype.slice.call(document.querySelectorAll('.tab')),
    panels: Array.prototype.slice.call(document.querySelectorAll('.tab-panel'))
  };

  var state = {
    pending: 0,
    health: { status: 'loading', mode: 'offline' },
    equipment: [], equipmentCode: '', equipmentLoading: false, equipmentError: null,
    sessionId: makeSessionId(),
    messages: [], chatBusy: false, lastChat: null,
    guide: { active: false, done: false, node: null, synthetic: false },
    checklist: {
      data: null, forSubmit: null, meta: null, items: [], results: [],
      submission: null, loading: false, submitted: false, requestSeq: 0
    },
    dashboard: {
      days: 30, data: null, loaded: false, loading: false, error: null,
      stale: false, requestSeq: 0
    },
    workorders: {
      items: [], loaded: false, loading: false, error: null, filter: 'all',
      stale: false, closingId: null, closingWo: null, submitting: false,
      pending: new Set(), requestSeq: 0
    },
    createInFlight: new Set(),
    activeTab: 'qa', dashboardErrorState: null, lastFocused: null
  };

  // ---------- 通用工具 ----------
  function makeSessionId() {
    return 'SESS-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
  }
  function makeId(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function append(parent) {
    for (var i = 1; i < arguments.length; i++) {
      if (arguments[i]) parent.appendChild(arguments[i]);
    }
    return parent;
  }
  function clearNode(node) { if (node) node.replaceChildren(); }
  function asArray(value) {
    if (value === null || value === undefined) return [];
    return Array.isArray(value) ? value : [value];
  }
  function textOf(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback === undefined ? '—' : fallback;
    if (Array.isArray(value)) {
      var parts = value.map(function (v) { return textOf(v, ''); }).filter(Boolean);
      return parts.length ? parts.join('；') : (fallback === undefined ? '—' : fallback);
    }
    if (typeof value === 'object') {
      return value.name || value.title || value.message || value.action || value.rootCause ||
        (fallback === undefined ? '—' : fallback);
    }
    return String(value);
  }
  function numOf(value) {
    if (typeof value === 'number' && isFinite(value)) return value;
    if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value);
    return null;
  }
  function formatNumber(value) {
    return value === null || value === undefined || !isFinite(value) ? '—' : Number(value).toLocaleString('zh-CN');
  }
  function formatTime(value, withYear) {
    if (!value) return '—';
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    var opts = withYear
      ? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }
      : { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false };
    return new Intl.DateTimeFormat('zh-CN', opts).format(d).replace(/\//g, '-');
  }
  function formatClock(value) {
    var d = value ? new Date(value) : new Date();
    if (isNaN(d.getTime())) d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function truncate(value, max) {
    var s = String(value || '');
    return s.length > max ? s.slice(0, max) + '…' : s;
  }
  function categoryLabel(code) {
    if (!code) return '未分类';
    return CATEGORY_LABELS[String(code).toUpperCase()] || String(code);
  }
  function badge(label, tone, noDot) {
    var node = el('span', 'badge tone-' + (tone || 'gray') + (noDot ? ' no-dot' : ''), label);
    return node;
  }
  function normalizeProbability(value) {
    var p = String(value || '').trim().toUpperCase();
    if (p === 'HIGH' || p === 'MEDIUM' || p === 'LOW') return p;
    if (/高/.test(value)) return 'HIGH';
    if (/中/.test(value)) return 'MEDIUM';
    if (/低/.test(value)) return 'LOW';
    return '';
  }
  function normalizeSeverity(value) {
    var p = String(value || '').trim().toUpperCase();
    if (p === 'HIGH' || p === 'MEDIUM' || p === 'LOW') return p;
    if (/高|严重|紧急/.test(value)) return 'HIGH';
    if (/中/.test(value)) return 'MEDIUM';
    if (/低|轻微/.test(value)) return 'LOW';
    return 'MEDIUM';
  }
  function normalizePriority(value) {
    var p = String(value || '').toUpperCase();
    return /^P[1-4]$/.test(p) ? p : '';
  }
  function normalizeStatus(value) {
    var raw = String(value || '').trim();
    if (!raw) return 'UNKNOWN';
    var cn = {
      '待处理': 'OPEN', '待确认': 'PENDING_CONFIRM', '已派单': 'ASSIGNED',
      '已接单': 'ACCEPTED', '处理中': 'IN_PROGRESS', '待验收': 'PENDING_ACCEPTANCE',
      '已结案': 'CLOSED', '已关闭': 'CLOSED', '已完成': 'CLOSED', '挂起': 'ON_HOLD', '已挂起': 'ON_HOLD'
    };
    return cn[raw] || raw.toUpperCase().replace(/[-\s]/g, '_');
  }
  function statusInfo(status) {
    var key = normalizeStatus(status);
    return STATUS_META[key] || { label: key === 'UNKNOWN' ? '未知状态' : key, tone: 'gray', kind: 'open' };
  }
  function isClosed(status) { return statusInfo(status).kind === 'closed'; }
  function findEquipment(code) {
    for (var i = 0; i < state.equipment.length; i++) {
      if (state.equipment[i].equipmentCode === code) return state.equipment[i];
    }
    return null;
  }
  function selectedEquipment() { return findEquipment(state.equipmentCode); }
  function getOperator() {
    var v = dom.operatorInput ? dom.operatorInput.value.trim() : '';
    return v || '实训学生';
  }
  function shortSession(id) {
    var s = String(id || '').replace(/^SESS-/i, '');
    return s.length > 10 ? s.slice(0, 10) : s;
  }
  function latestTimestamp() { return new Date().toISOString(); }
  function scrollChat() {
    requestAnimationFrame(function () { dom.chatBody.scrollTop = dom.chatBody.scrollHeight; });
  }
  function setButtonBusy(btn, busy) {
    if (!btn) return;
    btn.classList.toggle('is-loading', !!busy);
    btn.disabled = !!busy;
    if (busy) btn.setAttribute('aria-busy', 'true');
    else btn.removeAttribute('aria-busy');
  }
  function focusNoScroll(node) {
    if (!node) return;
    try { node.focus({ preventScroll: true }); } catch (e) { node.focus(); }
  }

  // ---------- 请求与反馈 ----------
  class ApiError extends Error {
    constructor(message, status, code) {
      super(message);
      this.name = 'ApiError';
      this.status = status || 0;
      this.code = code || '';
    }
  }

  function beginRequest() {
    state.pending++;
    if (dom.topProgress) dom.topProgress.classList.add('is-active');
  }
  function endRequest() {
    state.pending = Math.max(0, state.pending - 1);
    if (!state.pending && dom.topProgress) dom.topProgress.classList.remove('is-active');
  }
  function apiMessage(data, status) {
    if (data && data.error) {
      if (typeof data.error === 'string') return data.error;
      if (data.error.message) {
        return data.error.message + (data.error.code ? '（' + data.error.code + '）' : '');
      }
    }
    if (data && typeof data.message === 'string') return data.message;
    return '请求失败（HTTP ' + status + '）';
  }
  async function api(path, options) {
    options = options || {};
    var method = options.method || 'GET';
    var timeout = options.timeout || 25000;
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeout);
    beginRequest();
    try {
      var init = { method: method, signal: controller.signal, credentials: 'same-origin' };
      if (options.body !== undefined) {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify(options.body);
      }
      var response = await fetch(path, init);
      var raw = await response.text();
      var data = null;
      if (raw) {
        try { data = JSON.parse(raw); }
        catch (parseError) {
          throw new ApiError('服务返回了无法解析的数据（HTTP ' + response.status + '）', response.status, 'BAD_JSON');
        }
      }
      if (!response.ok || (data && data.error)) {
        throw new ApiError(apiMessage(data, response.status), response.status, data && data.error && data.error.code);
      }
      return data;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err && err.name === 'AbortError') {
        throw new ApiError('请求超时，请检查服务状态后重试。', 0, 'TIMEOUT');
      }
      throw new ApiError('无法连接后端服务，请确认 demo/server.py 已启动（默认端口 8787）。', 0, 'NETWORK');
    } finally {
      clearTimeout(timer);
      endRequest();
    }
  }

  function toast(message, type, options) {
    type = type || 'info';
    options = options || {};
    if (!dom.toastHost) return;
    while (dom.toastHost.children.length >= 4) dom.toastHost.removeChild(dom.toastHost.firstChild);
    var box = el('div', 'toast is-' + type);
    var icons = { success: '✓', error: '!', warning: '!', info: 'i' };
    append(box, el('span', 'toast-icon', icons[type] || 'i'));
    var copy = el('div', 'toast-copy');
    append(copy, el('strong', '', options.title || (type === 'error' ? '请求失败' : type === 'success' ? '已完成' : type === 'warning' ? '注意' : '提示')),
      el('p', '', message || ''));
    append(box, copy);
    var actions = el('div', 'toast-actions');
    if (options.action) {
      var actionBtn = el('button', 'toast-action', options.action.label || '重试');
      actionBtn.type = 'button';
      actionBtn.addEventListener('click', function () {
        remove();
        try {
          var result = options.action.fn();
          if (result && result.catch) result.catch(function (e) { toast(e && e.message ? e.message : '操作失败', 'error'); });
        } catch (e) { toast(e.message || '操作失败', 'error'); }
      });
      append(actions, actionBtn);
    }
    var closeBtn = el('button', 'toast-close', '×');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', '关闭提示');
    closeBtn.addEventListener('click', remove);
    append(actions, closeBtn);
    append(box, actions);
    dom.toastHost.appendChild(box);
    var timer = setTimeout(remove, options.action ? 9000 : 4800);
    function remove() {
      clearTimeout(timer);
      if (!box.isConnected) return;
      box.classList.add('is-leaving');
      setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 200);
    }
  }

  function showInlineAlert(container, options) {
    if (!container) return;
    options = options || {};
    var type = options.type || 'error';
    container.hidden = false;
    container.className = 'inline-alert' + (type === 'success' ? ' is-success' : '');
    clearNode(container);
    append(container, el('span', 'alert-icon', type === 'success' ? '✓' : '!'));
    var copy = el('div', 'alert-copy');
    append(copy, el('strong', '', options.title || '操作未完成'), el('p', '', options.message || ''));
    append(container, copy);
    if (options.actions && options.actions.length) {
      var wrap = el('div', 'alert-actions');
      options.actions.forEach(function (action) {
        var btn = el('button', 'btn btn-ghost btn-sm', action.label || '重试');
        btn.type = 'button';
        btn.addEventListener('click', function () {
          try {
            var result = action.fn && action.fn();
            if (result && result.catch) result.catch(function (e) { toast(e && e.message ? e.message : '操作失败', 'error'); });
          } catch (e) { toast(e.message || '操作失败', 'error'); }
        });
        wrap.appendChild(btn);
      });
      append(container, wrap);
    }
  }
  function hideInlineAlert(container) {
    if (!container) return;
    container.hidden = true;
    clearNode(container);
  }
  function showGlobalAlert(title, message, retryFn) {
    dom.globalAlert.hidden = false;
    dom.globalAlertTitle.textContent = title;
    dom.globalAlertText.textContent = message;
    dom.globalAlertRetry.onclick = function () {
      if (typeof retryFn !== 'function') return;
      setButtonBusy(dom.globalAlertRetry, true);
      Promise.resolve().then(retryFn).catch(function (e) {
        toast(e && e.message ? e.message : '重试失败', 'error');
      }).finally(function () { setButtonBusy(dom.globalAlertRetry, false); });
    };
  }
  function hideGlobalAlert() { dom.globalAlert.hidden = true; }

  // ---------- 健康状态 ----------
  function updateSessionMeta() {
    dom.sessionMeta.textContent = '会话 ' + shortSession(state.sessionId);
    dom.sessionMeta.title = '当前会话编号：' + state.sessionId;
    if (dom.sideMeta) {
      var mode = state.health.status === 'ok'
        ? (String(state.health.mode).toLowerCase() === 'offline' ? '离线优先' : 'LLM 增强')
        : '离线优先';
      dom.sideMeta.textContent = mode + ' · 本地知识库 · 会话 ' + shortSession(state.sessionId);
    }
  }
  function renderMode() {
    var cls = 'mode-badge';
    if (state.health.status === 'loading') {
      dom.modeText.textContent = '连接中';
      dom.modeBadge.className = cls + ' is-loading';
      dom.modeBadge.title = '正在读取服务模式';
    } else if (state.health.status === 'error') {
      dom.modeText.textContent = '服务未连接';
      dom.modeBadge.className = cls + ' is-error';
      dom.modeBadge.title = state.health.error ? state.health.error.message : '无法连接后端服务';
    } else {
      var mode = String(state.health.mode || 'offline').toLowerCase();
      var isLlm = mode !== 'offline' && mode !== 'none' && mode !== '';
      dom.modeText.textContent = isLlm ? 'LLM 模式' : '离线模式';
      dom.modeBadge.className = cls + (isLlm ? ' is-llm' : ' is-offline');
      dom.modeBadge.title = '服务正常 · 当前模式：' + mode;
    }
    updateSessionMeta();
  }
  async function loadHealth() {
    state.health.status = 'loading';
    renderMode();
    try {
      var data = await api('/api/health');
      if (data && data.status && String(data.status).toLowerCase() !== 'ok') {
        throw new ApiError('服务状态异常：' + data.status, 0, 'HEALTH');
      }
      state.health = { status: 'ok', mode: String((data && data.mode) || 'offline') };
      renderMode();
      hideGlobalAlert();
    } catch (err) {
      state.health = { status: 'error', mode: 'offline', error: err };
      renderMode();
      showGlobalAlert('无法连接后端服务', err.message + ' 请确认已在项目根目录运行 python demo/server.py --port 8787。', retryConnection);
    }
  }
  function retryConnection() {
    return Promise.all([loadHealth(), loadEquipment({ silent: true })]);
  }

  // ---------- 设备 ----------
  function normalizeEquipmentList(data) {
    var raw = Array.isArray(data) ? data : asArray(data && (data.equipment || data.items || data.list || data.data));
    return raw.filter(function (e) { return e && typeof e === 'object'; }).map(function (e, index) {
      var specs = e.specs && typeof e.specs === 'object' && !Array.isArray(e.specs) ? e.specs : {};
      return {
        equipmentCode: String(e.equipmentCode || e.code || e.id || 'EQ-UNKNOWN-' + index),
        name: String(e.name || e.equipmentName || e.model || '未命名设备'),
        category: String(e.category || e.equipmentCategory || ''),
        location: String(e.location || ''),
        brand: String(e.brand || ''),
        specs: specs,
        commonFaults: asArray(e.commonFaults).filter(function (v) { return typeof v === 'string'; }),
        safetyRules: asArray(e.safetyRules).filter(function (v) { return typeof v === 'string'; })
      };
    });
  }
  function fillEquipmentSelect(select, selected) {
    clearNode(select);
    if (!state.equipment.length) {
      var emptyOpt = el('option', '', state.equipmentError ? '设备加载失败，请重试' : '暂无设备数据');
      emptyOpt.value = '';
      select.appendChild(emptyOpt);
      select.disabled = true;
      return;
    }
    state.equipment.forEach(function (eq) {
      var opt = el('option', '', eq.name + '（' + eq.equipmentCode + '）');
      opt.value = eq.equipmentCode;
      select.appendChild(opt);
    });
    select.disabled = false;
    if (selected && findEquipment(selected)) select.value = selected;
  }
  function populateEquipmentSelects(selected) {
    fillEquipmentSelect(dom.equipmentSelect, selected);
    fillEquipmentSelect(dom.checkEquipment, selected);
    if (dom.generateChecklistBtn) dom.generateChecklistBtn.disabled = !state.equipment.length || state.checklist.loading;
  }
  function renderEquipmentDetail() {
    var eq = selectedEquipment();
    dom.equipmentCategoryTag.textContent = eq ? categoryLabel(eq.category) : '—';
    clearNode(dom.equipmentDetail);
    if (state.equipmentLoading && !state.equipment.length) {
      append(dom.equipmentDetail,
        el('div', 'skeleton skeleton-line w-70'),
        el('div', 'skeleton skeleton-line w-45'),
        el('div', 'skeleton skeleton-block'));
      return;
    }
    if (state.equipmentError && !eq) {
      var errBox = el('div', 'side-error', '设备列表加载失败：' + state.equipmentError.message);
      var retry = el('button', 'btn btn-ghost btn-sm', '重新加载');
      retry.type = 'button';
      retry.addEventListener('click', function () { loadEquipment(); });
      errBox.appendChild(retry);
      dom.equipmentDetail.appendChild(errBox);
      return;
    }
    if (!eq) {
      dom.equipmentDetail.appendChild(el('p', 'side-empty', '暂无设备数据。请检查 data/equipment.json 后重新加载。'));
      return;
    }
    append(dom.equipmentDetail,
      el('div', 'equipment-name', eq.name),
      el('div', 'equipment-code', eq.equipmentCode));
    var meta = el('div', 'equipment-meta');
    if (eq.location) {
      var locationRow = el('div');
      append(locationRow, el('span', '', '位置'), el('span', '', eq.location));
      meta.appendChild(locationRow);
    }
    if (eq.brand) {
      var brandRow = el('div');
      append(brandRow, el('span', '', '品牌'), el('span', '', eq.brand));
      meta.appendChild(brandRow);
    }
    if (meta.children.length) dom.equipmentDetail.appendChild(meta);
    var specKeys = Object.keys(eq.specs || {});
    if (specKeys.length) {
      var specs = el('div', 'specs');
      specKeys.slice(0, 4).forEach(function (key) {
        var chip = el('span', 'spec-chip', key + '：' + textOf(eq.specs[key], '—'));
        chip.title = key + '：' + textOf(eq.specs[key], '—');
        specs.appendChild(chip);
      });
      dom.equipmentDetail.appendChild(specs);
    }
    if (eq.commonFaults.length) {
      var faults = el('div', 'fault-tags');
      eq.commonFaults.slice(0, 4).forEach(function (fault) { faults.appendChild(el('span', 'fault-tag', fault)); });
      dom.equipmentDetail.appendChild(faults);
    }
    var safety = el('div', 'safety-rules');
    safety.appendChild(el('b', '', '安全要求'));
    if (eq.safetyRules.length) {
      var ul = el('ul');
      eq.safetyRules.slice(0, 4).forEach(function (rule) { ul.appendChild(el('li', '', rule)); });
      append(safety, ul);
    } else {
      safety.appendChild(el('p', 'side-empty', '暂无设备专属安全规则，请遵循通用停机断电流程。'));
    }
    dom.equipmentDetail.appendChild(safety);
  }
  function selectEquipment(code, options) {
    options = options || {};
    var eq = findEquipment(code);
    if (!eq) return;
    var oldCode = state.equipmentCode;
    state.equipmentCode = eq.equipmentCode;
    dom.equipmentSelect.value = eq.equipmentCode;
    dom.checkEquipment.value = eq.equipmentCode;
    try { localStorage.setItem('wxb-wb-equipment', eq.equipmentCode); } catch (e) { /* 忽略存储限制 */ }
    if (oldCode && oldCode !== eq.equipmentCode) {
      if (state.checklist.data) {
        resetChecklistState();
        toast('设备已切换，原点检清单已清空，请重新生成。', 'warning');
      }
      if (state.guide.active) {
        exitGuide({ silent: true });
        toast('设备已切换，排查引导已结束。', 'warning');
      }
    }
    renderEquipmentDetail();
    updateSessionMeta();
  }
  async function loadEquipment(options) {
    options = options || {};
    if (state.equipmentLoading) return;
    state.equipmentLoading = true;
    state.equipmentError = null;
    dom.equipmentSelect.disabled = true;
    dom.checkEquipment.disabled = true;
    dom.refreshEquipmentBtn.disabled = true;
    renderEquipmentDetail();
    try {
      var data = await api('/api/equipment');
      state.equipment = normalizeEquipmentList(data);
      state.equipmentError = null;
      var saved = null;
      try { saved = localStorage.getItem('wxb-wb-equipment'); } catch (e) { saved = null; }
      var preferred = findEquipment(state.equipmentCode) || findEquipment(saved) || state.equipment[0] || null;
      populateEquipmentSelects(preferred ? preferred.equipmentCode : '');
      if (preferred) {
        selectEquipment(preferred.equipmentCode, { silent: true });
      } else {
        state.equipmentCode = '';
        renderEquipmentDetail();
        toast('设备台账为空，请检查数据包。', 'warning');
      }
    } catch (err) {
      state.equipmentError = err;
      populateEquipmentSelects('');
      renderEquipmentDetail();
      if (!options.silent) {
        toast(err.message, 'error', { title: '设备加载失败', action: { label: '重试', fn: function () { return loadEquipment(); } } });
      }
    } finally {
      state.equipmentLoading = false;
      dom.refreshEquipmentBtn.disabled = false;
      renderEquipmentDetail();
      if (state.equipment.length) {
        dom.equipmentSelect.disabled = false;
        dom.checkEquipment.disabled = false;
      }
      if (dom.generateChecklistBtn) dom.generateChecklistBtn.disabled = !state.equipment.length || state.checklist.loading;
    }
  }

  // ---------- 页签 ----------
  function switchTab(tab) {
    var valid = ['qa', 'checklist', 'dashboard', 'workorders', 'agent'];
    if (valid.indexOf(tab) === -1) tab = 'qa';
    state.activeTab = tab;
    dom.tabs.forEach(function (btn) {
      var on = btn.getAttribute('data-tab') === tab;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      btn.tabIndex = on ? 0 : -1;
    });
    dom.panels.forEach(function (panel) {
      var on = panel.id === 'panel-' + tab;
      panel.hidden = !on;
      panel.classList.toggle('is-active', on);
    });
    if (tab === 'dashboard') ensureDashboard();
    if (tab === 'workorders') ensureWorkorders();
    if (tab === 'qa' && document.activeElement === document.body) setTimeout(function () { focusNoScroll(dom.chatInput); }, 30);
    try { history.replaceState(null, '', '#' + tab); } catch (e) { /* 忽略地址栏限制 */ }
  }
  function ensureDashboard() {
    if (!state.dashboard.loaded || state.dashboard.stale) loadDashboard();
  }
  function ensureWorkorders() {
    if (!state.workorders.loaded || state.workorders.stale) loadWorkorders();
  }

  // ---------- 初始化入口在文件末尾 ----------

  // ---------- 对话输入与消息 ----------
  function updateSendState() {
    if (!dom.sendBtn) return;
    dom.sendBtn.disabled = state.chatBusy || !dom.chatInput.value.trim();
  }
  function resizeComposer() {
    if (!dom.chatInput) return;
    dom.chatInput.style.height = 'auto';
    dom.chatInput.style.height = Math.min(Math.max(dom.chatInput.scrollHeight, 42), 132) + 'px';
  }
  function updateComposerMode() {
    if (state.guide.active) {
      dom.guideStatePill.hidden = false;
      dom.guideBanner.hidden = false;
      dom.chatInput.placeholder = '输入排查结果（如：是 / 否 / 不确定 / 已确认）…';
      dom.sendBtnText.textContent = '回答';
      var q = state.guide.node && state.guide.node.question;
      dom.guideBannerText.textContent = q ? '当前问题：' + truncate(q, 48) : '请按现场检查结果作答。';
    } else {
      dom.guideStatePill.hidden = true;
      dom.guideBanner.hidden = true;
      dom.chatInput.placeholder = '描述故障现象，例如：数控车床主轴转起来咔啦咔啦响…';
      dom.sendBtnText.textContent = '发送';
    }
    updateSendState();
  }
  function showTyping(text) {
    dom.typingText.textContent = text || '正在检索知识库…';
    dom.typingIndicator.hidden = false;
    scrollChat();
  }
  function hideTyping() { dom.typingIndicator.hidden = true; }
  function setChatBusy(busy, text) {
    state.chatBusy = busy;
    dom.chatInput.disabled = busy;
    if (busy) {
      setButtonBusy(dom.sendBtn, true);
      showTyping(text);
    } else {
      setButtonBusy(dom.sendBtn, false);
      hideTyping();
    }
    updateSendState();
  }
  function addMessage(msg) {
    msg.id = msg.id || makeId('msg');
    msg.at = msg.at || new Date().toISOString();
    msg.actionState = msg.actionState || {};
    state.messages.push(msg);
    dom.chatEmpty.hidden = true;
    appendMessage(msg);
    scrollChat();
    return msg;
  }
  function appendMessage(msg) {
    var article = el('article', 'msg ' + (msg.role === 'user' ? 'msg-user' : 'assistant'));
    if (msg.kind === 'answer' || msg.kind === 'guide') article.classList.add('is-rich');
    if (msg.kind === 'error') article.classList.add('is-error');
    article.setAttribute('data-msg-id', msg.id);
    var avatar = el('div', 'msg-avatar', msg.role === 'user' ? '我' : '修');
    var main = el('div', 'msg-main');
    var meta = el('div', 'msg-meta');
    meta.appendChild(el('strong', '', msg.role === 'user' ? '我' : '维修百事通'));
    meta.appendChild(el('time', '', formatClock(msg.at)));
    main.appendChild(meta);
    var bubble = el('div', 'msg-bubble');
    if (msg.kind === 'answer' && msg.data) renderAnswerBubble(bubble, msg);
    else if (msg.kind === 'guide' && msg.node) renderGuideBubble(bubble, msg);
    else if (msg.kind === 'error') renderErrorBubble(bubble, msg);
    else {
      bubble.textContent = msg.text || '';
      if (msg.role === 'user') bubble.style.whiteSpace = 'pre-wrap';
    }
    main.appendChild(bubble);
    append(article, avatar, main);
    dom.messages.appendChild(article);
  }
  function removeMessage(id) {
    for (var i = state.messages.length - 1; i >= 0; i--) {
      if (state.messages[i].id === id) { state.messages.splice(i, 1); break; }
    }
    var node = dom.messages.querySelector('[data-msg-id="' + id + '"]');
    if (node && node.parentNode) node.parentNode.removeChild(node);
    if (!state.messages.length) dom.chatEmpty.hidden = false;
  }
  function addErrorMessage(text, retryFn, extraActions) {
    var msg = { role: 'assistant', kind: 'error', text: text, actions: [] };
    if (retryFn) {
      msg.actions.push({
        label: '重试',
        fn: function () { removeMessage(msg.id); retryFn(); }
      });
    }
    (extraActions || []).forEach(function (a) { msg.actions.push(a); });
    return addMessage(msg);
  }
  function handleSend() {
    var text = dom.chatInput.value.trim();
    if (!text) { toast('请先输入故障现象或排查结果。', 'warning'); focusNoScroll(dom.chatInput); return; }
    if (state.chatBusy) return;
    dom.chatInput.value = '';
    dom.charCount.textContent = '0 / 1000';
    resizeComposer();
    updateSendState();
    if (state.guide.active) answerGuide(text);
    else requestChat(text);
  }
  async function requestChat(text, options) {
    options = options || {};
    var message = String(text || '').trim();
    if (!message || state.chatBusy) return;
    if (options.appendUser !== false) {
      addMessage({ role: 'user', kind: 'text', text: message });
    }
    setChatBusy(true, '正在检索知识库与排序原因…');
    try {
      var payload = { sessionId: state.sessionId, message: message, role: 'student' };
      if (state.equipmentCode) payload.equipmentCode = state.equipmentCode;
      var data = await api('/api/chat', { method: 'POST', body: payload, timeout: 30000 });
      if (!data || typeof data !== 'object') throw new ApiError('服务未返回有效回答，请重试。', 0, 'EMPTY');
      if (data.sessionId) {
        state.sessionId = String(data.sessionId);
        updateSessionMeta();
      }
      state.lastChat = data;
      addMessage({ role: 'assistant', kind: 'answer', data: data, safetyAck: false });
      var node = extractGuideNode(data);
      if (node) {
        enterGuideFromNode(node, { append: true });
      }
    } catch (err) {
      addErrorMessage(err.message || '问答请求失败，请稍后重试。', function () {
        requestChat(message, { appendUser: false });
      });
    } finally {
      setChatBusy(false);
    }
  }
  async function answerGuide(text, options) {
    options = options || {};
    var reply = String(text || '').trim();
    if (!reply || state.chatBusy || !state.guide.active) return;
    if (options.appendUser !== false) addMessage({ role: 'user', kind: 'text', text: reply });
    setChatBusy(true, '正在推进排查步骤…');
    try {
      var data = await api('/api/troubleshoot/answer', {
        method: 'POST',
        body: { sessionId: state.sessionId, reply: reply },
        timeout: 30000
      });
      var node = normalizeGuideNode(data);
      if (!node.question && !node.isLeaf) throw new ApiError('排查引导未返回下一步，请退出后重新提问。', 0, 'GUIDE_EMPTY');
      var leaf = node.isLeaf;
      state.guide.node = node;
      state.guide.done = leaf;
      state.guide.active = !leaf;
      addMessage({ role: 'assistant', kind: 'guide', node: node, synthetic: false });
      updateComposerMode();
      if (leaf) toast('排查引导已完成，可继续就结论提问。', 'success');
      else focusNoScroll(dom.chatInput);
    } catch (err) {
      addErrorMessage(err.message || '排查引导推进失败，请稍后重试。', function () {
        answerGuide(reply, { appendUser: false });
      }, [{ label: '退出引导', fn: function () { exitGuide(); } }]);
    } finally {
      setChatBusy(false);
    }
  }
  function extractGuideNode(data) {
    if (!data || typeof data !== 'object') return null;
    var keys = ['troubleshoot', 'tree', 'node', 'step', 'guide'];
    for (var i = 0; i < keys.length; i++) {
      var value = data[keys[i]];
      if (value && typeof value === 'object' && !Array.isArray(value) && (value.nodeId || value.stepId || value.question)) return value;
    }
    if (data.nodeId || data.stepId || (data.question && data.options)) return data;
    return null;
  }
  function normalizeGuideNode(raw) {
    var outer = raw && typeof raw === 'object' ? raw : {};
    var node = (outer.node && typeof outer.node === 'object') ? outer.node
      : (outer.step && typeof outer.step === 'object') ? outer.step
      : (outer.troubleshoot && typeof outer.troubleshoot === 'object') ? outer.troubleshoot : outer;
    var options = asArray(node.options).map(function (opt) {
      if (typeof opt === 'string') return { answer: opt, next: '' };
      return { answer: String((opt && (opt.answer || opt.label || opt.text)) || ''), next: String((opt && opt.next) || '') };
    }).filter(function (opt) { return !!opt.answer; });
    var isLeaf = !!(node.isLeaf || node.leaf || (node.conclusion && !options.length));
    return {
      treeId: String(node.treeId || outer.treeId || ''),
      nodeId: String(node.nodeId || node.stepId || outer.nodeId || ''),
      state: String(node.state || ''),
      question: String(node.question || node.prompt || ''),
      options: options,
      isLeaf: isLeaf,
      conclusion: String(node.conclusion || node.result || ''),
      actions: asArray(node.actions).map(function (a) { return textOf(a, ''); }).filter(Boolean),
      safetyAck: node.safetyAck !== undefined ? node.safetyAck : outer.safetyAck,
      criterion: String(node.criterion || ''),
      action: String(node.action || ''),
      basis: String(node.basis || ''),
      path: asArray(node.path).map(String),
      round: node.round
    };
  }
  async function startGuide() {
    if (state.guide.active) { toast('排查引导已在进行中，请在对话中继续回答。', 'info'); return; }
    var data = state.lastChat || {};
    var node = extractGuideNode(data);
    if (node) {
      enterGuideFromNode(node, { append: true });
      toast('已进入排查引导，请按现场情况回答。', 'info');
      return;
    }
    var first = data.nextStep && data.nextStep.firstQuestion;
    if (!first) { toast('当前回答没有可用的排查问题，请补充故障现象后重试。', 'warning'); return; }
    try {
      var resp = await api('/api/chat', {
        method: 'POST',
        body: { sessionId: state.sessionId, message: '进入排查引导', role: 'student' },
        timeout: 30000
      });
      state.lastChat = resp || state.lastChat;
      var guideNode = extractGuideNode(resp);
      if (guideNode) {
        enterGuideFromNode(guideNode, { append: true });
        toast('已进入排查引导，请按现场情况回答。', 'info');
        return;
      }
    } catch (err) {
      // 后端未建立引导会话时退回合成首问，仍可逐轮作答
    }
    enterGuideFromNode({ question: String(first), safetyAck: data.safetyAck }, {
      append: true, synthetic: true
    });
    toast('已进入排查引导，请按现场情况回答。', 'info');
  }
  function enterGuideFromNode(raw, options) {
    options = options || {};
    var node = normalizeGuideNode(raw);
    if (!node.question && !node.isLeaf) return false;
    state.guide.node = node;
    state.guide.done = node.isLeaf;
    state.guide.synthetic = !!options.synthetic;
    state.guide.active = !node.isLeaf;
    if (options.append !== false) {
      addMessage({ role: 'assistant', kind: 'guide', node: node, synthetic: !!options.synthetic });
    }
    updateComposerMode();
    if (state.guide.active) focusNoScroll(dom.chatInput);
    return true;
  }
  function exitGuide(options) {
    options = options || {};
    var wasActive = state.guide.active;
    state.guide = { active: false, done: false, node: null, synthetic: false };
    updateComposerMode();
    if (wasActive && !options.silent) toast('已退出排查引导。', 'info');
  }
  function clearChat() {
    if (state.chatBusy) { toast('请求处理中，请稍候再清空。', 'warning'); return; }
    state.messages = [];
    clearNode(dom.messages);
    dom.chatEmpty.hidden = false;
    dom.chatInput.value = '';
    dom.charCount.textContent = '0 / 1000';
    state.lastChat = null;
    state.sessionId = makeSessionId();
    state.guide = { active: false, done: false, node: null, synthetic: false };
    hideTyping();
    updateComposerMode();
    resizeComposer();
    updateSessionMeta();
    toast('对话已清空，已开始新的会话。', 'success');
    focusNoScroll(dom.chatInput);
  }

  // ---------- 问答结果渲染 ----------
  function normalizeCauses(value) {
    var list = asArray(value).map(function (item) {
      if (typeof item === 'string') return { rootCause: item, probability: '', basis: '', verifyMethod: '' };
      if (!item || typeof item !== 'object') return null;
      return {
        rootCause: String(item.rootCause || item.cause || item.name || item.title || ''),
        probability: normalizeProbability(item.probability),
        basis: textOf(item.basis || item.evidence || item.reason, ''),
        verifyMethod: textOf(item.verifyMethod || item.verify || item.checkMethod, '')
      };
    }).filter(function (item) { return item && item.rootCause; });
    return list.map(function (item, index) { return { item: item, index: index }; })
      .sort(function (a, b) {
        var pa = PROB_RANK[a.item.probability] || 0;
        var pb = PROB_RANK[b.item.probability] || 0;
        return pb - pa || a.index - b.index;
      })
      .map(function (entry) { return entry.item; });
  }
  function normalizeActions(value) {
    return asArray(value).map(function (item) {
      if (typeof item === 'string') return { action: item, criterion: '', riskLevel: '' };
      if (!item || typeof item !== 'object') return null;
      return {
        action: String(item.action || item.step || item.title || item.description || ''),
        criterion: textOf(item.criterion || item.judgment || item.standard, ''),
        riskLevel: normalizeProbability(item.riskLevel || item.risk || '')
      };
    }).filter(function (item) { return item && item.action; });
  }
  function normalizeSources(sources, citations) {
    var out = [];
    asArray(sources).forEach(function (source) {
      if (typeof source === 'string') out.push({ id: source.replace(/^\[|\]$/g, ''), title: '' });
      else if (source && typeof source === 'object') {
        out.push({
          id: String(source.id || source.knowledgeId || source.code || '').replace(/^\[|\]$/g, ''),
          title: String(source.title || source.name || '')
        });
      }
    });
    asArray(citations).forEach(function (citation) {
      var id = typeof citation === 'string' ? citation : (citation && (citation.id || citation.knowledgeId || citation.code));
      id = String(id || '').replace(/^\[|\]$/g, '');
      if (id && !out.some(function (s) { return s.id === id; })) out.push({ id: id, title: '' });
    });
    return out.filter(function (s) { return s.id || s.title; });
  }
  function normalizeRisks(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(function (v) { return textOf(v, ''); }).filter(Boolean);
    if (typeof value === 'string') return value.split(/\n|；|;/).map(function (v) { return v.trim(); }).filter(Boolean);
    return [textOf(value, '')].filter(Boolean);
  }
  function renderAnswerBubble(bubble, msg) {
    var d = msg.data || {};
    var causes = normalizeCauses(d.causes);
    var actions = normalizeActions(d.actions);
    var risks = normalizeRisks(d.risks);
    var sources = normalizeSources(d.sources, d.citations);
    var intent = String(d.intent || '').toUpperCase();
    var answerType = String(d.answerType || '').toUpperCase();
    var refusal = answerType === 'REFUSAL' || (!causes.length && !actions.length && d.clarify && intent !== 'CHAT');
    var flags = el('div', 'answer-flags');
    if (intent) flags.appendChild(badge(INTENT_LABELS[intent] || intent, intent === 'DANGER' ? 'red' : 'blue'));
    if (d.confidence) {
      var conf = String(d.confidence).toUpperCase();
      flags.appendChild(badge('置信度 ' + (conf === 'HIGH' ? '高' : conf === 'MEDIUM' ? '中' : conf === 'LOW' ? '低' : conf),
        conf === 'HIGH' ? 'green' : conf === 'MEDIUM' ? 'amber' : 'gray'));
    }
    if (refusal) flags.appendChild(badge('拒答 / 无命中', 'red'));
    if (d.escalate) flags.appendChild(badge('建议转人工', 'red'));
    if (flags.children.length) bubble.appendChild(flags);
    if (intent === 'DANGER') {
      var danger = el('div', 'danger-banner');
      append(danger, el('span', '', '!'), (function () {
        var t = el('div', '', '检测到安全风险。请先停止操作、停机断电并撤离危险区域，再联系实训教师或值班维修人员。');
        return t;
      })());
      bubble.appendChild(danger);
    }
    if (refusal) {
      renderRefusal(bubble, d, sources, intent);
      return;
    }
    var leadText = textOf(d.conclusion, '');
    if (leadText) {
      bubble.appendChild(el('div', 'conclusion-box', leadText));
    } else if (d.text) {
      bubble.appendChild(el('div', 'answer-text', d.text));
    }
    if (causes.length) renderCauses(bubble, causes);
    if (actions.length) renderActions(bubble, msg, actions, risks);
    else if (risks.length) renderRisks(bubble, risks);
    if (d.text && (causes.length || actions.length) && !leadText) {
      var textNote = el('p', 'section-sub', '以上为结构化诊断结果，请结合现场验证。');
      bubble.appendChild(textNote);
    }
    renderCitations(bubble, sources, d.confidence);
    var next = d.nextStep;
    if (next && next.enterTroubleshooting) {
      renderNextStep(bubble, next);
    }
  }
  function renderCauses(bubble, causes) {
    var section = el('section', 'answer-section');
    var heading = el('div', 'section-heading');
    append(heading, el('h4', '', '可能原因（按概率排序）'), el('span', 'section-note', '概率为知识匹配结果，需现场验证'));
    section.appendChild(heading);
    var scroll = el('div', 'table-scroll');
    var table = el('table', 'cause-table');
    var thead = el('thead');
    var headRow = el('tr');
    ['#', '可能原因', '概率', '判断依据', '验证方法'].forEach(function (h) { headRow.appendChild(el('th', '', h)); });
    append(thead, headRow);
    var tbody = el('tbody');
    causes.forEach(function (cause, index) {
      var row = el('tr');
      var rankCell = el('td');
      rankCell.appendChild(el('span', 'cause-rank', String(index + 1).padStart(2, '0')));
      row.appendChild(rankCell);
      row.appendChild(el('td', 'cause-name', cause.rootCause));
      var probCell = el('td');
      var p = cause.probability;
      if (p) {
        var prob = el('span', 'probability prob-' + p.toLowerCase(), p);
        prob.title = '概率等级：' + (SEV_LABEL[p] || p);
        probCell.appendChild(prob);
      } else {
        probCell.appendChild(el('span', 'probability prob-low', '未评估'));
      }
      row.appendChild(probCell);
      row.appendChild(el('td', 'cell-muted', cause.basis || '未提供'));
      row.appendChild(el('td', 'cell-muted', cause.verifyMethod || '未提供'));
      tbody.appendChild(row);
    });
    append(table, thead, tbody);
    scroll.appendChild(table);
    section.appendChild(scroll);
    bubble.appendChild(section);
  }
  function renderActions(bubble, msg, actions, risks) {
    var section = el('section', 'answer-section');
    var heading = el('div', 'section-heading');
    append(heading, el('h4', '', '处置步骤'), el('span', 'section-note', '按顺序执行，先确认安全'));
    section.appendChild(heading);

    var ackWrap = el('div', 'safety-ack' + (msg.safetyAck ? ' is-checked' : ''));
    var checkId = 'ack-' + msg.id;
    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = checkId;
    checkbox.checked = !!msg.safetyAck;
    var ackLabel = el('label');
    ackLabel.setAttribute('for', checkId);
    append(ackLabel,
      el('strong', '', '安全确认：'),
      document.createTextNode('我已阅读风险提示，并完成停机、断电、挂牌等安全确认。'));
    var status = el('span', 'safety-ack-status', msg.safetyAck ? '安全确认：已确认' : '安全确认：待确认');
    ackLabel.appendChild(status);
    append(ackWrap, checkbox, ackLabel);
    checkbox.addEventListener('change', function () {
      msg.safetyAck = checkbox.checked;
      ackWrap.classList.toggle('is-checked', checkbox.checked);
      status.textContent = checkbox.checked ? '安全确认：已确认' : '安全确认：待确认';
    });
    section.appendChild(ackWrap);

    var list = el('div', 'action-list');
    actions.forEach(function (action, index) {
      var risk = action.riskLevel;
      var card = el('div', 'action-card' + (risk ? ' risk-' + risk.toLowerCase() : ''));
      card.appendChild(el('span', 'action-index', String(index + 1)));
      var body = el('div', 'action-body');
      var top = el('div', 'action-top');
      top.appendChild(el('div', 'action-title', action.action));
      if (risk) top.appendChild(badge(risk + ' 风险', risk === 'HIGH' ? 'red' : risk === 'MEDIUM' ? 'amber' : 'green'));
      body.appendChild(top);
      if (action.criterion) {
        var criterion = el('div', 'action-criterion');
        append(criterion, el('b', '', '判定标准：'), document.createTextNode(action.criterion));
        body.appendChild(criterion);
      }
      card.appendChild(body);
      list.appendChild(card);
    });
    section.appendChild(list);
    if (risks.length) renderRisks(section, risks);
    bubble.appendChild(section);
  }
  function renderRisks(parent, risks) {
    var strip = el('div', 'risk-strip');
    strip.appendChild(el('span', 'risk-icon', '!'));
    var copy = el('div');
    copy.appendChild(el('strong', '', '安全风险'));
    var ul = el('ul');
    risks.forEach(function (risk) { ul.appendChild(el('li', '', risk)); });
    copy.appendChild(ul);
    strip.appendChild(copy);
    parent.appendChild(strip);
  }
  function renderCitations(bubble, sources, confidence) {
    var section = el('section', 'answer-section');
    var heading = el('div', 'section-heading');
    append(heading, el('h4', '', '引用来源'), el('span', 'section-note', sources.length ? '共 ' + sources.length + ' 条' : ''));
    section.appendChild(heading);
    if (sources.length) {
      var list = el('div', 'citation-list');
      sources.forEach(function (source) {
        var chip = el('span', 'citation-chip');
        if (source.id) chip.appendChild(el('code', '', source.id));
        chip.appendChild(el('span', 'citation-title', source.title || '知识条目'));
        chip.title = (source.id || '') + (source.title ? ' · ' + source.title : '');
        list.appendChild(chip);
      });
      section.appendChild(list);
    } else {
      section.appendChild(el('p', 'citation-empty', '未提供引用来源；低置信度结论请结合现场核实。'));
    }
    if (String(confidence || '').toUpperCase() === 'LOW') {
      section.appendChild(el('p', 'section-sub', '低置信度结论仅供参考，请优先联系实训教师复核。'));
    }
    bubble.appendChild(section);
  }
  function renderNextStep(bubble, next) {
    var box = el('div', 'next-step-box');
    var copy = el('div', 'next-step-copy');
    append(copy, el('strong', '', '可继续进入排查引导'), el('p', '', next.firstQuestion ? '首问：' + next.firstQuestion : '按决策树逐项确认现场状态。'));
    box.appendChild(copy);
    var btn = el('button', 'btn btn-primary btn-sm', '进入排查引导');
    btn.type = 'button';
    btn.addEventListener('click', startGuide);
    box.appendChild(btn);
    bubble.appendChild(box);
  }
  function renderRefusal(bubble, d, sources, intent) {
    var card = el('div', 'refusal-card');
    var head = el('div', 'refusal-head');
    head.appendChild(el('div', 'refusal-icon', '!'));
    var headCopy = el('div');
    headCopy.appendChild(el('h4', '', intent === 'DANGER' ? '存在安全风险，已停止自动诊断' : '未命中可靠知识，暂不给出结论'));
    headCopy.appendChild(el('p', '', '系统不会在证据不足时猜测原因。请补充信息或联系实训教师。'));
    head.appendChild(headCopy);
    card.appendChild(head);
    var body = el('div', 'refusal-body');
    var mainText = textOf(d.text || d.conclusion, '暂无可用的诊断结论。');
    body.appendChild(el('div', 'answer-text', mainText));
    if (d.clarify) {
      var clarify = el('div', 'refusal-clarify');
      append(clarify, el('b', '', '需要补充：'), document.createTextNode(textOf(d.clarify, '')));
      body.appendChild(clarify);
    } else {
      body.appendChild(el('div', 'refusal-clarify', '建议补充：设备名称 / 型号、报警代码、发生时机、已做的检查与结果。'));
    }
    var safeAction = d.safeAction || d.safetyAction || (d.safety && d.safety.safeAction);
    if (safeAction) {
      var safe = el('div', 'refusal-clarify');
      append(safe, el('b', '', '安全动作：'), document.createTextNode(textOf(safeAction, '')));
      body.appendChild(safe);
    }
    var actions = normalizeActions(d.actions);
    if (actions.length) {
      var ul = el('ul');
      actions.forEach(function (action) { ul.appendChild(el('li', '', action.action)); });
      body.appendChild(ul);
    }
    if (d.escalate) {
      body.appendChild(el('p', 'section-sub', '系统建议转交实训教师或值班维修人员处理。'));
    }
    var actionRow = el('div', 'refusal-actions');
    var supplement = el('button', 'btn btn-ghost btn-sm', '补充信息');
    supplement.type = 'button';
    supplement.addEventListener('click', function () { focusNoScroll(dom.chatInput); });
    actionRow.appendChild(supplement);
    if (sources.length) actionRow.appendChild(el('span', 'section-sub', '已保留相关检索线索，可补充设备与现象后重试。'));
    body.appendChild(actionRow);
    card.appendChild(body);
    bubble.appendChild(card);
    if (sources.length) renderCitations(bubble, sources, d.confidence);
  }
  function renderGuideBubble(bubble, msg) {
    var node = msg.node || {};
    var ack = safetyAckInfo(node.safetyAck);
    var card = el('div', 'guide-card');
    var top = el('div', 'guide-top');
    var left = el('div', 'guide-top-left');
    append(left, el('span', 'guide-kicker', '排查引导'));
    if (node.treeId) left.appendChild(el('span', 'guide-id', node.treeId));
    if (node.nodeId) left.appendChild(el('span', 'guide-id', node.nodeId));
    if (node.state) left.appendChild(badge(node.state, 'blue', true));
    top.appendChild(left);
    var ackBadge = badge(ack.label, ack.tone);
    ackBadge.classList.add('guide-ack-badge');
    top.appendChild(ackBadge);
    card.appendChild(top);
    var body = el('div', 'guide-body');
    var safety = el('div', 'guide-safety');
    safety.appendChild(el('span', 'guide-safety-label', '安全确认'));
    if (ack.chips.length) {
      ack.chips.forEach(function (chip) {
        safety.appendChild(el('span', 'ack-chip ' + (chip.on ? 'is-on' : 'is-off'), (chip.on ? '✓ ' : '× ') + chip.label));
      });
    } else {
      safety.appendChild(el('span', 'section-sub', ack.detail || ack.label));
    }
    body.appendChild(safety);
    if (ack.tone === 'red' || ack.tone === 'amber') {
      body.appendChild(el('p', 'guide-hint', '安全确认未完成前，请勿进行测量、拆检或带电作业。'));
    }
    if (node.question) body.appendChild(el('div', 'guide-question', node.question));
    if (node.options && node.options.length) {
      var optionWrap = el('div', 'guide-options');
      node.options.forEach(function (opt) {
        var btn = el('button', 'guide-option', opt.answer);
        btn.type = 'button';
        btn.addEventListener('click', function () {
          if (state.chatBusy) return;
          answerGuide(opt.answer);
        });
        optionWrap.appendChild(btn);
      });
      body.appendChild(optionWrap);
    } else if (!node.isLeaf) {
      body.appendChild(el('p', 'guide-hint', '请结合现场检查结果在下方输入回答；不确定时直接说明。'));
    }
    var metaRows = [];
    if (node.criterion) metaRows.push(['判定标准', node.criterion]);
    if (node.action) metaRows.push(['现场动作', node.action]);
    if (node.basis) metaRows.push(['判断依据', node.basis]);
    if (metaRows.length) {
      var meta = el('div', 'guide-meta');
      metaRows.forEach(function (row) {
        var item = el('div', 'guide-meta-item');
        append(item, el('b', '', row[0]), document.createTextNode(row[1]));
        meta.appendChild(item);
      });
      body.appendChild(meta);
    }
    if (node.isLeaf) {
      var leaf = el('div', 'guide-leaf');
      leaf.appendChild(el('h4', '', '当前分支结论'));
      leaf.appendChild(el('p', '', node.conclusion || '已到达当前分支终点，建议转人工复核。'));
      if (node.actions && node.actions.length) {
        var ul = el('ul');
        node.actions.forEach(function (a) { ul.appendChild(el('li', '', a)); });
        leaf.appendChild(ul);
      }
      body.appendChild(leaf);
      var finish = el('div', 'guide-finish');
      var doneBtn = el('button', 'btn btn-primary btn-sm', '完成引导');
      doneBtn.type = 'button';
      doneBtn.addEventListener('click', function () { exitGuide(); });
      finish.appendChild(doneBtn);
      body.appendChild(finish);
    }
    card.appendChild(body);
    bubble.appendChild(card);
  }
  function safetyAckInfo(ack) {
    if (ack === undefined || ack === null || ack === '') {
      return { tone: 'gray', label: '安全确认：未提供', chips: [], detail: '服务端未返回安全确认状态。' };
    }
    if (typeof ack === 'boolean') {
      return ack
        ? { tone: 'green', label: '安全确认：已确认', chips: [], detail: '已完成安全确认。' }
        : { tone: 'amber', label: '安全确认：待确认', chips: [], detail: '尚未完成安全确认。' };
    }
    if (typeof ack === 'string') {
      var positive = /^(true|已确认|confirmed|yes|ok|已完成)$/i.test(ack.trim());
      return {
        tone: positive ? 'green' : 'amber',
        label: '安全确认：' + (positive ? '已确认' : ack),
        chips: [], detail: ack
      };
    }
    if (typeof ack === 'object') {
      var chips = [];
      var entries = Object.keys(ack).filter(function (k) { return typeof ack[k] === 'boolean'; });
      entries.forEach(function (key) {
        chips.push({ on: !!ack[key], label: ACK_LABELS[key] || key });
      });
      var onCount = entries.filter(function (k) { return ack[k] === true; }).length;
      var all = entries.length > 0 && onCount === entries.length;
      var any = onCount > 0;
      var source = ack.source;
      var tone = all ? 'green' : any ? 'amber' : 'red';
      var label = all ? '安全确认：已完成' : any ? '安全确认：部分完成' : '安全确认：待确认';
      if (source === 'user' && all) label = '安全确认：用户已确认';
      return { tone: tone, label: label, chips: chips, detail: source ? '确认来源：' + source : '' };
    }
    return { tone: 'gray', label: '安全确认：未提供', chips: [], detail: '' };
  }

  // ---------- 点检 ----------
  function resetChecklistState() {
    state.checklist.requestSeq++;
    state.checklist.data = null;
    state.checklist.forSubmit = null;
    state.checklist.meta = null;
    state.checklist.items = [];
    state.checklist.results = [];
    state.checklist.submission = null;
    state.checklist.submitted = false;
    state.checklist.loading = false;
    clearNode(dom.checklistTbody);
    dom.checklistWorkspace.hidden = true;
    dom.submissionResult.hidden = true;
    dom.checklistLoading.hidden = true;
    dom.checklistEmpty.hidden = false;
    hideInlineAlert(dom.checklistAlert);
    setButtonBusy(dom.generateChecklistBtn, false);
    if (dom.checklistCounts) dom.checklistCounts.textContent = '—';
  }
  function normalizeChecklistItem(item, index) {
    item = item && typeof item === 'object' ? item : {};
    return {
      code: String(item.code || item.id || 'CHK-' + String(index + 1).padStart(3, '0')),
      name: String(item.name || item.item || item.title || '未命名项目'),
      location: textOf(item.location || item.place, '—'),
      criterion: textOf(item.criterion || item.standard, '—'),
      method: textOf(item.method, '—'),
      tool: textOf(item.tool, '—'),
      judgment: textOf(item.judgment, ''),
      abnormalAction: textOf(item.abnormalAction || item.abnormal, ''),
      safetyTip: textOf(item.safetyTip || item.safety, '—'),
      securityCritical: !!item.securityCritical,
      frequency: item.frequency || ''
    };
  }
  async function loadChecklist() {
    if (state.checklist.loading) return;
    if (!state.equipmentCode) {
      toast('请先选择设备，再生成点检清单。', 'warning');
      focusNoScroll(dom.checkEquipment);
      return;
    }
    var seq = ++state.checklist.requestSeq;
    state.checklist.loading = true;
    state.checklist.submitted = false;
    setButtonBusy(dom.generateChecklistBtn, true);
    hideInlineAlert(dom.checklistAlert);
    dom.checklistEmpty.hidden = true;
    dom.checklistWorkspace.hidden = true;
    dom.submissionResult.hidden = true;
    dom.checklistLoading.hidden = false;
    var frequency = dom.checkFrequency.value || 'D';
    try {
      var data = await api('/api/checklists/generate', {
        method: 'POST',
        body: { equipmentCode: state.equipmentCode, frequency: frequency }
      });
      if (seq !== state.checklist.requestSeq) return;
      var base = data && data.checklist && typeof data.checklist === 'object' ? data.checklist : (data || {});
      var rawItems = data && data.items !== undefined ? data.items : base.items;
      var items = asArray(rawItems).map(normalizeChecklistItem);
      if (!items.length) {
        dom.checklistLoading.hidden = true;
        dom.checklistEmpty.hidden = false;
        showInlineAlert(dom.checklistAlert, {
          type: 'warning',
          title: '暂无可用点检模板',
          message: '当前设备没有 ' + frequency + ' 频次点检项。可尝试切换频次，或选择其他设备。',
          actions: [{ label: '重新生成', fn: function () { return loadChecklist(); } }]
        });
        return;
      }
      state.checklist.data = data;
      state.checklist.forSubmit = data && data.checklist ? data.checklist : data;
      var eq = selectedEquipment();
      state.checklist.items = items;
      state.checklist.results = items.map(function (item) {
        return {
          result: 'OK',
          note: '',
          severity: item.securityCritical ? 'HIGH' : 'MEDIUM'
        };
      });
      state.checklist.meta = {
        equipmentName: (data && (data.equipmentName || base.equipmentName)) || (eq && eq.name) || '当前设备',
        equipmentCode: (data && data.equipmentCode) || base.equipmentCode || state.equipmentCode,
        category: (data && data.category) || base.category || (eq && eq.category) || '',
        frequency: frequency,
        generatedAt: (data && (data.generatedAt || data.checkedAt)) || latestTimestamp()
      };
      renderChecklistTable();
      dom.checklistWorkspace.hidden = false;
      dom.checklistEmpty.hidden = true;
      dom.checklistLoading.hidden = true;
      dom.submissionResult.hidden = true;
      toast('已生成 ' + items.length + ' 项点检清单。', 'success');
    } catch (err) {
      if (seq !== state.checklist.requestSeq) return;
      dom.checklistLoading.hidden = true;
      dom.checklistEmpty.hidden = false;
      showInlineAlert(dom.checklistAlert, {
        title: '点检清单生成失败',
        message: err.message,
        actions: [{ label: '重试生成', fn: function () { return loadChecklist(); } }]
      });
      toast(err.message, 'error', { title: '点检清单生成失败' });
    } finally {
      if (seq === state.checklist.requestSeq) {
        state.checklist.loading = false;
        dom.checklistLoading.hidden = true;
        setButtonBusy(dom.generateChecklistBtn, false);
        if (dom.generateChecklistBtn) dom.generateChecklistBtn.disabled = !state.equipment.length;
      }
    }
  }
  function renderChecklistTable() {
    clearNode(dom.checklistTbody);
    var meta = state.checklist.meta || {};
    var items = state.checklist.items;
    dom.checklistTitle.textContent = (meta.equipmentName || '点检清单') + ' · ' + (meta.frequency === 'W' ? '周检清单' : '日检清单');
    dom.checklistMeta.textContent = [
      meta.equipmentCode || state.equipmentCode,
      categoryLabel(meta.category),
      '共 ' + items.length + ' 项',
      '生成于 ' + formatTime(meta.generatedAt)
    ].join(' · ');
    items.forEach(function (item, index) {
      var result = state.checklist.results[index];
      var tr = el('tr');
      tr.setAttribute('data-index', String(index));
      tr.setAttribute('id', 'check-row-' + index);
      tr.appendChild((function () {
        var td = el('td');
        var code = el('span', 'item-code', item.code);
        code.title = item.code;
        td.appendChild(code);
        return td;
      })());
      tr.appendChild((function () {
        var td = el('td');
        var name = el('span', 'item-name', item.name);
        name.title = item.name;
        td.appendChild(name);
        if (item.judgment) td.appendChild(el('span', 'item-extra', '判定：' + item.judgment));
        return td;
      })());
      tr.appendChild(el('td', '', item.location));
      tr.appendChild((function () {
        var td = el('td');
        var criterion = el('span', '', item.criterion);
        criterion.title = item.criterion;
        td.appendChild(criterion);
        if (item.abnormalAction) td.appendChild(el('span', 'item-extra', '异常处置：' + item.abnormalAction));
        return td;
      })());
      tr.appendChild(el('td', '', item.method));
      tr.appendChild(el('td', '', item.tool));
      tr.appendChild((function () {
        var td = el('td', 'safety-cell');
        if (item.safetyTip && item.safetyTip !== '—') {
          td.appendChild(el('span', 'safety-flag', '!'));
          td.appendChild(document.createTextNode(item.safetyTip));
          td.title = item.safetyTip;
        } else {
          td.appendChild(el('span', 'muted', '无特别提示'));
        }
        return td;
      })());
      tr.appendChild((function () {
        var td = el('td');
        var choice = el('div', 'result-choice');
        [['OK', 'OK'], ['ABNORMAL', '异常'], ['NA', '不适用']].forEach(function (opt) {
          var label = el('label', 'result-opt');
          var input = document.createElement('input');
          input.type = 'radio';
          input.name = 'chk-result-' + index;
          input.value = opt[0];
          input.checked = result.result === opt[0];
          label.appendChild(input);
          label.appendChild(el('span', '', opt[1]));
          choice.appendChild(label);
        });
        td.appendChild(choice);
        return td;
      })());
      tr.appendChild((function () {
        var td = el('td');
        var wrap = el('div', 'note-wrap');
        var note = document.createElement('input');
        note.type = 'text';
        note.className = 'note-input';
        note.maxLength = 200;
        note.value = result.note || '';
        note.placeholder = '异常项必填；OK 可写备注';
        note.setAttribute('aria-label', '第 ' + (index + 1) + ' 项备注');
        var sev = document.createElement('select');
        sev.className = 'severity-select' + (result.result === 'ABNORMAL' ? '' : ' is-hidden');
        sev.setAttribute('aria-label', '第 ' + (index + 1) + ' 项异常严重度');
        [['HIGH', '高严重度'], ['MEDIUM', '中严重度'], ['LOW', '低严重度']].forEach(function (s) {
          var opt = el('option', '', s[1]);
          opt.value = s[0];
          if (result.severity === s[0]) opt.selected = true;
          sev.appendChild(opt);
        });
        var noteError = el('span', 'note-error', '异常项必须填写备注');
        noteError.hidden = true;
        append(wrap, note, sev, noteError);
        td.appendChild(wrap);
        return td;
      })());
      dom.checklistTbody.appendChild(tr);
      updateChecklistRowState(index, false);
    });
    updateChecklistCounts();
  }
  function updateChecklistRowState(index, showError) {
    var result = state.checklist.results[index];
    var tr = dom.checklistTbody.querySelector('tr[data-index="' + index + '"]');
    if (!result || !tr) return;
    var isAbnormal = result.result === 'ABNORMAL';
    tr.classList.toggle('row-abnormal', isAbnormal);
    tr.classList.remove('row-error');
    var note = tr.querySelector('.note-input');
    var sev = tr.querySelector('.severity-select');
    var noteError = tr.querySelector('.note-error');
    if (note) {
      note.placeholder = isAbnormal ? '请填写现场情况（必填）' : '备注（选填）';
      note.removeAttribute('aria-invalid');
    }
    if (sev) sev.classList.toggle('is-hidden', !isAbnormal);
    if (noteError) noteError.hidden = true;
    if (showError) {
      tr.classList.add('row-error');
      if (note) note.setAttribute('aria-invalid', 'true');
      if (noteError) noteError.hidden = false;
    }
  }
  function updateChecklistCounts() {
    if (!dom.checklistCounts) return;
    var results = state.checklist.results;
    var abnormal = 0, na = 0;
    results.forEach(function (r) {
      if (r.result === 'ABNORMAL') abnormal++;
      if (r.result === 'NA') na++;
    });
    dom.checklistCounts.textContent = '共 ' + results.length + ' 项 · 异常 ' + abnormal + ' · 不适用 ' + na;
  }
  function validateChecklist() {
    var operator = dom.operatorInput.value.trim();
    if (!operator) {
      focusNoScroll(dom.operatorInput);
      showInlineAlert(dom.checklistAlert, {
        title: '请填写填报人',
        message: '填报人用于点检记录追溯，不能为空。'
      });
      return null;
    }
    var invalid = [];
    var items = state.checklist.items;
    state.checklist.results.forEach(function (result, index) {
      if (['OK', 'ABNORMAL', 'NA'].indexOf(result.result) === -1) invalid.push(index);
      if (result.result === 'ABNORMAL' && !result.note.trim()) invalid.push(index);
    });
    if (invalid.length) {
      var first = invalid[0];
      var item = items[first] || {};
      updateChecklistRowState(first, true);
      var row = dom.checklistTbody.querySelector('tr[data-index="' + first + '"]');
      if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      var note = row && row.querySelector('.note-input');
      if (note) focusNoScroll(note);
      showInlineAlert(dom.checklistAlert, {
        title: '请完善异常项备注',
        message: '第 ' + (first + 1) + ' 项「' + (item.name || '点检项') + '」结果为异常，必须填写现场备注后再提交。',
        actions: [{
          label: '定位到该项',
          fn: function () {
            if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            if (note) focusNoScroll(note);
          }
        }]
      });
      return null;
    }
    return state.checklist.items.map(function (item, index) {
      var result = state.checklist.results[index];
      return {
        code: item.code,
        result: result.result,
        note: result.note.trim(),
        severity: result.result === 'ABNORMAL' ? result.severity : 'LOW'
      };
    });
  }
  async function submitChecklist() {
    if (state.checklist.loading || state.checklist.submitted) return;
    var items = validateChecklist();
    if (!items) return;
    state.checklist.loading = true;
    setButtonBusy(dom.submitChecklistBtn, true);
    hideInlineAlert(dom.checklistAlert);
    try {
      var data = await api('/api/checklists/submit', {
        method: 'POST',
        body: {
          checklist: state.checklist.forSubmit,
          items: items,
          operator: dom.operatorInput.value.trim(),
          note: dom.overallNote.value.trim()
        },
        timeout: 30000
      });
      var anomalies = normalizeAnomalyList(data && (data.anomalies || data.anomalyList || (data.result && data.result.anomalies)));
      var meta = state.checklist.meta || {};
      var abnormalCount = state.checklist.results.filter(function (r) { return r.result === 'ABNORMAL'; }).length;
      var naCount = state.checklist.results.filter(function (r) { return r.result === 'NA'; }).length;
      state.checklist.submission = {
        submissionId: String((data && (data.submissionId || data.id)) || '已提交'),
        equipmentCode: (data && data.equipmentCode) || meta.equipmentCode || state.equipmentCode,
        equipmentName: meta.equipmentName,
        checkedAt: (data && (data.checkedAt || data.submittedAt)) || latestTimestamp(),
        anomalies: anomalies,
        summary: data && data.summary,
        total: state.checklist.items.length,
        abnormal: Math.max(abnormalCount, anomalies.length),
        highRisk: anomalies.filter(function (a) { return a.severity === 'HIGH'; }).length,
        na: naCount
      };
      state.checklist.submitted = true;
      state.checklist.loading = false;
      dom.checklistWorkspace.hidden = true;
      dom.checklistEmpty.hidden = true;
      dom.checklistLoading.hidden = true;
      dom.submissionResult.hidden = false;
      renderSubmission();
      markDashboardStale();
      markWorkordersStale();
      dom.submissionResult.scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast('点检已提交' + (anomalies.length ? '，发现 ' + anomalies.length + ' 项异常。' : '。'), 'success');
    } catch (err) {
      showInlineAlert(dom.checklistAlert, {
        title: '点检提交失败',
        message: err.message,
        actions: [{ label: '重试提交', fn: function () { return submitChecklist(); } }]
      });
      toast(err.message, 'error', { title: '点检提交失败' });
    } finally {
      state.checklist.loading = false;
      setButtonBusy(dom.submitChecklistBtn, false);
    }
  }
  function normalizeAnomaly(raw) {
    raw = raw && typeof raw === 'object' ? raw : { name: String(raw || '异常项') };
    var equipment = raw.equipment && typeof raw.equipment === 'object' ? raw.equipment : {};
    var workorder = raw.workorder && typeof raw.workorder === 'object' ? raw.workorder : {};
    var eqCode = String(raw.equipmentCode || equipment.equipmentCode || equipment.code || '');
    var eq = findEquipment(eqCode);
    return {
      anomalyId: String(raw.anomalyId || raw.id || raw.abnormalId || ''),
      equipmentCode: eqCode,
      equipmentName: String(raw.equipmentName || equipment.name || (eq && eq.name) || ''),
      code: String(raw.code || raw.itemCode || raw.checkCode || ''),
      name: String(raw.name || raw.itemName || raw.title || raw.symptom || '异常项'),
      severity: normalizeSeverity(raw.severity || raw.riskLevel || raw.level),
      note: String(raw.note || raw.remark || raw.description || ''),
      checkedAt: raw.checkedAt || raw.createdAt || raw.time || raw.reportedAt || '',
      workorderId: String(raw.workorderId || raw.workOrderId || workorder.workorderId || workorder.id || ''),
      workorderNo: String(raw.workorderNo || raw.workOrderNo || workorder.workorderNo || workorder.no || '')
    };
  }
  function normalizeAnomalyList(value) {
    var raw = value;
    if (raw && !Array.isArray(raw) && typeof raw === 'object') raw = raw.items || raw.list || raw.anomalies || raw.data;
    return asArray(raw).filter(function (a) { return a && typeof a === 'object'; }).map(normalizeAnomaly);
  }
  function summaryText(summary) {
    if (!summary) return '';
    if (typeof summary === 'string') return summary;
    if (typeof summary === 'object') {
      if (summary.text) return String(summary.text);
      var parts = [];
      var labels = { total: '项目', ok: '正常', abnormal: '异常', na: '不适用', highRisk: '高风险' };
      Object.keys(labels).forEach(function (key) {
        if (summary[key] !== undefined && summary[key] !== null) parts.push(labels[key] + ' ' + summary[key]);
      });
      return parts.join(' · ');
    }
    return '';
  }
  function renderSubmission() {
    var sub = state.checklist.submission;
    clearNode(dom.submissionResult);
    if (!sub) { dom.submissionResult.hidden = true; return; }
    var hasAnomalies = sub.anomalies.length > 0;
    var head = el('div', 'result-head' + (hasAnomalies ? ' is-warning' : ''));
    head.appendChild(el('div', 'result-icon', hasAnomalies ? '!' : '✓'));
    var headCopy = el('div');
    headCopy.appendChild(el('h3', '', hasAnomalies ? '点检已提交，发现 ' + sub.anomalies.length + ' 项异常' : '点检已提交'));
    headCopy.appendChild(el('p', '', '提交编号 ' + sub.submissionId + ' · ' + formatTime(sub.checkedAt, true) + ' · ' + (sub.equipmentName || sub.equipmentCode)));
    head.appendChild(headCopy);
    dom.submissionResult.appendChild(head);
    var stats = el('div', 'result-stats');
    [
      ['检查项目', sub.total, ''],
      ['异常项', sub.anomalies.length, hasAnomalies ? 'is-red' : ''],
      ['高风险', sub.highRisk, sub.highRisk ? 'is-red' : ''],
      ['不适用', sub.na, '']
    ].forEach(function (item) {
      var pill = el('span', 'stat-pill ' + item[2]);
      append(pill, el('b', '', String(item[1])), document.createTextNode(item[0]));
      stats.appendChild(pill);
    });
    dom.submissionResult.appendChild(stats);
    var summary = summaryText(sub.summary);
    if (summary) dom.submissionResult.appendChild(el('p', 'result-summary', summary));
    if (hasAnomalies) {
      var list = el('div', 'anomaly-list');
      sub.anomalies.forEach(function (anomaly) {
        var item = el('div', 'anomaly-item' + (anomaly.workorderId ? ' is-created' : ''));
        var sev = el('div', 'anomaly-sev');
        sev.appendChild(badge((SEV_LABEL[anomaly.severity] || anomaly.severity) + '风险', anomaly.severity === 'HIGH' ? 'red' : anomaly.severity === 'MEDIUM' ? 'amber' : 'gray'));
        item.appendChild(sev);
        var main = el('div', 'anomaly-main');
        main.appendChild(el('div', 'anomaly-title', (anomaly.code ? anomaly.code + ' · ' : '') + anomaly.name));
        main.appendChild(el('div', 'anomaly-meta', (anomaly.equipmentName || anomaly.equipmentCode || sub.equipmentName || '') + (anomaly.checkedAt ? ' · ' + formatTime(anomaly.checkedAt) : '')));
        if (anomaly.note) main.appendChild(el('div', 'anomaly-note', '备注：' + anomaly.note));
        item.appendChild(main);
        var actions = el('div', 'anomaly-actions');
        if (anomaly.workorderId) {
          actions.appendChild(el('span', 'anomaly-created', '已建单 ' + (anomaly.workorderNo || anomaly.workorderId)));
        } else {
          var btn = el('button', 'btn btn-primary btn-sm', '创建工单');
          btn.type = 'button';
          if (!anomaly.anomalyId) {
            btn.disabled = true;
            btn.title = '服务未返回 anomalyId，无法建单';
          } else {
            btn.addEventListener('click', function () { createWorkOrderFromAnomaly(anomaly, btn, 'checklist'); });
          }
          actions.appendChild(btn);
        }
        item.appendChild(actions);
        list.appendChild(item);
      });
      dom.submissionResult.appendChild(list);
    } else {
      dom.submissionResult.appendChild(el('div', 'result-empty', '✓ 本次点检未发现异常项，无需创建工单。'));
    }
    var foot = el('div', 'result-foot');
    foot.appendChild(el('span', 'hint', '异常项已同步至看板；创建工单后可继续推进与结案。'));
    var actions = el('div', 'actions');
    var again = el('button', 'btn btn-ghost btn-sm', '重新点检');
    again.type = 'button';
    again.addEventListener('click', function () { return loadChecklist(); });
    var gotoWo = el('button', 'btn btn-primary btn-sm', '前往工单管理');
    gotoWo.type = 'button';
    gotoWo.addEventListener('click', function () { switchTab('workorders'); });
    append(actions, again, gotoWo);
    foot.appendChild(actions);
    dom.submissionResult.appendChild(foot);
  }
  async function createWorkOrderFromAnomaly(anomaly, button, source) {
    var anomalyId = anomaly && anomaly.anomalyId;
    if (!anomalyId) { toast('缺少异常编号，无法创建工单。', 'warning'); return; }
    if (state.createInFlight.has(anomalyId)) return;
    state.createInFlight.add(anomalyId);
    setButtonBusy(button, true);
    try {
      var data = await api('/api/workorders', {
        method: 'POST',
        body: {
          anomalyId: anomalyId,
          note: anomaly.note || anomaly.name || '',
          operator: getOperator()
        }
      });
      var wo = normalizeWorkorder(data && (data.workorder || data.data || data));
      applyWorkorderToAnomaly(anomalyId, wo);
      if (source === 'dashboard') {
        bumpDashboardOpenWorkorders(1);
        state.dashboard.stale = true;
        renderDashboard();
      } else {
        renderSubmission();
      }
      markWorkordersStale();
      toast('工单已创建' + (wo.workorderNo || wo.workorderId ? '：' + (wo.workorderNo || wo.workorderId) : '') + '。', 'success');
    } catch (err) {
      if (button && button.isConnected) setButtonBusy(button, false);
      toast(err.message, 'error', {
        title: '创建工单失败',
        action: { label: '重试', fn: function () { return createWorkOrderFromAnomaly(anomaly, null, source); } }
      });
    } finally {
      state.createInFlight.delete(anomalyId);
    }
  }
  function applyWorkorderToAnomaly(anomalyId, workorder) {
    var id = String(anomalyId);
    var collections = [];
    if (state.checklist.submission) collections.push(state.checklist.submission.anomalies);
    if (state.dashboard.data && state.dashboard.data.recentAnomalies) collections.push(state.dashboard.data.recentAnomalies);
    collections.forEach(function (list) {
      (list || []).forEach(function (item) {
        if (item.anomalyId === id) {
          item.workorderId = workorder.workorderId || workorder.workorderNo || '已创建';
          item.workorderNo = workorder.workorderNo || workorder.workorderId || '';
        }
      });
    });
  }

  // ---------- 看板 ----------
  function markDashboardStale() { state.dashboard.stale = true; }
  function markWorkordersStale() { state.workorders.stale = true; }
  function bumpDashboardOpenWorkorders(delta) {
    var data = state.dashboard.data;
    if (!data || !data.summary) return;
    var current = data.summary.openWorkorders;
    if (typeof current === 'number') data.summary.openWorkorders = Math.max(0, current + delta);
  }
  function installDashboardErrorState() {
    if (!dom.dashboardContent || state.dashboardErrorState) return;
    var node = el('div', 'card empty-panel');
    node.id = 'dashboardErrorState';
    node.hidden = true;
    dom.dashboardContent.parentNode.insertBefore(node, dom.dashboardContent);
    state.dashboardErrorState = node;
  }
  function pickFromSources(sources, keys) {
    for (var i = 0; i < sources.length; i++) {
      var src = sources[i];
      if (!src || typeof src !== 'object' || Array.isArray(src)) continue;
      for (var j = 0; j < keys.length; j++) {
        var value = src[keys[j]];
        if (value !== undefined && value !== null && value !== '') {
          if (Array.isArray(value) && !value.length) continue;
          return value;
        }
      }
    }
    return null;
  }
  function findNumber(sources, keys) {
    var value = pickFromSources(sources, keys);
    var n = numOf(value);
    return n;
  }
  function normalizeDashboard(raw) {
    var root = raw && typeof raw === 'object'
      ? (raw.dashboard && typeof raw.dashboard === 'object' ? raw.dashboard : raw)
      : {};
    var sources = [root.summary, root.stats, root.metrics, root.cards, root];
    var summary = {
      submissions: findNumber(sources, ['submissions', 'submissionCount', 'totalSubmissions', 'submittedChecklists', 'checkedCount', 'checklistCount']),
      anomalies: findNumber(sources, ['anomalies', 'anomalyCount', 'totalAnomalies', 'abnormalCount', 'abnormalities']),
      highRisk: findNumber(sources, ['highRisk', 'highRiskCount', 'highRiskAnomalies', 'highSeverityCount']),
      openWorkorders: findNumber(sources, ['openWorkorders', 'openWorkorderCount', 'unclosedWorkorders', 'pendingWorkorders', 'activeWorkorders'])
    };
    var recentRaw = pickFromSources([root], ['recentAnomalies', 'recentAnomaly', 'recentAbnormal', 'latestAnomalies', 'recent']);
    if (recentRaw === null && Array.isArray(root.anomalies)) recentRaw = root.anomalies;
    var recentAnomalies = normalizeAnomalyList(recentRaw);
    var categoryRaw = pickFromSources(sources, ['byCategory', 'categoryStats', 'categories', 'anomaliesByCategory', 'categoryCounts', 'categoryDistribution']);
    var categories = normalizeCategoryStats(categoryRaw);
    var topRaw = pickFromSources(sources, ['topEquipment', 'topEquipments', 'equipmentTop', 'equipmentRanking', 'top5', 'abnormalEquipment']);
    var topEquipment = normalizeTopEquipment(topRaw);
    if (summary.anomalies === null && recentAnomalies.length) summary.anomalies = recentAnomalies.length;
    if (summary.highRisk === null && recentAnomalies.length) {
      summary.highRisk = recentAnomalies.filter(function (a) { return a.severity === 'HIGH'; }).length;
    }
    if (!topEquipment.length && recentAnomalies.length) {
      var map = {};
      recentAnomalies.forEach(function (a) {
        var key = a.equipmentCode || a.equipmentName;
        if (!key) return;
        if (!map[key]) map[key] = { equipmentCode: a.equipmentCode, equipmentName: a.equipmentName, count: 0 };
        map[key].count++;
      });
      topEquipment = Object.keys(map).map(function (k) { return map[k]; })
        .sort(function (a, b) { return b.count - a.count; }).slice(0, 5);
    }
    return {
      summary: summary,
      recentAnomalies: recentAnomalies,
      categories: categories,
      topEquipment: topEquipment
    };
  }
  function normalizeCategoryStats(raw) {
    var list = null;
    if (Array.isArray(raw)) list = raw;
    else if (raw && typeof raw === 'object' && Array.isArray(raw.items)) list = raw.items;
    var grouped = {};
    if (list) {
      list.forEach(function (item) {
        var code = 'OTHER', label = '其他类别', count = 0;
        if (typeof item === 'string') { code = item; label = categoryLabel(item); }
        else if (item && typeof item === 'object') {
          code = String(item.category || item.categoryCode || item.equipmentCategory || item.code || item.name || 'OTHER');
          label = String(item.label || item.categoryName || item.name || categoryLabel(code));
          count = numOf(item.count !== undefined ? item.count : (item.anomalyCount !== undefined ? item.anomalyCount : (item.total !== undefined ? item.total : item.value)));
        }
        if (count === null) count = 0;
        if (!grouped[code]) grouped[code] = { code: code, label: label, count: 0 };
        grouped[code].count += count;
      });
    } else if (raw && typeof raw === 'object') {
      Object.keys(raw).forEach(function (key) {
        var value = raw[key];
        var code = key;
        var label = categoryLabel(key);
        var count = 0;
        if (typeof value === 'number') count = value;
        else if (value && typeof value === 'object') {
          code = String(value.category || value.code || key);
          label = String(value.label || value.categoryName || categoryLabel(code));
          count = numOf(value.count !== undefined ? value.count : value.anomalyCount !== undefined ? value.anomalyCount : value.total) || 0;
        }
        grouped[code] = { code: code, label: label, count: count };
      });
    }
    return Object.keys(grouped).map(function (k) { return grouped[k]; })
      .filter(function (item) { return item.count > 0; })
      .sort(function (a, b) { return b.count - a.count; });
  }
  function normalizeTopEquipment(raw) {
    var list = null;
    if (Array.isArray(raw)) list = raw;
    else if (raw && typeof raw === 'object' && Array.isArray(raw.items)) list = raw.items;
    var grouped = {};
    if (list) {
      list.forEach(function (item) {
        if (!item || typeof item !== 'object') return;
        var code = String(item.equipmentCode || item.code || item.equipment || '');
        if (code && typeof item.equipment === 'object') code = String(item.equipment.equipmentCode || item.equipment.code || code);
        var name = String(item.equipmentName || item.name || item.label || (findEquipment(code) && findEquipment(code).name) || '');
        var count = numOf(item.count !== undefined ? item.count : item.anomalyCount !== undefined ? item.anomalyCount : item.total);
        if (count === null) count = 0;
        var key = code || name;
        if (!key) return;
        if (!grouped[key]) grouped[key] = { equipmentCode: code, equipmentName: name, count: 0 };
        grouped[key].count += count;
        if (!grouped[key].equipmentName && name) grouped[key].equipmentName = name;
      });
    } else if (raw && typeof raw === 'object') {
      Object.keys(raw).forEach(function (key) {
        var value = raw[key];
        var count = typeof value === 'number' ? value : (value && typeof value === 'object' ? numOf(value.count !== undefined ? value.count : value.anomalyCount) || 0 : 0);
        var eq = findEquipment(key);
        grouped[key] = { equipmentCode: key, equipmentName: eq ? eq.name : key, count: count };
      });
    }
    return Object.keys(grouped).map(function (k) { return grouped[k]; })
      .filter(function (item) { return item.count > 0; })
      .sort(function (a, b) { return b.count - a.count; })
      .slice(0, 5);
  }
  function renderDashboardSkeleton() {
    installDashboardErrorState();
    dom.dashboardContent.hidden = false;
    state.dashboardErrorState.hidden = true;
    hideInlineAlert(dom.dashboardAlert);
    clearNode(dom.summaryGrid);
    for (var i = 0; i < 4; i++) dom.summaryGrid.appendChild(el('div', 'skeleton skeleton-card'));
    clearNode(dom.categoryChart);
    dom.categoryChart.appendChild(el('div', 'skeleton skeleton-chart'));
    clearNode(dom.topEquipment);
    dom.topEquipment.appendChild(el('div', 'skeleton skeleton-chart'));
    clearNode(dom.recentAnomalies);
    for (var j = 0; j < 4; j++) dom.recentAnomalies.appendChild(el('div', 'skeleton skeleton-row'));
    dom.chartDaysBadge.textContent = '近 ' + state.dashboard.days + ' 天';
  }
  function renderDashboard() {
    installDashboardErrorState();
    dom.dashboardContent.hidden = false;
    state.dashboardErrorState.hidden = true;
    hideInlineAlert(dom.dashboardAlert);
    dom.chartDaysBadge.textContent = '近 ' + state.dashboard.days + ' 天';
    var data = state.dashboard.data;
    if (!data) { renderDashboardError(new Error('暂无看板数据')); return; }
    renderSummaryCards(data.summary || {});
    renderCategoryChart(data.categories || []);
    renderTopEquipment(data.topEquipment || []);
    renderRecentAnomalies(data.recentAnomalies || []);
  }
  function renderSummaryCards(summary) {
    clearNode(dom.summaryGrid);
    var cards = [
      { label: '点检提交', value: summary.submissions, sub: '近 ' + state.dashboard.days + ' 天', mark: '单', tone: '' },
      { label: '异常项', value: summary.anomalies, sub: '含高/中/低风险', mark: '异', tone: 'tone-card-amber' },
      { label: '高风险异常', value: summary.highRisk, sub: '须优先处置', mark: '危', tone: 'tone-card-red' },
      { label: '未闭环工单', value: summary.openWorkorders, sub: '待处理 / 处理中', mark: '工', tone: 'tone-card-green' }
    ];
    cards.forEach(function (card) {
      var node = el('div', 'card summary-card ' + card.tone);
      var label = el('div', 'summary-label');
      label.appendChild(el('span', '', card.label));
      label.appendChild(el('span', 'summary-mark', card.mark));
      node.appendChild(label);
      node.appendChild(el('div', 'summary-value', formatNumber(card.value)));
      node.appendChild(el('div', 'summary-sub', card.sub));
      dom.summaryGrid.appendChild(node);
    });
  }
  function renderCategoryChart(categories) {
    clearNode(dom.categoryChart);
    if (!categories.length) {
      var empty = el('div', 'chart-empty');
      append(empty, el('span', 'empty-mini', '∅'), el('b', '', '暂无类别异常'), el('span', '', '提交点检异常后显示类别分布'));
      dom.categoryChart.appendChild(empty);
      return;
    }
    var max = categories.reduce(function (m, c) { return Math.max(m, c.count); }, 1);
    categories.forEach(function (category) {
      var row = el('div', 'bar-row');
      var label = el('div', 'bar-label', category.label || categoryLabel(category.code));
      label.title = category.label || category.code;
      row.appendChild(label);
      var track = el('div', 'bar-track');
      var fill = el('div', 'bar-fill');
      fill.title = (category.label || category.code) + '：' + category.count + ' 项异常';
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('div', 'bar-value', String(category.count)));
      dom.categoryChart.appendChild(row);
      var pct = Math.max(category.count > 0 ? 4 : 0, Math.round(category.count / max * 100));
      fill.style.width = pct + '%';
    });
  }
  function renderTopEquipment(items) {
    clearNode(dom.topEquipment);
    if (!items.length) {
      var empty = el('div', 'rank-empty');
      append(empty, el('b', '', '暂无异常设备'), el('span', '', '设备异常统计将在这里展示'));
      dom.topEquipment.appendChild(empty);
      return;
    }
    items.forEach(function (item, index) {
      var row = el('div', 'rank-row');
      row.appendChild(el('span', 'rank-no', String(index + 1).padStart(2, '0')));
      var main = el('div', 'rank-main');
      var eq = findEquipment(item.equipmentCode);
      main.appendChild(el('div', 'rank-name', item.equipmentName || (eq && eq.name) || item.equipmentCode || '未知设备'));
      main.appendChild(el('div', 'rank-meta', item.equipmentCode || '—'));
      row.appendChild(main);
      var count = el('div', 'rank-count', String(item.count));
      count.appendChild(el('span', '', ' 项'));
      row.appendChild(count);
      dom.topEquipment.appendChild(row);
    });
  }
  function renderRecentAnomalies(items) {
    clearNode(dom.recentAnomalies);
    if (!items.length) {
      var empty = el('div', 'chart-empty');
      append(empty, el('span', 'empty-mini', '∅'), el('b', '', '暂无异常记录'), el('span', '', '完成点检并提交异常后，可在此直接建单'));
      dom.recentAnomalies.appendChild(empty);
      return;
    }
    var scroll = el('div', 'table-scroll');
    var table = el('table', 'data-table recent-table');
    var thead = el('thead');
    var head = el('tr');
    ['时间', '设备', '异常项', '等级', '备注', '处置'].forEach(function (h) { head.appendChild(el('th', '', h)); });
    thead.appendChild(head);
    var tbody = el('tbody');
    items.forEach(function (anomaly) {
      var row = el('tr');
      row.appendChild(el('td', 'muted', formatTime(anomaly.checkedAt)));
      var eqCell = el('td');
      eqCell.appendChild(el('span', 'recent-equip', anomaly.equipmentName || anomaly.equipmentCode || '未关联设备'));
      if (anomaly.equipmentCode) eqCell.appendChild(el('span', 'recent-equip-code', anomaly.equipmentCode));
      row.appendChild(eqCell);
      var itemCell = el('td', 'recent-item');
      itemCell.appendChild(el('div', '', anomaly.name || '异常项'));
      if (anomaly.code) itemCell.appendChild(el('span', 'cell-sub', anomaly.code));
      row.appendChild(itemCell);
      var sevCell = el('td');
      sevCell.appendChild(badge(SEV_LABEL[anomaly.severity] || anomaly.severity, anomaly.severity === 'HIGH' ? 'red' : anomaly.severity === 'MEDIUM' ? 'amber' : 'gray'));
      row.appendChild(sevCell);
      var noteCell = el('td', 'recent-note', anomaly.note || '—');
      noteCell.title = anomaly.note || '';
      row.appendChild(noteCell);
      var actionCell = el('td', 'recent-actions');
      if (anomaly.workorderId) {
        actionCell.appendChild(badge('已建单', 'green'));
        if (anomaly.workorderNo) actionCell.title = anomaly.workorderNo;
      } else {
        var btn = el('button', 'btn btn-ghost btn-sm', '建单');
        btn.type = 'button';
        if (!anomaly.anomalyId) {
          btn.disabled = true;
          btn.title = '缺少 anomalyId';
        } else {
          btn.addEventListener('click', function () { createWorkOrderFromAnomaly(anomaly, btn, 'dashboard'); });
        }
        actionCell.appendChild(btn);
      }
      row.appendChild(actionCell);
      tbody.appendChild(row);
    });
    append(table, thead, tbody);
    scroll.appendChild(table);
    dom.recentAnomalies.appendChild(scroll);
  }
  function renderDashboardError(err) {
    installDashboardErrorState();
    dom.dashboardContent.hidden = true;
    state.dashboardErrorState.hidden = false;
    clearNode(state.dashboardErrorState);
    state.dashboardErrorState.appendChild(el('div', 'empty-icon', '!'));
    state.dashboardErrorState.appendChild(el('h3', '', '看板加载失败'));
    state.dashboardErrorState.appendChild(el('p', '', (err && err.message) || '暂时无法获取看板数据，请稍后重试。'));
    var actions = el('div', 'empty-actions');
    var retry = el('button', 'btn btn-primary btn-sm', '重新加载');
    retry.type = 'button';
    retry.addEventListener('click', function () { return loadDashboard(); });
    actions.appendChild(retry);
    state.dashboardErrorState.appendChild(actions);
    hideInlineAlert(dom.dashboardAlert);
  }
  async function loadDashboard() {
    var seq = ++state.dashboard.requestSeq;
    state.dashboard.loading = true;
    setButtonBusy(dom.refreshDashboardBtn, true);
    setButtonBusy(dom.refreshDashboardInlineBtn, true);
    if (!state.dashboard.data) renderDashboardSkeleton();
    else hideInlineAlert(dom.dashboardAlert);
    try {
      var data = await api('/api/dashboard?days=' + encodeURIComponent(state.dashboard.days));
      if (seq !== state.dashboard.requestSeq) return;
      state.dashboard.data = normalizeDashboard(data);
      state.dashboard.loaded = true;
      state.dashboard.error = null;
      state.dashboard.stale = false;
      renderDashboard();
    } catch (err) {
      if (seq !== state.dashboard.requestSeq) return;
      state.dashboard.error = err;
      if (state.dashboard.data) {
        showInlineAlert(dom.dashboardAlert, {
          title: '看板刷新失败',
          message: err.message + ' 当前展示的可能为上次加载结果。',
          actions: [{ label: '重试刷新', fn: function () { return loadDashboard(); } }]
        });
      } else {
        renderDashboardError(err);
      }
    } finally {
      if (seq === state.dashboard.requestSeq) {
        state.dashboard.loading = false;
        setButtonBusy(dom.refreshDashboardBtn, false);
        setButtonBusy(dom.refreshDashboardInlineBtn, false);
      }
    }
  }

  // ---------- 工单 ----------
  function normalizeReport(report) {
    if (!report) return null;
    if (typeof report === 'string') {
      try { report = JSON.parse(report); } catch (e) { return { actions: report }; }
    }
    return report && typeof report === 'object' ? report : null;
  }
  function reportValue(report, keys) {
    if (!report) return '';
    for (var i = 0; i < keys.length; i++) {
      var value = report[keys[i]];
      if (value !== undefined && value !== null && value !== '') return textOf(value, '');
    }
    return '';
  }
  function normalizeWorkorder(raw) {
    var wo = raw && raw.workorder && typeof raw.workorder === 'object' ? raw.workorder : (raw || {});
    var equipment = wo.equipment && typeof wo.equipment === 'object' ? wo.equipment : {};
    var anomaly = wo.anomaly && typeof wo.anomaly === 'object' ? wo.anomaly : {};
    var code = String(wo.equipmentCode || equipment.equipmentCode || equipment.code || anomaly.equipmentCode || '');
    var eq = findEquipment(code);
    var id = String(wo.workorderId || wo.workOrderId || wo.id || wo.workorderNo || wo.workOrderNo || wo.no || '');
    var no = String(wo.workorderNo || wo.workOrderNo || wo.no || id);
    var status = normalizeStatus(wo.status || wo.state);
    return {
      workorderId: id,
      workorderNo: no,
      status: status,
      nextStatus: normalizeStatus(wo.nextStatus || wo.nextStatuses || wo.next || ''),
      equipmentCode: code,
      equipmentName: String(wo.equipmentName || equipment.name || anomaly.equipmentName || (eq && eq.name) || ''),
      anomalyId: String(wo.anomalyId || anomaly.anomalyId || anomaly.id || ''),
      anomalySummary: String(wo.anomalySummary || wo.summary || wo.symptom || wo.description || anomaly.name || anomaly.title || ''),
      severity: (wo.severity || wo.anomalySeverity || anomaly.severity) ? normalizeSeverity(wo.severity || wo.anomalySeverity || anomaly.severity) : '',
      priority: normalizePriority(wo.priority || wo.level),
      safetyFlag: !!wo.safetyFlag,
      createdAt: wo.createdAt || wo.createdTime || wo.reportedAt || wo.occurredAt || '',
      closedAt: wo.closedAt || wo.closedTime || wo.finishedAt || '',
      assignee: String(wo.assignee || wo.assignedTo || wo.owner || ''),
      operator: String(wo.operator || wo.reporter || wo.createdBy || ''),
      repairReport: normalizeReport(wo.repairReport || wo.repair_report || wo.report)
    };
  }
  function normalizeWorkorderList(data) {
    var raw = Array.isArray(data) ? data
      : asArray(data && (data.workorders || data.workOrders || data.items || data.list || data.data));
    return raw.filter(function (wo) { return wo && typeof wo === 'object'; }).map(normalizeWorkorder);
  }
  function statusActionLabel(next) { return STATUS_ACTION[next] || '推进状态'; }
  function renderWorkorderSkeleton() {
    clearNode(dom.workorderList);
    dom.workorderEmpty.hidden = true;
    for (var i = 0; i < 3; i++) dom.workorderList.appendChild(el('div', 'skeleton skeleton-card'));
  }
  function renderWorkorderError(err) {
    clearNode(dom.workorderList);
    dom.workorderEmpty.hidden = true;
    var card = el('div', 'card empty-panel');
    card.appendChild(el('div', 'empty-icon', '!'));
    card.appendChild(el('h3', '', '工单加载失败'));
    card.appendChild(el('p', '', (err && err.message) || '暂时无法获取工单，请稍后重试。'));
    var actions = el('div', 'empty-actions');
    var retry = el('button', 'btn btn-primary btn-sm', '重新加载');
    retry.type = 'button';
    retry.addEventListener('click', function () { return loadWorkorders(); });
    actions.appendChild(retry);
    card.appendChild(actions);
    dom.workorderList.appendChild(card);
  }
  function renderWorkorders() {
    var items = state.workorders.items;
    var closed = items.filter(function (wo) { return isClosed(wo.status); }).length;
    dom.woCountAll.textContent = String(items.length);
    dom.woCountClosed.textContent = String(closed);
    dom.woCountOpen.textContent = String(items.length - closed);
    dom.woFilterBar.querySelectorAll('.filter-chip').forEach(function (chip) {
      chip.classList.toggle('is-active', chip.getAttribute('data-filter') === state.workorders.filter);
    });
    clearNode(dom.workorderList);
    if (!items.length) {
      dom.workorderEmpty.hidden = false;
      return;
    }
    dom.workorderEmpty.hidden = true;
    var filtered = items.filter(function (wo) {
      if (state.workorders.filter === 'open') return !isClosed(wo.status);
      if (state.workorders.filter === 'closed') return isClosed(wo.status);
      return true;
    });
    if (!filtered.length) {
      dom.workorderList.appendChild(el('div', 'card wo-empty-inline', '当前筛选下暂无工单。'));
      return;
    }
    filtered.forEach(function (wo) { dom.workorderList.appendChild(renderWorkorderCard(wo)); });
  }
  function renderWorkorderCard(wo) {
    var meta = statusInfo(wo.status);
    var card = el('article', 'card wo-card status-' + meta.kind);
    card.setAttribute('data-workorder-id', wo.workorderId || wo.workorderNo || '');
    var head = el('div', 'wo-head');
    var idBlock = el('div', 'wo-id-block');
    var idRow = el('div', 'wo-id-row');
    idRow.appendChild(el('span', 'wo-no', wo.workorderNo || wo.workorderId || '未编号工单'));
    var badges = el('div', 'wo-badges');
    badges.appendChild(badge(meta.label, meta.tone));
    if (wo.priority) badges.appendChild(badge(wo.priority, wo.priority === 'P1' ? 'red' : wo.priority === 'P2' ? 'amber' : 'blue', true));
    if (wo.severity) badges.appendChild(badge((SEV_LABEL[wo.severity] || wo.severity) + '风险', wo.severity === 'HIGH' ? 'red' : wo.severity === 'MEDIUM' ? 'amber' : 'gray'));
    if (wo.safetyFlag) badges.appendChild(badge('安全风险', 'red'));
    idRow.appendChild(badges);
    idBlock.appendChild(idRow);
    var eqText = el('div', 'wo-equipment', wo.equipmentName || '未关联设备');
    if (wo.equipmentCode) eqText.appendChild(el('code', '', wo.equipmentCode));
    idBlock.appendChild(eqText);
    idBlock.appendChild(el('div', 'wo-summary', wo.anomalySummary || '暂无异常摘要'));
    head.appendChild(idBlock);
    card.appendChild(head);
    var metaRow = el('div', 'wo-meta');
    if (wo.createdAt) append(metaRow, (function () { var s = el('span'); append(s, el('b', '', '创建：'), document.createTextNode(formatTime(wo.createdAt, true))); return s; })());
    if (wo.anomalyId) append(metaRow, (function () { var s = el('span'); append(s, el('b', '', '来源异常：'), document.createTextNode(wo.anomalyId)); return s; })());
    if (wo.assignee) append(metaRow, (function () { var s = el('span'); append(s, el('b', '', '负责人：'), document.createTextNode(wo.assignee)); return s; })());
    if (wo.operator) append(metaRow, (function () { var s = el('span'); append(s, el('b', '', '操作人：'), document.createTextNode(wo.operator)); return s; })());
    if (wo.closedAt) append(metaRow, (function () { var s = el('span'); append(s, el('b', '', '结案：'), document.createTextNode(formatTime(wo.closedAt, true))); return s; })());
    if (metaRow.children.length) card.appendChild(metaRow);
    var body = el('div', 'wo-body');
    var report = wo.repairReport;
    var reportBox = el('div', 'wo-report');
    if (report) {
      var rootCause = reportValue(report, ['rootCause', 'cause']);
      var actions = reportValue(report, ['actions', 'action', 'repairAction', 'disposal']);
      var parts = reportValue(report, ['parts', 'partsReplaced', 'replacedParts']);
      var downTime = reportValue(report, ['downTime', 'downtime', 'downtimeHours']);
      var acceptor = reportValue(report, ['acceptor', 'acceptedBy']);
      var residual = reportValue(report, ['residualRisk', 'residual']);
      reportBox.appendChild(el('div', 'wo-report-label', '结案报告'));
      if (rootCause) reportBox.appendChild(el('p', '', '根因：' + rootCause));
      if (actions) reportBox.appendChild(el('p', '', '处置：' + actions));
      var reportMeta = el('div', 'report-meta');
      if (parts) reportMeta.appendChild(el('span', '', '备件：' + parts));
      if (downTime) reportMeta.appendChild(el('span', '', '停机：' + downTime));
      if (acceptor) reportMeta.appendChild(el('span', '', '验收：' + acceptor));
      if (residual) reportMeta.appendChild(el('span', '', '遗留风险：' + residual));
      if (reportMeta.children.length) reportBox.appendChild(reportMeta);
    } else if (isClosed(wo.status)) {
      reportBox.appendChild(el('div', 'wo-report-label', '结案报告'));
      reportBox.appendChild(el('p', '', '已结案，未填写结案报告。'));
    } else {
      reportBox.appendChild(el('div', 'wo-report-label', '闭环提示'));
      reportBox.appendChild(el('p', '', '结案时需填写根因、处置、停机时长与验收人，完成后自动回流知识候选池。'));
    }
    body.appendChild(reportBox);
    var actionsWrap = el('div', 'wo-actions');
    if (!isClosed(wo.status)) {
      var next = wo.nextStatus && wo.nextStatus !== 'UNKNOWN' ? wo.nextStatus : STATUS_NEXT[wo.status];
      if (next) {
        var advance = el('button', 'btn btn-ghost btn-sm', '推进：' + statusActionLabel(next));
        advance.type = 'button';
        advance.addEventListener('click', function () { advanceWorkorder(wo, advance); });
        actionsWrap.appendChild(advance);
      }
      var close = el('button', 'btn btn-primary btn-sm', '结案');
      close.type = 'button';
      if (!wo.workorderId && !wo.workorderNo) close.disabled = true;
      else close.addEventListener('click', function () { openClosureModal(wo); });
      actionsWrap.appendChild(close);
    } else {
      actionsWrap.appendChild(badge('已闭环', 'green'));
    }
    body.appendChild(actionsWrap);
    card.appendChild(body);
    return card;
  }
  async function loadWorkorders() {
    var seq = ++state.workorders.requestSeq;
    state.workorders.loading = true;
    hideInlineAlert(dom.workorderNotice);
    if (!state.workorders.items.length) renderWorkorderSkeleton();
    setButtonBusy(dom.refreshWorkordersBtn, true);
    try {
      var data = await api('/api/workorders');
      if (seq !== state.workorders.requestSeq) return;
      state.workorders.items = normalizeWorkorderList(data);
      state.workorders.loaded = true;
      state.workorders.error = null;
      state.workorders.stale = false;
      renderWorkorders();
    } catch (err) {
      if (seq !== state.workorders.requestSeq) return;
      state.workorders.error = err;
      if (state.workorders.items.length) {
        showInlineAlert(dom.workorderNotice, {
          title: '工单刷新失败',
          message: err.message + ' 当前展示的可能为上次加载结果。',
          actions: [{ label: '重试刷新', fn: function () { return loadWorkorders(); } }]
        });
      } else {
        showInlineAlert(dom.workorderNotice, {
          title: '工单加载失败',
          message: err.message,
          actions: [{ label: '重试加载', fn: function () { return loadWorkorders(); } }]
        });
        renderWorkorderError(err);
      }
    } finally {
      if (seq === state.workorders.requestSeq) {
        state.workorders.loading = false;
        setButtonBusy(dom.refreshWorkordersBtn, false);
      }
    }
  }
  function setWorkorderFilter(filter) {
    state.workorders.filter = filter || 'all';
    renderWorkorders();
    if (!state.workorders.loaded && !state.workorders.loading) loadWorkorders();
  }
  function replaceWorkorder(updated) {
    var key = updated.workorderId || updated.workorderNo;
    for (var i = 0; i < state.workorders.items.length; i++) {
      var current = state.workorders.items[i];
      if ((current.workorderId && current.workorderId === key) ||
          (current.workorderNo && current.workorderNo === updated.workorderNo)) {
        state.workorders.items[i] = updated;
        return;
      }
    }
  }
  async function advanceWorkorder(wo, button) {
    var target = wo.nextStatus && wo.nextStatus !== 'UNKNOWN' ? wo.nextStatus : STATUS_NEXT[wo.status];
    if (!target) { toast('当前状态没有可推进的下一步，请直接结案。', 'info'); return; }
    var key = wo.workorderId || wo.workorderNo;
    if (!key) { toast('缺少工单编号，无法更新状态。', 'warning'); return; }
    if (state.workorders.pending.has(key)) return;
    state.workorders.pending.add(key);
    setButtonBusy(button, true);
    try {
      var data = await api('/api/workorders/' + encodeURIComponent(key), {
        method: 'PATCH',
        body: { status: target, operator: getOperator() }
      });
      var returned = normalizeWorkorder(data && (data.workorder || data.data || data));
      var updated = Object.assign({}, wo);
      if (returned.workorderId && returned.status !== 'UNKNOWN') Object.assign(updated, returned);
      else updated.status = target;
      if (returned.workorderNo) updated.workorderNo = returned.workorderNo;
      replaceWorkorder(updated);
      state.workorders.loaded = true;
      state.workorders.stale = false;
      renderWorkorders();
      markDashboardStale();
      toast('工单状态已更新为「' + statusInfo(updated.status).label + '」。', 'success');
    } catch (err) {
      if (button && button.isConnected) setButtonBusy(button, false);
      toast(err.message, 'error', {
        title: '状态推进失败',
        action: { label: '重试', fn: function () { return advanceWorkorder(wo, null); } }
      });
    } finally {
      state.workorders.pending.delete(key);
    }
  }

  // ---------- 结案弹窗 ----------
  function openClosureModal(wo) {
    if (!wo || isClosed(wo.status)) { toast('该工单已结案。', 'info'); return; }
    state.lastFocused = document.activeElement;
    state.workorders.closingId = wo.workorderId || wo.workorderNo;
    state.workorders.closingWo = wo;
    state.workorders.submitting = false;
    dom.closeForm.reset();
    dom.closeWoId.value = state.workorders.closingId;
    dom.modalTitle.textContent = '填写结案报告';
    dom.modalSubtitle.textContent = '工单 ' + (wo.workorderNo || wo.workorderId || '—') + ' · ' + (wo.equipmentName || '未关联设备');
    hideInlineAlert(dom.closeFormAlert);
    [dom.rootCauseInput, dom.repairActionsInput, dom.downTimeInput, dom.acceptorInput].forEach(function (input) {
      input.removeAttribute('aria-invalid');
    });
    var report = wo.repairReport;
    if (report) {
      dom.rootCauseInput.value = reportValue(report, ['rootCause', 'cause']);
      dom.repairActionsInput.value = reportValue(report, ['actions', 'action', 'repairAction', 'disposal']);
      dom.partsInput.value = reportValue(report, ['parts', 'partsReplaced', 'replacedParts']);
      var down = reportValue(report, ['downTime', 'downtime', 'downtimeHours']);
      var parsed = parseFloat(String(down).replace(/[^\d.]/g, ''));
      dom.downTimeInput.value = isFinite(parsed) ? String(parsed) : '';
      dom.acceptorInput.value = reportValue(report, ['acceptor', 'acceptedBy']);
      dom.residualRiskInput.value = reportValue(report, ['residualRisk', 'residual']);
    }
    dom.closeOperatorInput.value = getOperator();
    dom.modalHost.hidden = false;
    document.body.classList.add('modal-open');
    setTimeout(function () { focusNoScroll(dom.rootCauseInput); }, 30);
  }
  function closeClosureModal(force) {
    if (state.workorders.submitting && !force) return;
    dom.modalHost.hidden = true;
    document.body.classList.remove('modal-open');
    state.workorders.closingId = null;
    state.workorders.closingWo = null;
    if (state.lastFocused && state.lastFocused.isConnected) {
      try { state.lastFocused.focus({ preventScroll: true }); } catch (e) { /* 忽略 */ }
    }
    state.lastFocused = null;
  }
  function validateClosure() {
    var fields = [
      { input: dom.rootCauseInput, label: '故障根因' },
      { input: dom.repairActionsInput, label: '处置措施' },
      { input: dom.downTimeInput, label: '停机时长' },
      { input: dom.acceptorInput, label: '验收人' }
    ];
    var first = null;
    fields.forEach(function (field) {
      var empty = !String(field.input.value || '').trim();
      if (empty) {
        field.input.setAttribute('aria-invalid', 'true');
        if (!first) first = field;
      } else {
        field.input.removeAttribute('aria-invalid');
      }
    });
    var hours = Number(dom.downTimeInput.value);
    if (!String(dom.downTimeInput.value).trim() || !isFinite(hours) || hours < 0) {
      dom.downTimeInput.setAttribute('aria-invalid', 'true');
      if (!first) first = { input: dom.downTimeInput, label: '停机时长' };
    }
    if (first) {
      focusNoScroll(first.input);
      showInlineAlert(dom.closeFormAlert, {
        title: '请完善结案信息',
        message: '「' + first.label + '」不能为空，停机时长须为不小于 0 的数字。'
      });
      return null;
    }
    return {
      rootCause: dom.rootCauseInput.value.trim(),
      actions: dom.repairActionsInput.value.trim(),
      parts: dom.partsInput.value.trim(),
      downTime: hours,
      acceptor: dom.acceptorInput.value.trim(),
      residualRisk: dom.residualRiskInput.value.trim()
    };
  }
  async function submitClosure() {
    if (state.workorders.submitting) return;
    var wo = state.workorders.closingWo;
    if (!wo) { closeClosureModal(true); return; }
    var report = validateClosure();
    if (!report) return;
    var key = wo.workorderId || wo.workorderNo;
    if (!key) {
      showInlineAlert(dom.closeFormAlert, { title: '缺少工单编号', message: '无法提交结案，请刷新工单列表后重试。' });
      return;
    }
    state.workorders.submitting = true;
    setButtonBusy(dom.closeSubmitBtn, true);
    hideInlineAlert(dom.closeFormAlert);
    try {
      var data = await api('/api/workorders/' + encodeURIComponent(key), {
        method: 'PATCH',
        body: {
          status: 'CLOSED',
          repairReport: report,
          operator: dom.closeOperatorInput.value.trim() || getOperator()
        },
        timeout: 30000
      });
      var returned = normalizeWorkorder(data && (data.workorder || data.data || data));
      var updated = Object.assign({}, wo);
      if (returned.workorderId && returned.status !== 'UNKNOWN') Object.assign(updated, returned);
      else updated.status = 'CLOSED';
      updated.status = 'CLOSED';
      updated.repairReport = returned.repairReport || report;
      updated.closedAt = returned.closedAt || latestTimestamp();
      replaceWorkorder(updated);
      state.workorders.loaded = true;
      state.workorders.stale = false;
      bumpDashboardOpenWorkorders(-1);
      markDashboardStale();
      state.workorders.submitting = false;
      closeClosureModal(true);
      renderWorkorders();
      showClosureSuccess(updated);
    } catch (err) {
      showInlineAlert(dom.closeFormAlert, {
        title: '结案提交失败',
        message: err.message + ' 已填写的内容不会丢失，可直接重试。',
        actions: [{ label: '重试提交', fn: function () { return submitClosure(); } }]
      });
      toast(err.message, 'error', { title: '结案提交失败' });
    } finally {
      state.workorders.submitting = false;
      setButtonBusy(dom.closeSubmitBtn, false);
    }
  }
  function showClosureSuccess(wo) {
    var label = wo.workorderNo || wo.workorderId || '该工单';
    showInlineAlert(dom.workorderNotice, {
      type: 'success',
      title: '工单已结案，已回流知识候选池',
      message: label + ' 的根因与处置已写入知识候选池，待管理员复核后入库。',
      actions: [{ label: '查看已结案工单', fn: function () { setWorkorderFilter('closed'); } }]
    });
    toast('工单已结案，已回流知识候选池。', 'success', { title: '结案成功' });
  }

  // ---------- 事件绑定 ----------
  function bindEvents() {
    dom.tabs.forEach(function (tab) {
      tab.addEventListener('click', function () { switchTab(tab.getAttribute('data-tab')); });
      tab.addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        var index = dom.tabs.indexOf(tab);
        if (event.key === 'Home') index = 0;
        else if (event.key === 'End') index = dom.tabs.length - 1;
        else index = (index + (event.key === 'ArrowRight' ? 1 : -1) + dom.tabs.length) % dom.tabs.length;
        dom.tabs[index].focus();
        switchTab(dom.tabs[index].getAttribute('data-tab'));
      });
    });
    document.addEventListener('click', function (event) {
      var goto = event.target.closest ? event.target.closest('[data-goto-tab]') : null;
      if (goto) switchTab(goto.getAttribute('data-goto-tab'));
    });

    dom.chatForm.addEventListener('submit', function (event) { event.preventDefault(); handleSend(); });
    dom.chatInput.addEventListener('input', function () {
      dom.charCount.textContent = dom.chatInput.value.length + ' / 1000';
      resizeComposer();
      updateSendState();
    });
    dom.chatInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        handleSend();
      }
    });
    dom.promptChips.addEventListener('click', function (event) {
      var chip = event.target.closest ? event.target.closest('.prompt-chip') : null;
      if (!chip || state.chatBusy) return;
      var prompt = chip.getAttribute('data-prompt');
      if (prompt) {
        dom.chatInput.value = '';
        updateSendState();
        requestChat(prompt);
      }
    });
    dom.clearChatBtn.addEventListener('click', clearChat);
    dom.exitGuideBtn.addEventListener('click', function () { exitGuide(); });
    dom.guideStatePill.addEventListener('click', function () {
      if (state.guide.node && state.guide.node.question) toast('当前问题：' + state.guide.node.question, 'info');
    });

    dom.equipmentSelect.addEventListener('change', function () { selectEquipment(dom.equipmentSelect.value, { announce: true }); });
    dom.checkEquipment.addEventListener('change', function () { selectEquipment(dom.checkEquipment.value, { announce: true }); });
    dom.refreshEquipmentBtn.addEventListener('click', function () { loadEquipment(); });

    dom.generateChecklistBtn.addEventListener('click', loadChecklist);
    dom.submitChecklistBtn.addEventListener('click', submitChecklist);
    dom.clearChecklistBtn.addEventListener('click', function () {
      if (!state.checklist.items.length) return;
      state.checklist.results = state.checklist.items.map(function (item) {
        return { result: 'OK', note: '', severity: item.securityCritical ? 'HIGH' : 'MEDIUM' };
      });
      renderChecklistTable();
      hideInlineAlert(dom.checklistAlert);
      toast('已清空填报结果并恢复默认 OK。', 'info');
    });
    dom.checklistTbody.addEventListener('change', function (event) {
      var row = event.target.closest ? event.target.closest('tr[data-index]') : null;
      if (!row) return;
      var index = Number(row.getAttribute('data-index'));
      var result = state.checklist.results[index];
      if (!result) return;
      if (event.target.matches('input[type="radio"]')) {
        result.result = event.target.value;
        updateChecklistRowState(index, false);
        updateChecklistCounts();
      } else if (event.target.matches('.severity-select')) {
        result.severity = event.target.value;
      }
    });
    dom.checklistTbody.addEventListener('input', function (event) {
      var row = event.target.closest ? event.target.closest('tr[data-index]') : null;
      if (!row) return;
      var index = Number(row.getAttribute('data-index'));
      var result = state.checklist.results[index];
      if (!result) return;
      if (event.target.matches('.note-input')) {
        result.note = event.target.value;
        event.target.removeAttribute('aria-invalid');
        row.classList.remove('row-error');
        var noteError = row.querySelector('.note-error');
        if (noteError) noteError.hidden = true;
      }
    });

    dom.rangeSwitch.addEventListener('click', function (event) {
      var btn = event.target.closest ? event.target.closest('.range-btn') : null;
      if (!btn) return;
      var days = Number(btn.getAttribute('data-days'));
      if (days !== 7 && days !== 30) return;
      if (days === state.dashboard.days && state.dashboard.loaded && !state.dashboard.stale) return;
      state.dashboard.days = days;
      state.dashboard.stale = true;
      dom.rangeSwitch.querySelectorAll('.range-btn').forEach(function (b) { b.classList.toggle('is-active', b === btn); });
      dom.chartDaysBadge.textContent = '近 ' + days + ' 天';
      loadDashboard();
    });
    dom.refreshDashboardBtn.addEventListener('click', function () { loadDashboard(); });
    dom.refreshDashboardInlineBtn.addEventListener('click', function () { loadDashboard(); });

    dom.woFilterBar.addEventListener('click', function (event) {
      var chip = event.target.closest ? event.target.closest('.filter-chip') : null;
      if (!chip) return;
      setWorkorderFilter(chip.getAttribute('data-filter'));
    });
    dom.refreshWorkordersBtn.addEventListener('click', function () { loadWorkorders(); });

    dom.modalCloseBtn.addEventListener('click', function () { closeClosureModal(); });
    dom.modalCancelBtn.addEventListener('click', function () { closeClosureModal(); });
    dom.modalBackdrop.addEventListener('click', function () { closeClosureModal(); });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !dom.modalHost.hidden) closeClosureModal();
    });
    dom.closeForm.addEventListener('submit', function (event) { event.preventDefault(); submitClosure(); });
  }

  // ---------- 启动 ----------
  function init() {
    bindEvents();
    installDashboardErrorState();
    updateSessionMeta();
    updateComposerMode();
    resizeComposer();
    updateSendState();
    dom.generateChecklistBtn.disabled = true;
    var initial = String(location.hash || '').replace('#', '');
    switchTab(['qa', 'checklist', 'dashboard', 'workorders'].indexOf(initial) >= 0 ? initial : 'qa');
    loadHealth();
    loadEquipment({ silent: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
