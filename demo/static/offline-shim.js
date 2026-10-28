/* =============================================================================
   维修百事通 · 离线单文件 API 垫片（offline-shim.js）
   -----------------------------------------------------------------------------
   作用：在浏览器端拦截 window.fetch 的 /api/* 请求，用内嵌数据复现
        demo/server.py 的离线能力，使单文件 HTML 无需任何服务即可演示：
        问答 / 排查引导 / 点检生成与填报 / 看板 / 工单 / 知识回流。
   约束：仅使用浏览器标准 API，无网络、无第三方库；不改动原有 UI 代码。
   由 demo/build-offline.mjs 注入到 deliverables/维修百事通-离线演示.html。
   ========================================================================== */
(function () {
  'use strict';

  var root = (typeof window !== 'undefined') ? window : ((typeof globalThis !== 'undefined') ? globalThis : this);
  if (!root || root.__WXBST_OFFLINE_SHIM__) { return; }
  root.__WXBST_OFFLINE_SHIM__ = true;

  var VERSION = '1.0.0';
  var MAX_TREE_TURNS = 8;
  var QA_MIN_SCORE = 12;

  var CATEGORY_NAMES = {
    LATHE: '数控车床', MILL: '加工中心', PRN: '3D 打印机',
    LSR: '激光切割机', CMP: '空压机', MOT: '电机', PWR: '配电柜',
    CCM: '连铸机', FUR: '加热炉', ROL: '轧机', FAN: '除尘风机', HYD: '液压站', EAF: '电弧炉',
    BAL: '球磨机', KIL: '回转窑', THK: '浓密机', GEN: '通用设备'
  };
  var CATEGORY_ALIASES = {
    LATHE: ['车床', '数控车床', '车削', 'CK6140', '卡盘', '刀架'],
    MILL: ['加工中心', '铣床', '铣削', 'VMC850', '刀库'],
    PRN: ['3D打印', '3D 打印', '打印机', '增材', 'FDM', '喷头', '热床'],
    LSR: ['激光', '激光切割', '切割机', '切割', '镜片', '光路'],
    CMP: ['空压机', '压缩机', '气源', '储气罐', '螺杆机'],
    MOT: ['电机', '电动机', '马达', '三相异步'],
    PWR: ['配电柜', '配电箱', '开关柜', '电柜', '母排', '断路器'],
    CCM: ['连铸机', '连铸', '结晶器', '中间包', '板坯'],
    FUR: ['加热炉', '步进梁', '炉温', '烧嘴', '钢坯加热'],
    ROL: ['轧机', '精轧机', '精轧', '热连轧', '轧钢', '轧制', '轧线', '带钢', '板带', '轧辊', '板形'],
    FAN: ['除尘风机', '除尘', '风机', '布袋除尘', '引风机'],
    HYD: ['液压站', '液压系统', '液压油', '蓄能器', '伺服阀', 'AGC'],
    EAF: ['电弧炉', '电炉', '电极', '短网', '炉衬'],
    BAL: ['球磨机', '磨机', '球磨', '磨矿', '钢球', '填充率'],
    KIL: ['回转窑', '水泥窑', '石灰窑', '窑炉', '燃烧器', '斜度'],
    THK: ['浓密机', '高效浓密机', '浓缩机', '浓缩', '浓密', '底流', '溢流', '沉降面积']
  };
  var FREQUENCY_NAMES = { D: '日点检', W: '周点检', M: '月点检' };
  var STATUS_FLOW = ['DRAFT', 'PENDING_CONFIRM', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'PENDING_ACCEPTANCE', 'CLOSED'];
  var WORKORDER_NEXT = {};
  for (var flowIndex = 0; flowIndex < STATUS_FLOW.length - 1; flowIndex++) {
    WORKORDER_NEXT[STATUS_FLOW[flowIndex]] = STATUS_FLOW[flowIndex + 1];
  }
  var HOLD_STATUS = 'ON_HOLD';
  var RESULT_VALUES = ['OK', 'ABNORMAL', 'NA'];
  var SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'];
  var PROBABILITY_RANK = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  var SEVERITY_RANK = { HIGH: 3, MEDIUM: 2, LOW: 1 };

  var HAZARD_RE = /旋转|主轴|刀具|卡盘|刀库|带电|电气|高压|压力|带压|压缩空气|气源|高温|加热|热床|喷头|激光|辐射|冷却液|切削液|起重|吊装|防护门|联锁|烫伤|触电|夹伤|卷入|坠落|易燃|有毒|燃气|熔融金属|钢水|铁水|煤气|氮气|氩气|蒸汽|放射源|粉尘/;

  var DANGER_SAFE_PHRASES = ['不带电', '已断电', '断电挂牌', '停电挂牌', '已泄压', '不带压', '已验电', '已停机挂牌', '已上锁'];

  var DANGER_RULES = [
    {
      category: '电气',
      patterns: [
        /带电/,
        /带(?:着|有)电/,
        /(?:没|未|不|别|不要|不用)(?:断|停)电[^。；;]{0,20}(?:拆|接|检|清理|伸手|打开|作业|紧固|紧|拧|拨|碰|测|量)/,
        /(?:没|未|别|不要|不用)(?:断|停)电/,
        /未验电/,
        /漏电/,
        /触电/,
        /(?:配电柜|电柜|开关柜|配电箱)[^。；;]{0,10}(?:冒烟|起火|焦味|焦糊|打火|火花)/,
        /(?:冒烟|起火|着火|焦糊味|焦味|明火)/
      ],
      safety: '立即停机 → 断开上一级电源 → 上锁挂牌 → 验电确认零能量（LOTO 一人一锁一牌）',
      path: '由持证电工在停电、验电、挂牌上锁后执行；禁止以绝缘手套替代断电',
      target: '持证电工与安全员',
      risk: '带电作业可能造成触电、电弧灼伤甚至死亡；未验电不得触碰柜内母排。'
    },
    {
      category: '机械',
      patterns: [
        /(?:运转|旋转|运行|开着机|开机|通电)[^。；;]{0,12}(?:伸手|清理|测量|拆|摸|接触|调整|取件|擦)/,
        /(?:没|未|不|别|不要|不用)(?:挂牌|上锁)/,
        /(?:没|未|不|别|不要|不用)(?:停机|停稳)[^。；;]{0,12}(?:清理|伸手|拆|检查|调整|拨|摸|碰)/,
        /伸手[^。；;]{0,10}(?:进|入)[^。；;]{0,10}(?:刀库|卡盘|主轴|刀具|光路|皮带|齿轮|设备)/,
        /(?:拆|打开|卸下|摘下)[^。；;]{0,8}(?:防护罩|防护门|安全门|安全罩|护罩)/,
        /短接[^。；;]{0,8}(?:联锁|安全|限位)/,
        /(?:屏蔽|旁路|强制)[^。；;]{0,8}(?:联锁|安全|限位|保护)/
      ],
      safety: '立即停机、断开动力源、挂牌上锁，待运动部件完全停止并确认零能量',
      path: '由授权人员按 LOTO 流程停机挂牌后检查，监护人全程在场；禁止拆除防护罩或短接联锁',
      target: '实训教师与维修人员',
      risk: '运转中伸手可能造成卷入、切割、挤压等严重伤害。'
    },
    {
      category: '压力与燃气',
      patterns: [
        /带压/,
        /(?:还在|仍有|未泄压|没泄压|不泄压)[^。；;]{0,16}(?:拆|卸|拧|检修|打开|清洗)/,
        /(?:\d+(?:\.\d+)?\s*(?:mpa|兆帕|bar|公斤))[^。；;]{0,20}(?:拆|卸|拧|检修|打开|清洗)/i,
        /拆[^。；;]{0,8}(?:安全阀|储气罐|压力容器|后冷却器|气管|水管|压力表)/,
        /(?:燃气|压缩空气|气瓶|储气罐)[^。；;]{0,8}(?:泄漏|超压)/,
        /(?:气瓶|储气罐)[^。；;]{0,8}(?:带压|超压)/
      ],
      safety: '先关气源并挂牌 → 泄压至 0 且表压归零 → 降温；禁明火与开关电器',
      path: '泄漏时立即撤离、开窗通风并报 119，由持证人员处置；禁止带压紧固',
      target: '持证压力设备操作人员与安全员',
      risk: '带压拆卸可能导致高压气体喷射、部件飞出或燃气爆炸。'
    },
    {
      category: '高温熔融金属',
      patterns: [
        /(?:钢水|铁水|熔融金属|液态金属)[^。；;]{0,12}(?:溅|喷|取样|扒渣|靠近|伸手|打开|吊运|放钢|漏钢|冲水|用水)/,
        /(?:漏钢|钢水喷溅|铁水喷溅|钢包漏钢)/,
        /(?:潮湿|积水)[^。；;]{0,12}(?:钢包|中间包|钢水|铁水|钢锭模)/,
        /(?:出钢|出铁|加料|测温取样)[^。；;]{0,12}(?:靠近|站人|通过|停留)/,
        /(?:钢包|中间包|铁水罐|钢锭模)[^。；;]{0,10}(?:吊运|起吊|下方|站人)/
      ],
      safety: '立即停止作业并撤离至安全区 → 确认漏钢/喷溅源与人员位置 → 通知调度、安全员与消防；禁止用水扑救熔融金属',
      path: '由炼钢/连铸值班人员按应急预案处置；恢复前确认平台干燥、设备冷却水无泄漏',
      target: '炼钢/连铸值班人员、安全员与消防应急人员',
      risk: '熔融金属遇水会剧烈汽化爆炸；喷溅可致严重灼伤甚至死亡，不得靠近观察或用水降温。'
    },
    {
      category: '煤气与有毒气体',
      patterns: [
        /(?:煤气|co|一氧化碳|高炉煤气|焦炉煤气|转炉煤气)[^。；;]{0,12}(?:泄漏|超标|报警|味道|异味|进入|检修|动火)/,
        /(?:进入|靠近|停留)[^。；;]{0,8}(?:煤气区域|煤气柜|煤气管道|煤气脱水器)/,
        /(?:未|没有|不)(?:检测|通风)[^。；;]{0,12}(?:煤气|有限空间|地坑|管道)/,
        /(?:煤气|co)[^。；;]{0,8}(?:中毒|窒息)/
      ],
      safety: '立即撤离至上风向 → 切断气源 → 设置警戒 → 佩戴正压式空气呼吸器；禁止开关电器、动火或使用手机',
      path: '由煤气防护站/安全员检测 CO 浓度并办理煤气作业票；未检测合格不得进入',
      target: '煤气防护人员、安全员与应急救援人员',
      risk: 'CO 无色无味，低浓度即可致头痛、昏迷甚至死亡；煤气区域动火可引发爆炸。'
    },
    {
      category: '窒息与蒸汽',
      patterns: [
        /(?:氮气|氩气|蒸汽|惰性气体)[^。；;]{0,12}(?:泄漏|窒息|进入|吹扫|检修|直接接触)/,
        /(?:进入|钻入|打开)[^。；;]{0,10}(?:氮气|氩气|蒸汽|管道|容器|炉膛)/,
        /(?:蒸汽|高温水)[^。；;]{0,10}(?:喷出|泄漏|烫伤)/
      ],
      safety: '立即撤离并通风 → 关闭气源/蒸汽阀 → 检测氧含量（19.5%–23.5%）→ 设置警戒',
      path: '由设备与安全人员确认置换合格、氧含量达标后进入；蒸汽管道检修须泄压降温',
      target: '设备管理员与安全员',
      risk: '氮气/氩气无色无味，泄漏可致瞬间缺氧窒息；蒸汽喷出可致严重烫伤。'
    },
    {
      category: '起重与吊装',
      patterns: [
        /(?:吊物|钢包|铁水罐|中间包|轧辊|备件|模具)[^。；;]{0,12}(?:下方|下面|站人|通过|停留)/,
        /(?:起吊|吊运)[^。；;]{0,12}(?:未|没有|不)(?:检查|试吊|警戒|确认)/,
        /(?:天车|行车|起重机)[^。；;]{0,12}(?:超载|斜拉|斜吊|载人)/,
        /(?:钢丝绳|吊钩|吊具)[^。；;]{0,10}(?:断丝|裂纹|变形|报废)[^。；;]{0,10}(?:继续|使用)/
      ],
      safety: '立即停止吊装并设置警戒 → 人员撤离吊物下方 → 检查吊具与钢丝绳 → 由持证起重人员重新确认',
      path: '执行起重作业票与十不吊；吊物下方严禁站人，由持证指挥人员统一指挥',
      target: '持证起重人员与安全员',
      risk: '吊物坠落可致群死群伤；钢包/铁水罐坠落会引发熔融金属喷溅爆炸。'
    },
    {
      category: '高处与有限空间',
      patterns: [
        /(?:没|未)[^。；;]{0,4}(?:系|挂)[^。；;]{0,4}安全带/,
        /(?:未|没)(?:检测|通风)[^。；;]{0,12}(?:地坑|窨井|有限空间|受限空间)/,
        /单独进入[^。；;]{0,8}(?:地坑|窨井|有限空间|受限空间)/
      ],
      safety: '先通风、再检测、后作业；O2 19.5%-23.5%、可燃气 <10% LEL 且连续监测',
      path: '落实监护人、三脚架与救援绳，办理作业票后由受训人员进入',
      target: '安全员与作业监护人',
      risk: '缺氧、中毒或坠落可能造成群死群伤，无监护不得进入。'
    },
    {
      category: '危化品',
      patterns: [
        /(?:不|未)(?:戴|佩戴|穿)[^。；;]{0,10}(?:手套|护目镜|防护服|口罩)[^。；;]{0,12}(?:冷却液|清洗剂|油品|切削液)/,
        /(?:废液|冷却液|清洗剂|油品)[^。；;]{0,10}(?:直排|倒下水|混排)/,
        /皮肤接触[^。；;]{0,8}(?:冷却液|清洗剂|油品)/
      ],
      safety: '佩戴防护用品并通风，按 MSDS 处置；接触后用大量清水冲洗不少于 15 分钟',
      path: '脱离现场、就医并报安全员；废液分类收集，禁止直排下水',
      target: '安全员与环保管理人员',
      risk: '化学品接触可致灼伤、过敏或中毒；混排废液可能产生有毒气体。'
    },
    {
      category: '特种设备',
      patterns: [
        /(?:电梯|起重|压力容器)[^。；;]{0,12}(?:还能用|继续使用|不用检|免检|先凑合)/,
        /(?:安全阀|安全附件)[^。；;]{0,10}(?:失效|拆除)[^。；;]{0,10}(?:继续|运行)/
      ],
      safety: '立即停用并设置警示，报安全员联系有资质单位检验',
      path: '由法定检验机构检验合格后方可恢复使用，不得以问答替代法定检验',
      target: '安全员与设备管理员',
      risk: '安全附件失效仍运行可能造成爆炸、坠落等特种设备事故。'
    }
  ];

  var GENERIC_SYMPTOMS = [
    '异响', '噪音', '噪声', '报警', '漏油', '漏气', '漏水', '过热', '发热', '高温',
    '振动', '抖动', '卡滞', '卡死', '堵塞', '堵头', '不出丝', '不出光', '断丝',
    '停机', '跳闸', '不转', '无法启动', '启动不了', '尺寸超差', '裂纹', '冒烟',
    '焦味', '异味', '压力上不去', '乱刀', '过载', '绝缘低', '跳机', '打滑',
    '缺料', '挂渣', '偏位', '烧点', '乳化', '油位低', '端子过热', '保护镜片',
    '刀库', '换刀', '主轴', '刀架', '丝杠', '导轨', '皮带', '轴承', '滤芯',
    '散热', '风扇', '气管', '冷却', '润滑', '气压', '电容', '激光', '喷头',
    '热床', '挤出机', '绝缘', '联锁', '光栅', '急停', '压力表', '温度',
    '压力', '波动', '流量', '电流', '油温', '炉温', '液面', '板形', '电极', '炉衬',
    '短网', '煤气', '钢水', '液位', '拉速', '铜板', '轧辊', '烧嘴', '阀门', '水口',
    '塞棒', '压差', '风量', '漏钢', '粘结', '结瘤', '偏心', '内泄', '爬行', '泄漏',
    '超温', '超压'
  ];

  var STORE_KEYS = {
    submissions: 'wxbst.offline.submissions.v1',
    anomalies: 'wxbst.offline.anomalies.v1',
    workorders: 'wxbst.offline.workorders.v1',
    candidates: 'wxbst.offline.knowledge_candidates.v1',
    sequence: 'wxbst.offline.sequence.v1'
  };
  var SESSION_PREFIX = 'wxbst.offline.session.v1.';

  var DATA = readEmbeddedData();
  var EQUIPMENT_ALIASES = [];
  var CATEGORY_ALIAS_LIST = [];
  var SYMPTOM_TERMS = [];
  var KN_INDEX = [];
  var VECTOR_IDS = [];
  var VECTOR_VECS = [];
  var VECTOR_DIM = 512;
  var LS = pickStore('localStorage');
  var SS = pickStore('sessionStorage');

  // ---------------------------------------------------------------------------
  // 基础工具
  // ---------------------------------------------------------------------------

  function readEmbeddedData() {
    var raw = root.__WXBST_DATA__;
    if (!raw) {
      try {
        var node = root.document && root.document.getElementById && root.document.getElementById('wxbst-data');
        if (node && node.textContent) { raw = JSON.parse(node.textContent); }
      } catch (e) { raw = null; }
    }
    raw = (raw && typeof raw === 'object') ? raw : {};
    return {
      meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : {},
      equipment: Array.isArray(raw.equipment) ? raw.equipment : [],
      knowledge: Array.isArray(raw.knowledge) ? raw.knowledge : [],
      checklists: (raw.checklists && typeof raw.checklists === 'object') ? raw.checklists : {},
      trees: (raw.trees && typeof raw.trees === 'object') ? raw.trees : {}
    };
  }

  function text(value) {
    return (value === null || value === undefined) ? '' : String(value);
  }

  function compact(value) {
    return text(value).toLowerCase().replace(/[\s\u3000]+/g, '');
  }

  function optionNorm(value) {
    return compact(value).replace(/[，。！？、；：,.!?;:（）()【】\[\]「」『』"'“”‘’]/g, '');
  }

  function truncate(value, max) {
    var str = text(value);
    return str.length > max ? str.slice(0, max) + '…' : str;
  }

  function pad(value, length) {
    var str = String(value);
    while (str.length < length) { str = '0' + str; }
    return str;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function dateKey(date) {
    var d = date || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2);
  }

  function dateCompact(date) {
    return dateKey(date).replace(/-/g, '');
  }

  function clone(value) {
    if (value === null || value === undefined) { return value; }
    try { return JSON.parse(JSON.stringify(value)); } catch (e) { return value; }
  }

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function memoryStore() {
    var map = {};
    return {
      getItem: function (key) { return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null; },
      setItem: function (key, value) { map[key] = String(value); },
      removeItem: function (key) { delete map[key]; },
      key: function (index) { var keys = Object.keys(map); return index < keys.length ? keys[index] : null; },
      get length() { return Object.keys(map).length; }
    };
  }

  function pickStore(name) {
    try {
      var store = root[name];
      if (!store) { return memoryStore(); }
      var probe = '__wxbst_probe_' + Math.random().toString(36).slice(2);
      store.setItem(probe, '1');
      store.removeItem(probe);
      return store;
    } catch (e) {
      return memoryStore();
    }
  }

  function readJSON(store, key, fallback) {
    try {
      var raw = store.getItem(key);
      if (!raw) { return fallback; }
      var value = JSON.parse(raw);
      return (value === null || value === undefined) ? fallback : value;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(store, key, value) {
    try { store.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  function readList(key) {
    var value = readJSON(LS, key, []);
    return Array.isArray(value) ? value : [];
  }

  function writeList(key, list, maxLength) {
    var cap = maxLength || 400;
    writeJSON(LS, key, list.slice(0, cap));
  }

  function nextSeq(prefix) {
    var seq = readJSON(LS, STORE_KEYS.sequence, {});
    if (!isObject(seq)) { seq = {}; }
    var current = Number(seq[prefix]) || 0;
    current += 1;
    seq[prefix] = current;
    var keys = Object.keys(seq);
    if (keys.length > 160) {
      keys.slice(0, keys.length - 100).forEach(function (key) { delete seq[key]; });
    }
    writeJSON(LS, STORE_KEYS.sequence, seq);
    return current;
  }

  function apiError(status, code, message) {
    var error = new Error(message);
    error.__apiError = true;
    error.status = status;
    error.code = code;
    return error;
  }

  function getQuery(query, name) {
    if (!query) { return ''; }
    if (typeof query.get === 'function') { return text(query.get(name)); }
    if (Object.prototype.hasOwnProperty.call(query, name)) { return text(query[name]); }
    return '';
  }

  function parseBody(body) {
    if (body === undefined || body === null || body === '') { return {}; }
    if (typeof body === 'string') {
      try {
        var parsed = JSON.parse(body);
        return isObject(parsed) ? parsed : {};
      } catch (e) {
        throw apiError(400, 'BAD_JSON', '请求体不是合法 JSON');
      }
    }
    if (isObject(body)) { return body; }
    return {};
  }

  function categoryName(category) {
    return CATEGORY_NAMES[category] || text(category);
  }

  function frequencyName(frequency) {
    return FREQUENCY_NAMES[frequency] || text(frequency);
  }

  // ---------------------------------------------------------------------------
  // 数据索引
  // ---------------------------------------------------------------------------

  function buildCategoryAliases() {
    CATEGORY_ALIAS_LIST = [];
    Object.keys(CATEGORY_ALIASES).forEach(function (category) {
      CATEGORY_ALIASES[category].forEach(function (alias) {
        var normalized = compact(alias);
        if (normalized) { CATEGORY_ALIAS_LIST.push({ alias: normalized, category: category }); }
      });
    });
    CATEGORY_ALIAS_LIST.sort(function (a, b) { return b.alias.length - a.alias.length; });
  }

  function buildEquipmentAliases() {
    EQUIPMENT_ALIASES = [];
    DATA.equipment.forEach(function (equipment) {
      var push = function (value, kind) {
        var alias = compact(value);
        if (!alias || alias.length < 3) { return; }
        if (kind === 'token' && /^[0-9.]+$/.test(alias)) { return; }
        EQUIPMENT_ALIASES.push({ alias: alias, equipment: equipment, kind: kind });
      };
      push(equipment.equipmentCode, 'code');
      push(equipment.name, 'name');
      text(equipment.name).split(/[\s,，、/（）()]+/).forEach(function (token) { push(token, 'token'); });
    });
    EQUIPMENT_ALIASES.sort(function (a, b) { return b.alias.length - a.alias.length; });
  }

  function buildSymptomTerms() {
    var seen = {};
    var list = [];
    var blocked = {};
    CATEGORY_ALIAS_LIST.forEach(function (item) { blocked[item.alias] = true; });
    EQUIPMENT_ALIASES.forEach(function (item) { blocked[item.alias] = true; });

    function add(value) {
      var term = compact(value);
      if (!term || term.length < 2 || seen[term] || blocked[term]) { return; }
      seen[term] = true;
      list.push(term);
    }
    DATA.knowledge.forEach(function (entry) {
      (entry.symptomKeywords || []).forEach(add);
    });
    DATA.equipment.forEach(function (equipment) {
      (equipment.commonFaults || []).forEach(add);
    });
    GENERIC_SYMPTOMS.forEach(add);
    list.sort(function (a, b) { return b.length - a.length; });
    SYMPTOM_TERMS = list;
  }

  function pushTerm(list, value, weight) {
    var term = compact(value);
    if (!term || term.length < 2) { return; }
    list.push({ t: term, w: weight });
  }

  function buildTermList(entry) {
    var list = [];
    pushTerm(list, entry.title, 3.2);
    text(entry.title).split(/[（）()·,，、/\-—\s]+/).forEach(function (segment) {
      pushTerm(list, segment, 3.8);
    });
    pushTerm(list, entry.symptom, 1.2);
    (entry.symptomKeywords || []).forEach(function (keyword) { pushTerm(list, keyword, 4.2); });
    (entry.tags || []).forEach(function (tag) { pushTerm(list, tag, 2.2); });
    pushTerm(list, categoryName(entry.equipmentCategory), 2.6);
    (CATEGORY_ALIASES[entry.equipmentCategory] || []).forEach(function (alias) { pushTerm(list, alias, 1.2); });
    (entry.causes || []).forEach(function (cause) { pushTerm(list, cause.rootCause, 1.6); });
    (entry.actions || []).forEach(function (action) { pushTerm(list, action, 0.35); });
    pushTerm(list, entry.risk, 0.2);
    (entry.equipmentCodes || []).forEach(function (code) { pushTerm(list, code, 9); });
    return list;
  }

  function collectBigrams(value) {
    var map = {};
    var runs = compact(value).match(/[\u4e00-\u9fff]+/g) || [];
    for (var r = 0; r < runs.length; r++) {
      var run = runs[r];
      if (run.length <= 2 && run.length > 0) { map[run] = true; }
      for (var i = 0; i + 2 <= run.length; i++) { map[run.slice(i, i + 2)] = true; }
    }
    return map;
  }

  function collectWords(value) {
    var map = {};
    var words = compact(value).match(/[a-z0-9][a-z0-9._\-]*/g) || [];
    for (var i = 0; i < words.length; i++) {
      if (words[i].length >= 2) { map[words[i]] = true; }
    }
    return map;
  }

  function buildIndexes() {
    KN_INDEX = [];
    DATA.knowledge.forEach(function (entry, order) {
      var haystack = [entry.title, entry.symptom, (entry.symptomKeywords || []).join(' '), (entry.tags || []).join(' ')].join(' ');
      KN_INDEX.push({
        entry: entry,
        order: order,
        terms: buildTermList(entry),
        bigrams: collectBigrams(haystack),
        words: collectWords(haystack)
      });
    });
    vectorBuild();
  }

  function hashEmbed(value) {
    var low = compact(value);
    var features = [];
    var runs = low.match(/[\u4e00-\u9fff]+/g) || [];
    runs.forEach(function (run) {
      for (var i = 0; i < run.length; i++) {
        features.push(run.charAt(i));
        if (i + 2 <= run.length) { features.push(run.slice(i, i + 2)); }
        if (i + 3 <= run.length) { features.push(run.slice(i, i + 3)); }
      }
    });
    var words = low.match(/[a-z0-9][a-z0-9._-]*/g) || [];
    words.forEach(function (word) { if (word.length >= 2) { features.push(word); } });
    var vector = [];
    for (var d = 0; d < VECTOR_DIM; d++) { vector.push(0); }
    features.forEach(function (feature) {
      var hash = 2166136261;
      for (var k = 0; k < feature.length; k++) {
        hash ^= feature.charCodeAt(k);
        hash = Math.imul(hash, 16777619) >>> 0;
      }
      var index = hash % VECTOR_DIM;
      vector[index] += (hash & 1) ? 1 : -1;
    });
    var norm = 0;
    vector.forEach(function (v) { norm += v * v; });
    norm = Math.sqrt(norm);
    if (norm > 0) { for (var j = 0; j < vector.length; j++) { vector[j] /= norm; } }
    return vector;
  }

  function cosine(a, b) {
    if (!a || !b || a.length !== b.length) { return 0; }
    var sum = 0;
    for (var i = 0; i < a.length; i++) { sum += a[i] * b[i]; }
    return sum;
  }

  function vectorBuild() {
    VECTOR_IDS = [];
    VECTOR_VECS = [];
    DATA.knowledge.forEach(function (entry) {
      var haystack = [
        entry.title, entry.symptom,
        (entry.symptomKeywords || []).join(' '),
        (entry.tags || []).join(' '),
        (entry.causes || []).map(function (c) { return c.rootCause || ''; }).join(' '),
        (entry.actions || []).join(' ')
      ].join(' ');
      VECTOR_IDS.push(entry.id);
      VECTOR_VECS.push(hashEmbed(haystack));
    });
  }

  function retrieve(query, context) {
    context = context || {};
    var q = compact(query);
    if (!q) { return []; }
    var rows = [];
    var queryVector = hashEmbed(query);
    for (var index = 0; index < KN_INDEX.length; index++) {
      var item = KN_INDEX[index];
      var entry = item.entry;
      var score = 0;
      for (var t = 0; t < item.terms.length; t++) {
        var term = item.terms[t];
        if (term.t.length >= 2 && q.indexOf(term.t) !== -1) {
          score += term.w * Math.min(term.t.length, 6) / 2;
        }
      }
      var bigramHits = 0;
      for (var bigram in item.bigrams) {
        if (Object.prototype.hasOwnProperty.call(item.bigrams, bigram) && q.indexOf(bigram) !== -1) { bigramHits += 1; }
      }
      score += Math.min(bigramHits, 12) * 0.55;
      for (var word in item.words) {
        if (Object.prototype.hasOwnProperty.call(item.words, word) && q.indexOf(word) !== -1) { score += 2.2; }
      }
      if (context.category) {
        if (text(entry.equipmentCategory).toUpperCase() === context.category) { score += 3.5; }
        else { score *= 0.5; }
      }
      if (context.equipmentCode && (entry.equipmentCodes || []).indexOf(context.equipmentCode) !== -1) { score += 5; }
      var similarity = 0;
      if (!context.category || text(entry.equipmentCategory).toUpperCase() === context.category) {
        similarity = cosine(queryVector, VECTOR_VECS[index] || []);
        score += 2.4 * similarity;
      }
      rows.push({ entry: entry, score: Math.round(score * 100) / 100, vector: Math.round(similarity * 1000) / 1000 });
    }
    rows.sort(function (a, b) { return b.score - a.score; });
    return rows.slice(0, 6);
  }

  // ---------------------------------------------------------------------------
  // 槽位与意图
  // ---------------------------------------------------------------------------

  function findEquipment(code) {
    var target = compact(code);
    if (!target) { return null; }
    for (var i = 0; i < DATA.equipment.length; i++) {
      if (compact(DATA.equipment[i].equipmentCode) === target) { return DATA.equipment[i]; }
    }
    return null;
  }

  function detectEquipment(value) {
    var low = compact(value);
    if (!low) { return null; }
    for (var i = 0; i < EQUIPMENT_ALIASES.length; i++) {
      if (low.indexOf(EQUIPMENT_ALIASES[i].alias) !== -1) { return EQUIPMENT_ALIASES[i].equipment; }
    }
    return null;
  }

  function detectCategory(value) {
    var low = compact(value);
    if (!low) { return ''; }
    for (var i = 0; i < CATEGORY_ALIAS_LIST.length; i++) {
      if (low.indexOf(CATEGORY_ALIAS_LIST[i].alias) !== -1) { return CATEGORY_ALIAS_LIST[i].category; }
    }
    return '';
  }

  function equipmentForCategory(category, symptom) {
    var cat = text(category).toUpperCase();
    var low = compact(symptom);
    var best = null;
    var bestScore = -1;
    DATA.equipment.forEach(function (equipment) {
      if (text(equipment.category).toUpperCase() !== cat) { return; }
      var score = 0;
      (equipment.commonFaults || []).forEach(function (fault) {
        var normalized = compact(fault);
        if (low && normalized && low.indexOf(normalized) !== -1) { score += 2; }
      });
      if (!best || score > bestScore) { best = equipment; bestScore = score; }
    });
    return best;
  }

  function extractSymptom(message, equipment) {
    var low = compact(message);
    var found = [];
    for (var i = 0; i < SYMPTOM_TERMS.length; i++) {
      var term = SYMPTOM_TERMS[i];
      if (term.length >= 2 && low.indexOf(term) !== -1) { found.push(term); }
    }
    if (equipment) {
      (equipment.commonFaults || []).forEach(function (fault) {
        var normalized = compact(fault);
        if (normalized && low.indexOf(normalized) !== -1 && found.indexOf(normalized) === -1) { found.push(normalized); }
      });
    }
    found.sort(function (a, b) { return b.length - a.length; });
    var selected = [];
    found.forEach(function (term) {
      if (selected.length >= 3) { return; }
      var covered = false;
      for (var s = 0; s < selected.length; s++) {
        if (selected[s].indexOf(term) !== -1) { covered = true; break; }
      }
      if (!covered) { selected.push(term); }
    });
    var symptom = selected.join('、');
    var specificity = selected.length ? selected[0].length : 0;
    if (!symptom) {
      var match = text(message).match(/(?:[^\s，。！？,.!?；;：:]{0,12})(?:异响|噪音|噪声|报警|漏油|漏气|漏水|过热|发热|高温|振动|抖动|卡滞|卡死|堵塞|堵头|不出丝|不出光|断丝|停机|跳闸|不转|无法启动|启动不了|尺寸超差|裂纹|冒烟|焦味|异味|压力上不去|乱刀|过载|绝缘低|跳机)/);
      if (match && match[0]) {
        symptom = match[0].replace(/^[的了吗呢啊呀哦]+/, '').trim();
        specificity = symptom.length >= 3 ? 3 : 2;
      }
    }
    var alarm = text(message).match(/ALM[-\s]?\d{2,4}/i);
    if (alarm && alarm[0]) {
      var alarmCode = alarm[0].toUpperCase().replace(/\s+/g, '');
      if (symptom.indexOf(alarmCode) === -1) {
        symptom = symptom ? (symptom + '、' + alarmCode) : alarmCode;
        specificity = Math.max(specificity, 3);
      }
    }
    return { symptom: symptom, specificity: specificity };
  }

  function extractSlots(message, equipmentCodeHint) {
    var low = compact(message);
    var slots = {
      equipment: null,
      equipmentCode: '',
      category: '',
      symptom: '',
      symptomSpecificity: 0,
      frequency: '',
      anomalyId: '',
      workOrderNo: ''
    };
    for (var i = 0; i < DATA.equipment.length; i++) {
      var equipment = DATA.equipment[i];
      if (low.indexOf(compact(equipment.equipmentCode)) !== -1) {
        slots.equipment = equipment;
        slots.equipmentCode = equipment.equipmentCode;
        slots.category = equipment.category;
        break;
      }
    }
    if (!slots.equipment) {
      var byAlias = detectEquipment(message);
      if (byAlias) {
        slots.equipment = byAlias;
        slots.equipmentCode = byAlias.equipmentCode;
        slots.category = byAlias.category;
      }
    }
    if (!slots.category) { slots.category = detectCategory(message); }

    var symptomInfo = extractSymptom(message, slots.equipment);
    slots.symptom = symptomInfo.symptom;
    slots.symptomSpecificity = symptomInfo.specificity;

    var frequencyMatch = low.match(/(?:日|每天|每日|日常|一天|每班)/);
    if (frequencyMatch) { slots.frequency = 'D'; }
    if (/(?:周|每周|一周)/.test(low)) { slots.frequency = 'W'; }
    if (/(?:月|每月|月度)/.test(low)) { slots.frequency = 'M'; }

    var anomalyMatch = text(message).match(/AN-\d{8}-\d{3,4}/i);
    if (anomalyMatch) { slots.anomalyId = anomalyMatch[0].toUpperCase(); }
    var workOrderMatch = text(message).match(/WO-\d{8}-\d{3,4}/i);
    if (workOrderMatch) { slots.workOrderNo = workOrderMatch[0].toUpperCase(); }
    return slots;
  }

  function mergeSlots(session, raw, equipmentCodeHint) {
    var slots = {
      equipment: raw.equipment || null,
      equipmentCode: raw.equipmentCode || '',
      category: raw.category || '',
      symptom: raw.symptom || '',
      symptomSpecificity: raw.symptomSpecificity || 0,
      frequency: raw.frequency || '',
      anomalyId: raw.anomalyId || '',
      workOrderNo: raw.workOrderNo || '',
      rawCategory: raw.category || '',
      rawEquipmentCode: raw.equipmentCode || ''
    };
    if (!slots.equipmentCode && !slots.category) {
      if (session.equipmentCode) {
        var remembered = findEquipment(session.equipmentCode);
        if (remembered) {
          slots.equipment = remembered;
          slots.equipmentCode = remembered.equipmentCode;
          slots.category = remembered.category;
        }
      } else if (session.category) {
        slots.category = session.category;
      }
    }
    if (!slots.equipmentCode && equipmentCodeHint) {
      var hinted = findEquipment(equipmentCodeHint);
      if (hinted && (!slots.category || slots.category === hinted.category)) {
        slots.equipment = hinted;
        slots.equipmentCode = hinted.equipmentCode;
        slots.category = hinted.category;
      }
    }
    if (!slots.equipment && slots.category) {
      var byCategory = equipmentForCategory(slots.category, slots.symptom || session.symptom);
      if (byCategory) {
        slots.equipment = byCategory;
        slots.equipmentCode = byCategory.equipmentCode;
        slots.category = byCategory.category;
      }
    }
    if (!slots.symptom && session.symptom) {
      var mentionsContext = !!(slots.rawEquipmentCode || slots.rawCategory);
      var sameContext = !!(session.equipmentCode && slots.equipmentCode && session.equipmentCode === slots.equipmentCode);
      if (!mentionsContext || sameContext) {
        slots.symptom = session.symptom;
        slots.symptomSpecificity = Math.max(3, session.symptom.length);
      }
    }
    if (slots.equipmentCode) { session.equipmentCode = slots.equipmentCode; }
    if (slots.category) { session.category = slots.category; }
    if (slots.symptom) { session.symptom = slots.symptom; }
    if (slots.frequency) { session.frequency = slots.frequency; }
    return slots;
  }

  function isVague(slots) {
    var hasContext = !!(slots.equipmentCode || slots.category);
    if (!slots.symptom) { return true; }
    if (!hasContext && slots.symptomSpecificity < 3) { return true; }
    return false;
  }

  function dataStats() {
    var checklistItems = 0;
    Object.keys(DATA.checklists).forEach(function (category) {
      var byFrequency = DATA.checklists[category] || {};
      Object.keys(byFrequency).forEach(function (frequency) {
        if (Array.isArray(byFrequency[frequency])) { checklistItems += byFrequency[frequency].length; }
      });
    });
    return {
      equipment: DATA.equipment.length,
      knowledge: DATA.knowledge.length,
      checklistItems: checklistItems,
      trees: Object.keys(DATA.trees).length
    };
  }

  // ==== PART2 ====

  // ---------------------------------------------------------------------------
  // 通用字段与安全判断
  // ---------------------------------------------------------------------------

  function normalizeProbability(value) {
    var upper = text(value).toUpperCase();
    return (upper === 'HIGH' || upper === 'MEDIUM' || upper === 'LOW') ? upper : 'MEDIUM';
  }

  function normalizeSeverity(value) {
    var upper = text(value).toUpperCase();
    return (upper === 'HIGH' || upper === 'MEDIUM' || upper === 'LOW') ? upper : 'MEDIUM';
  }

  function confidenceLabel(value) {
    if (value === 'HIGH') { return '高'; }
    if (value === 'LOW') { return '低'; }
    return '中';
  }

  function isHazardous(entry) {
    if (!entry) { return false; }
    if (entry.securityCritical) { return true; }
    var haystack = [
      entry.title, entry.symptom, entry.risk,
      (entry.actions || []).join(' '),
      (entry.symptomKeywords || []).join(' ')
    ].join(' ');
    return HAZARD_RE.test(haystack);
  }

  function actionRisk(entry, actionText) {
    var low = text(actionText);
    if (/立即|停机|断电|急停|更换|拆检|拆|上锁|挂牌|泄压|验电|LOTO/i.test(low)) { return 'HIGH'; }
    if (/检查|观察|记录|清洁|擦拭|确认|复测|测量|盘车|听音/.test(low)) { return 'LOW'; }
    return 'MEDIUM';
  }

  function ensureSafetyActions(actions, entry) {
    if (!isHazardous(entry)) { return actions; }
    var hasLoto = false;
    for (var i = 0; i < actions.length; i++) {
      if (/停机|断电|挂牌|上锁|泄压|LOTO/i.test(actions[i].action)) { hasLoto = true; break; }
    }
    if (!hasLoto) {
      actions.unshift({
        action: '停机、断电、挂牌上锁（LOTO），确认运动部件停止、能量归零',
        criterion: '设备完全停止；电气验电确零；压力设备泄压至表压归零',
        riskLevel: 'HIGH'
      });
    }
    return actions.slice(0, 7);
  }

  function basePayload(sid, intent) {
    return {
      sessionId: sid,
      intent: intent,
      answerType: 'REFUSAL',
      conclusion: '',
      confidence: 'LOW',
      rootCause: '',
      causes: [],
      actions: [],
      risks: '',
      citations: [],
      nextStep: { enterTroubleshooting: false, firstQuestion: '', treeId: '' },
      clarify: null,
      escalate: false,
      text: '',
      sources: [],
      equipmentCode: '',
      mode: 'offline',
      offline: true,
      generatedAt: nowIso()
    };
  }

  function composeText(conclusion, causes, actions, risks, sources, nextQuestion) {
    var lines = [];
    lines.push('结论：' + conclusion);
    lines.push('可能原因：');
    if (causes.length) {
      causes.forEach(function (cause, index) {
        lines.push((index + 1) + '. ' + cause.rootCause +
          '（概率 ' + cause.probability +
          '；依据：' + (cause.basis || '—') +
          '；验证：' + (cause.verifyMethod || '—') + '）');
      });
    } else {
      lines.push('1. 证据不足，暂不推断具体原因。');
    }
    lines.push('处置步骤：');
    if (actions.length) {
      actions.forEach(function (action, index) {
        lines.push((index + 1) + '. ' + action.action +
          '（判据：' + (action.criterion || '—') +
          '；风险：' + (action.riskLevel || 'MEDIUM') + '）');
      });
    } else {
      lines.push('1. 先完成安全确认，再联系实训教师检查。');
    }
    lines.push('风险提示：' + risks);
    if (sources.length) {
      lines.push('来源：' + sources.map(function (source) { return '[' + source.id + '] ' + source.title; }).join('；'));
    } else {
      lines.push('来源：本地知识库未检索到对应条目。');
    }
    if (nextQuestion) {
      lines.push('下一步：可进入排查引导；首问「' + nextQuestion + '」。');
    } else {
      lines.push('下一步：按上述步骤逐项验证，如仍无法定位请联系实训教师或维修人员。');
    }
    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // 问答与拒答
  // ---------------------------------------------------------------------------

  function chatPayload(sid) {
    var payload = basePayload(sid, 'CHAT');
    payload.answerType = 'CHAT';
    payload.conclusion = '我是维修百事通，面向实训车间与中小企业设备维护的故障诊断与点检助手。';
    payload.confidence = 'HIGH';
    payload.text = [
      '结论：我可以帮你做四件事——故障现象问答、逐步排查引导、电子点检清单、点检异常看板与工单。',
      '使用建议：',
      '1. 描述设备（名称或编码）与具体现象，例如「数控车床 CK6140 主轴异响」。',
      '2. 需要现场排查时回答「带我一步步查」。',
      '3. 需要点检时说「给 CK6140 出一份日点检清单」。',
      '风险提示：涉及冒烟、漏电、人员受伤等紧急情况，请先停机断电并联系实训教师。',
      '来源：本地知识库。'
    ].join('\n');
    payload.actions = [
      { action: '在问答页描述现象，或打开点检页生成清单', criterion: '设备名称/编码 + 具体现象', riskLevel: 'LOW' }
    ];
    return payload;
  }

  function unknownPayload(sid) {
    var payload = basePayload(sid, 'UNKNOWN');
    payload.conclusion = '该问题超出设备故障诊断与点检范围，本次无法回答。';
    payload.clarify = '请描述设备故障现象、点检或工单相关的问题。';
    payload.text = [
      '结论：该问题超出设备故障诊断与点检范围，本次无法回答。',
      '建议：可询问「主轴异响是什么原因」「给我一份日点检清单」「把这条异常建成工单」。',
      '下一步：如属设备问题请补充设备与现象；如属其他问题请联系实训教师。',
      '风险提示：不要在带电、带压或防护罩拆开的状态下检查设备。',
      '来源：本地知识库未检索。'
    ].join('\n');
    return payload;
  }

  function clarifyPayload(sid, intent, slots, message) {
    var question = '';
    var options = [];
    if (!slots.equipmentCode && !slots.category) {
      question = '请先说明设备（名称或编码）与最主要的异常现象，例如「数控车床 CK6140 主轴异响」或「空压机压力上不去」。';
      options = DATA.equipment.slice(0, 6).map(function (equipment) {
        return equipment.name + '（' + equipment.equipmentCode + '）';
      });
    } else {
      var equipmentName = slots.equipment ? slots.equipment.name : categoryName(slots.category);
      if (slots.equipment && Array.isArray(slots.equipment.commonFaults)) {
        options = slots.equipment.commonFaults.slice(0, 6);
      }
      if (!options.length) {
        DATA.knowledge.forEach(function (entry) {
          if (entry.equipmentCategory === slots.category && options.length < 6) {
            (entry.symptomKeywords || []).slice(0, 2).forEach(function (keyword) {
              if (options.indexOf(keyword) === -1) { options.push(keyword); }
            });
          }
        });
      }
      question = '请描述 ' + equipmentName + ' 的具体现象（如：' + (options.join('、') || '异响、报警、过热、泄漏') + '），并说明发生时机与已做的检查。';
    }
    var payload = basePayload(sid, intent || 'QA');
    payload.conclusion = '信息不足，暂不给出诊断结论。';
    payload.clarify = question;
    payload.clarifyOptions = options;
    payload.equipmentCode = slots.equipmentCode || '';
    payload.text = [
      '结论：信息不足，暂不给出诊断结论。',
      '需要补充：' + question,
      options.length ? '可选描述：' + options.join('；') : '',
      '下一步：补充后我会重新检索本地知识库。',
      '风险提示：信息不足时不要凭猜测拆检设备。',
      '来源：本地知识库（尚未检索到可用证据）。'
    ].filter(function (line) { return !!line; }).join('\n');
    return payload;
  }

  function noHitPayload(sid, slots, message) {
    var payload = basePayload(sid, 'QA');
    payload.conclusion = '未在本地知识库检索到与「' + truncate(message, 30) + '」匹配的可靠条目，本次不给出诊断结论。';
    payload.clarify = '请补充设备名称/编码、报警代码（如 ALM-750）、发生时机、已做的检查与结果；若涉及冒烟、焦糊味、漏电或人员受伤，请立即停机断电并联系实训教师。';
    payload.equipmentCode = slots.equipmentCode || '';
    payload.text = [
      '结论：未在本地知识库检索到与「' + truncate(message, 30) + '」匹配的可靠条目，本次不给出诊断结论。',
      '可能原因：证据不足，不做猜测。',
      '处置步骤：',
      '1. 补充设备编码/名称、报警代码、发生时机与已做的检查结果。',
      '2. 涉及安全风险时先停机、断电、挂牌上锁，由教师或持证人员处理。',
      '风险提示：证据不足时按猜测拆检可能扩大故障或造成人身伤害。',
      '来源：本地知识库（0 条命中）。'
    ].join('\n');
    payload.risks = '证据不足时不得凭猜测拆检；涉及带电、带压、旋转部件时先停机断电挂牌上锁。';
    return payload;
  }

  function dangerPayload(sid, rule, message) {
    var hits = retrieve(message, { category: detectCategory(message) });
    var sources = [];
    hits.forEach(function (hit) {
      if (sources.length < 2 && hit.score >= 2) {
        sources.push({ id: hit.entry.id, title: hit.entry.title });
      }
    });
    var payload = basePayload(sid, 'DANGER');
    payload.conclusion = '已拦截：该请求涉及「' + rule.category + '」安全红线，不能继续给出操作指导。';
    payload.confidence = 'HIGH';
    payload.trigger = rule.category;
    payload.safeAction = rule.safety;
    payload.escalate = true;
    payload.clarify = '如确需继续，请先说明已完成停机、断电、挂牌上锁与验电/泄压确认，并由实训教师或持证人员监护。';
    payload.citations = sources.map(function (source) { return source.id; });
    payload.sources = sources;
    payload.actions = [
      { action: rule.safety, criterion: '停机、断电、挂牌上锁、验电/泄压确认零能量', riskLevel: 'HIGH' },
      { action: rule.path, criterion: '由持证人员按合规流程执行，教师或监护人全程在场', riskLevel: 'HIGH' },
      { action: '转人工：' + rule.target, criterion: '完成安全确认并交接现场情况', riskLevel: 'HIGH' }
    ];
    payload.risks = rule.risk;
    payload.text = [
      '结论：已拦截。该请求涉及「' + rule.category + '」安全红线，不能继续给出操作指导。',
      '触发原因：' + truncate(message, 60),
      '安全确认：' + rule.safety,
      '合规路径：' + rule.path,
      '风险提示：' + rule.risk,
      '转人工：' + rule.target,
      sources.length ? '来源：' + sources.map(function (source) { return '[' + source.id + '] ' + source.title; }).join('；') : '来源：安全规则库。'
    ].join('\n');
    return payload;
  }

  function composeDiagnosis(sid, slots, hits) {
    var top = hits[0].entry;
    var equipment = slots.equipment || findEquipment((top.equipmentCodes || [])[0]);
    var category = slots.category || text(top.equipmentCategory).toUpperCase();
    var equipmentName = equipment ? equipment.name : categoryName(category);
    var symptomDisplay = slots.symptom || top.symptom || '该现象';

    var sourceEntries = [top];
    for (var h = 1; h < hits.length && sourceEntries.length < 3; h++) {
      if (hits[h].score >= hits[0].score * 0.4) { sourceEntries.push(hits[h].entry); }
    }

    var causes = [];
    var seenCauses = {};
    sourceEntries.forEach(function (entry) {
      (entry.causes || []).forEach(function (cause) {
        if (causes.length >= 5) { return; }
        var rootCause = text(cause.rootCause);
        if (!rootCause || seenCauses[rootCause]) { return; }
        seenCauses[rootCause] = true;
        causes.push({
          rootCause: rootCause,
          probability: normalizeProbability(cause.probability),
          basis: text(cause.basis),
          verifyMethod: text(cause.verifyMethod)
        });
      });
    });
    causes.sort(function (a, b) { return (PROBABILITY_RANK[b.probability] || 0) - (PROBABILITY_RANK[a.probability] || 0); });

    var actions = [];
    var seenActions = {};
    var addActions = function (entry) {
      var checks = Array.isArray(entry.checks) ? entry.checks : [];
      (entry.actions || []).forEach(function (action, index) {
        var actionText = text(action);
        if (!actionText || seenActions[actionText] || actions.length >= 6) { return; }
        seenActions[actionText] = true;
        var criterion = checks[index] && checks[index].criterion ? text(checks[index].criterion) : (checks[0] ? text(checks[0].criterion) : '');
        if (!criterion) { criterion = '按知识条目的判定标准复核'; }
        actions.push({ action: actionText, criterion: criterion, riskLevel: actionRisk(entry, actionText) });
      });
    };
    addActions(top);
    if (actions.length < 3) { sourceEntries.slice(1).forEach(addActions); }
    actions = ensureSafetyActions(actions, top);

    var riskParts = [];
    sourceEntries.forEach(function (entry) {
      var risk = text(entry.risk);
      if (risk && riskParts.indexOf(risk) === -1) { riskParts.push(risk); }
    });
    if (!riskParts.length) { riskParts.push('未确认安全前不得拆检，误判可能扩大故障。'); }
    if (isHazardous(top) && !/停机|断电|挂牌|上锁|能量/.test(riskParts.join(''))) {
      riskParts.push('处置前须停机、断电、挂牌上锁，并确认运动部件停止、能量归零。');
    }
    var risks = riskParts.join('；');

    var second = hits[1] ? hits[1].score : 0;
    var confidence = 'MEDIUM';
    if (hits[0].score >= 26 && (second === 0 || hits[0].score >= second * 1.15)) { confidence = 'HIGH'; }
    else if (hits[0].score < 15) { confidence = 'LOW'; }

    var treeId = selectTree(category, symptomDisplay);
    var firstQuestion = '';
    if (treeId) {
      var tree = DATA.trees[treeId];
      var rootNode = tree && tree.nodes ? tree.nodes[text(tree.root)] : null;
      if (rootNode && rootNode.question) { firstQuestion = text(rootNode.question); }
    }

    var topCause = causes.length ? causes[0].rootCause : (text(top.title) || '知识库条目所述故障');
    var conclusion = equipmentName + '「' + truncate(symptomDisplay, 30) + '」最可能为' + topCause + '，置信度' + confidenceLabel(confidence) + '。';

    var citations = sourceEntries.map(function (entry) { return entry.id; });
    var sources = sourceEntries.map(function (entry) { return { id: entry.id, title: entry.title }; });
    var nextStep = { enterTroubleshooting: !!treeId, firstQuestion: firstQuestion, treeId: treeId || '' };

    var payload = basePayload(sid, 'QA');
    payload.answerType = 'DIAGNOSIS';
    payload.conclusion = conclusion;
    payload.confidence = confidence;
    payload.rootCause = causes.length ? causes[0].rootCause : '';
    payload.causes = causes;
    payload.actions = actions;
    payload.risks = risks;
    payload.citations = citations;
    payload.sources = sources;
    payload.nextStep = nextStep;
    payload.escalate = confidence === 'LOW';
    payload.equipmentCode = equipment ? equipment.equipmentCode : '';
    payload.text = composeText(conclusion, causes, actions, risks, sources, treeId ? firstQuestion : '');
    if (confidence === 'LOW') {
      payload.text += '\n注：当前证据强度较低（置信度低），建议优先联系实训教师复核，不要直接拆检。';
    }
    return payload;
  }

  function handleQAChat(sid, session, slots, message) {
    var processMode = /怎么算|如何计算|计算公式|怎么选|如何选|选型|匹配|填充率|转速率|临界转速|斜度|燃烧器|产能|处理量|参数|沉降面积|底流浓度|底流|浓密|浓缩|絮凝|澄清|放大|设计|方案/.test(message) &&
      (slots.category === 'BAL' || slots.category === 'KIL' || slots.category === 'THK' || /浮选|磁选|旋流器|筛|皮带|输送|泵|除尘|换热|冷却塔|起重|天车|变频|料仓|阀门|仪表|浓密|球磨|回转窑|冶金|选矿|冶炼|浓缩|沉降|渣浆|清水/.test(message));
    var conceptMode = /是什么|什么是|有什么|差别|区别|功能|作用|原理|结构|组成|为什么|如何工作|磨损位置|常见磨损|对比/.test(message) &&
      (slots.category === 'BAL' || slots.category === 'KIL' || slots.category === 'THK' || /浮选|磁选|旋流器|筛|皮带|输送|泵|除尘|换热|冷却塔|起重|天车|变频|料仓|阀门|仪表|浓密|球磨|回转窑|冶金|选矿|冶炼|浓缩|沉降|渣浆|清水/.test(message));
    if ((processMode || conceptMode) && !slots.symptom) {
      slots.symptom = processMode ? '工艺参数计算与选型' : '设备原理与结构';
      slots.symptomSpecificity = 4;
    }
    if (isVague(slots) && !processMode && !conceptMode) {
      session.pendingIntent = 'QA';
      return clarifyPayload(sid, 'QA', slots, message);
    }
    session.pendingIntent = '';
    var query = message;
    if (slots.symptom && compact(message).indexOf(compact(slots.symptom)) === -1) {
      query = message + ' ' + slots.symptom;
    }
    var hits = retrieve(query, { category: slots.category, equipmentCode: slots.equipmentCode });
    if (!hits.length || (hits[0].score < QA_MIN_SCORE && (hits[0].vector || 0) < 0.30)) {
      return noHitPayload(sid, slots, message);
    }
    var payload = composeDiagnosis(sid, slots, hits);
    if (processMode) {
      var topTitle = payload.sources && payload.sources[0] ? payload.sources[0].title : '';
      payload.answerType = 'PROCESS';
      payload.conclusion = '工艺计算/选型：' + topTitle + '。以下为关键参数、计算公式与选型步骤。';
    } else if (conceptMode) {
      var conceptTitle = payload.sources && payload.sources[0] ? payload.sources[0].title : '';
      payload.answerType = 'CONCEPT';
      payload.conclusion = '知识要点：' + conceptTitle + '。以下为原理、结构与维护要点。';
    }
    return payload;
  }

  // ---------------------------------------------------------------------------
  // 排查引导
  // ---------------------------------------------------------------------------

  function selectTree(category, symptom) {
    var cat = text(category).toUpperCase();
    var low = compact(symptom);
    var bestId = '';
    var bestScore = 0;
    Object.keys(DATA.trees).forEach(function (treeId) {
      var tree = DATA.trees[treeId] || {};
      var score = 0;
      if (cat && text(tree.equipmentCategory).toUpperCase() === cat) { score += 10; }
      var name = compact(tree.name);
      if (cat) {
        (CATEGORY_ALIASES[cat] || []).forEach(function (alias) {
          if (name.indexOf(compact(alias)) !== -1) { score += 6; }
        });
      }
      if (low) {
        ['主轴', '异响', '刀库', '乱刀', '换刀', '报警', '堵头', '不出丝', '不出光', '激光', '3D', '打印'].forEach(function (keyword) {
          if (low.indexOf(compact(keyword)) !== -1 && name.indexOf(compact(keyword)) !== -1) { score += 2; }
        });
      }
      if (score > bestScore) { bestScore = score; bestId = treeId; }
    });
    return bestScore >= 4 ? bestId : '';
  }

  function startTreeSession(session, treeId) {
    var tree = DATA.trees[treeId];
    var rootId = tree ? text(tree.root) : '';
    session.tree = {
      treeId: treeId,
      nodeId: rootId,
      turns: 0,
      safetyAck: false,
      finished: false,
      path: rootId ? [rootId] : [],
      startedAt: nowIso()
    };
    return session.tree;
  }

  function treeNodePayload(sid, treeId, state, extra) {
    var tree = DATA.trees[treeId] || {};
    var nodes = tree.nodes || {};
    var node = nodes[state.nodeId] || {};
    var options = Array.isArray(node.options) ? node.options : [];
    var isLeaf = !!node.isLeaf || options.length === 0;
    var payload = {
      sessionId: sid,
      treeId: treeId,
      treeName: text(tree.name),
      nodeId: text(state.nodeId),
      state: text(node.state),
      question: text(node.question),
      options: isLeaf ? [] : options.map(function (option) {
        return { answer: text(option.answer), next: text(option.next) };
      }),
      criterion: text(node.criterion),
      action: text(node.action),
      isLeaf: isLeaf,
      conclusion: text(node.conclusion),
      actions: Array.isArray(node.actions) ? node.actions.slice() : [],
      safetyAck: {
        stop: !!state.safetyAck,
        loto: !!state.safetyAck,
        source: state.safetyAck ? 'session' : 'pending'
      },
      turn: Number(state.turns) || 0,
      maxTurns: MAX_TREE_TURNS,
      matched: true,
      finished: !!state.finished
    };
    if (extra && typeof extra === 'object') {
      Object.keys(extra).forEach(function (key) { payload[key] = extra[key]; });
    }
    return payload;
  }

  function treeErrorPayload(sid, treeId, message, escalate) {
    return {
      sessionId: sid,
      treeId: treeId || '',
      treeName: '',
      nodeId: '',
      state: '',
      question: '',
      options: [],
      criterion: '',
      action: '',
      isLeaf: true,
      conclusion: message,
      actions: escalate ? ['转实训教师或维修人员现场处理'] : [],
      safetyAck: { stop: false, loto: false, source: 'pending' },
      turn: 0,
      maxTurns: MAX_TREE_TURNS,
      matched: false,
      finished: true,
      error: 'TREE_UNAVAILABLE',
      escalate: !!escalate
    };
  }

  function treeLimitPayload(sid, treeId, state) {
    var payload = treeNodePayload(sid, treeId, state, { matched: false, finished: true, escalate: true });
    payload.isLeaf = true;
    payload.options = [];
    payload.question = '';
    payload.conclusion = '已达 ' + MAX_TREE_TURNS + ' 轮排查上限，建议转实训教师或维修人员处理。';
    payload.actions = ['整理已完成的排查步骤与测量结果', '转实训教师或维修人员现场处理'];
    return payload;
  }

  function canonicalAnswer(value) {
    var normalized = optionNorm(value);
    if (!normalized) { return ''; }
    if (/^(不确定|不知道|不清楚|说不准|也许|可能|maybe|unknown)/.test(normalized)) { return 'UNSURE'; }
    if (/^(否|不是|不对|没有|无|不会|未|没|no|n|0|false|无法|不能|不行)/.test(normalized)) { return 'NO'; }
    if (/^(是|是的|对|对的|有|会|确认|已确认|已完成|完成|好了|可以|能|ok|yes|y|1|true|已)/.test(normalized)) { return 'YES'; }
    return '';
  }

  function matchTreeOption(reply, options) {
    var normalized = optionNorm(reply);
    if (!normalized) { return null; }
    var exact = null;
    options.forEach(function (option) {
      if (!exact && optionNorm(option.answer) === normalized) { exact = option; }
    });
    if (exact) { return exact; }

    var contains = [];
    options.forEach(function (option) {
      var answer = optionNorm(option.answer);
      if (!answer) { return; }
      var hit = false;
      if (normalized.length >= 2 && answer.indexOf(normalized) !== -1) { hit = true; }
      else if (answer.length >= 2 && normalized.indexOf(answer) !== -1) { hit = true; }
      else if (normalized.length === 1 && answer.length > 2 && answer.charAt(0) === normalized) { hit = true; }
      if (hit) { contains.push(option); }
    });
    if (contains.length === 1) { return contains[0]; }
    if (contains.length > 1) {
      var first = contains[0];
      var sameNext = contains.every(function (option) { return text(option.next) === text(first.next); });
      if (sameNext) { return first; }
      return { ambiguous: true, options: contains };
    }

    var canonical = canonicalAnswer(reply);
    if (canonical) {
      var candidates = options.filter(function (option) { return canonicalAnswer(option.answer) === canonical; });
      if (candidates.length === 1) { return candidates[0]; }
      if (candidates.length > 1) {
        var same = candidates.every(function (option) { return text(option.next) === text(candidates[0].next); });
        if (same) { return candidates[0]; }
        return { ambiguous: true, options: candidates };
      }
    }
    return null;
  }

  function handleTroubleshootChat(sid, session, slots, message) {
    var treeId = selectTree(slots.category, slots.symptom || message);
    var payload;
    if (!treeId) {
      payload = basePayload(sid, 'TRG');
      payload.conclusion = '未找到与当前设备/现象匹配的排查树，无法进入逐步引导。';
      payload.confidence = 'LOW';
      payload.escalate = true;
      payload.clarify = '请补充设备类别与具体现象（如：车床主轴异响 / 加工中心刀库乱刀 / 激光不出光），或直接联系实训教师。';
      payload.text = [
        '结论：未找到匹配的排查树，无法进入逐步引导。',
        '需要补充：设备类别 + 具体现象（例如：数控车床主轴异响、加工中心刀库乱刀、激光切割机不出光）。',
        '下一步：补充现象后可重新进入引导；也可先在问答页获取原因排序。',
        '风险提示：涉及停机、断电、挂牌上锁的安全确认未完成前，不得拆检。',
        '来源：排查树库（未命中）。'
      ].join('\n');
      return payload;
    }
    var tree = DATA.trees[treeId];
    var rootNode = tree && tree.nodes ? tree.nodes[text(tree.root)] : null;
    if (!rootNode) {
      payload = basePayload(sid, 'TRG');
      payload.conclusion = '排查树数据异常（缺少根节点），已转人工。';
      payload.escalate = true;
      payload.answerType = 'REFUSAL';
      payload.text = '结论：排查树数据异常，已转人工。\n下一步：联系实训教师。';
      return payload;
    }
    var state = startTreeSession(session, treeId);
    session.pendingIntent = '';
    var node = treeNodePayload(sid, treeId, state);
    payload = basePayload(sid, 'TRG');
    payload.answerType = 'TROUBLESHOOT';
    payload.conclusion = '已进入排查引导：' + text(tree.name) + '。';
    payload.confidence = 'HIGH';
    payload.nextStep = { enterTroubleshooting: true, firstQuestion: text(node.question), treeId: treeId };
    payload.tree = node;
    payload.actions = node.options.map(function (option) {
      return { action: '回答：' + option.answer, criterion: '按现场实际选择', riskLevel: 'LOW' };
    });
    payload.text = [
      '结论：已进入排查引导「' + text(tree.name) + '」。',
      '当前问题：' + text(node.question),
      '可选回答：' + node.options.map(function (option) { return option.answer; }).join('、'),
      '下一步：每轮只回答一个问题，系统按决策树推进；轮次上限 ' + MAX_TREE_TURNS + '。',
      '风险提示：安全确认未完成前不得进入测量或拆检节点。',
      '来源：排查树 ' + treeId + '。'
    ].join('\n');
    return payload;
  }

  function handleTroubleshootAnswer(sid, session, reply, treeIdHint) {
    var state = session.tree;
    if (!state || !state.treeId) {
      var autoTreeId = selectTree(session.category, session.symptom, treeIdHint) || text(treeIdHint);
      if (autoTreeId && DATA.trees[autoTreeId]) {
        state = startTreeSession(session, autoTreeId);
      } else {
        return treeErrorPayload(sid, '', '当前会话尚未开始排查，请先在问答中描述故障并点击「进入排查引导」。', false);
      }
    }
    var treeId = state.treeId;
    var tree = DATA.trees[treeId];
    if (!tree || !tree.nodes) {
      return treeErrorPayload(sid, treeId, '排查树数据已变更，请重新开始排查。', true);
    }
    var nodes = tree.nodes;
    var current = nodes[state.nodeId];
    if (!current) {
      return treeErrorPayload(sid, treeId, '当前排查节点缺失，请重新开始排查。', true);
    }
    if (!reply) {
      return treeNodePayload(sid, treeId, state, { matched: false, message: '请回复选项之一，例如「是」「否」或「不确定」。' });
    }
    if (state.finished) {
      return treeNodePayload(sid, treeId, state, { matched: false, message: '本轮排查已结束；如需重新排查，请退出引导后重新开始。' });
    }
    if ((Number(state.turns) || 0) >= MAX_TREE_TURNS) {
      return treeLimitPayload(sid, treeId, state);
    }
    state.turns = (Number(state.turns) || 0) + 1;
    var options = Array.isArray(current.options) ? current.options : [];
    var match = matchTreeOption(reply, options);
    if (!match || match.ambiguous) {
      var message = '未识别您的回复，请从下方选项中选择一项。';
      if (match && match.ambiguous) {
        message = '该问题有多个分支，请从下列选项中选择：' + match.options.map(function (option) { return option.answer; }).join('；');
      }
      return treeNodePayload(sid, treeId, state, { matched: false, message: message });
    }
    var nextNode = nodes[text(match.next)];
    if (!nextNode) {
      state.finished = true;
      return treeErrorPayload(sid, treeId, '排查路径指向的节点不存在，已转人工处理。', true);
    }
    var safetyNode = (text(current.state) === 'S1') || /安全/.test(text(current.criterion) + text(current.action) + text(current.question));
    if (safetyNode) {
      state.safetyAck = canonicalAnswer(reply) === 'YES';
      var nextIsSafety = text(nextNode.state) === 'S1';
      var nextIsLeaf = !!nextNode.isLeaf || !(Array.isArray(nextNode.options) && nextNode.options.length);
      if (!state.safetyAck && !nextIsSafety && !nextIsLeaf) {
        return treeNodePayload(sid, treeId, state, {
          matched: false,
          blockedBySafety: true,
          message: '尚未确认停机、断电、挂牌上锁，不能继续排查。请完成安全确认后回复「已确认」。'
        });
      }
    }
    var previousNodeId = state.nodeId;
    state.nodeId = text(match.next);
    state.path = Array.isArray(state.path) ? state.path : [];
    state.path.push(state.nodeId);
    var isLeaf = !!nextNode.isLeaf || !(Array.isArray(nextNode.options) && nextNode.options.length);
    if (isLeaf) { state.finished = true; }
    var payload = treeNodePayload(sid, treeId, state, {
      matchedAnswer: text(match.answer),
      previousNodeId: previousNodeId
    });
    if (safetyNode) { payload.safetyConfirmed = !!state.safetyAck; }
    return payload;
  }

  // ==== PART3 ====

  // ---------------------------------------------------------------------------
  // 会话
  // ---------------------------------------------------------------------------

  function makeSessionId() {
    return 'SESS-OFFLINE-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();
  }

  function getSession(sid) {
    var key = SESSION_PREFIX + sid;
    var session = readJSON(SS, key, null);
    if (!session || typeof session !== 'object') {
      session = {
        sessionId: sid,
        role: 'student',
        equipmentCode: '',
        category: '',
        symptom: '',
        frequency: '',
        lastIntent: '',
        pendingIntent: '',
        tree: null,
        history: [],
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
    }
    if (!Array.isArray(session.history)) { session.history = []; }
    return session;
  }

  function pruneSessions() {
    try {
      var keys = [];
      for (var i = 0; i < SS.length; i++) {
        var key = SS.key(i);
        if (key && key.indexOf(SESSION_PREFIX) === 0) { keys.push(key); }
      }
      if (keys.length <= 24) { return; }
      keys.slice(0, keys.length - 24).forEach(function (item) { SS.removeItem(item); });
    } catch (e) { /* 忽略 */ }
  }

  function saveSession(session) {
    session.updatedAt = nowIso();
    if (session.history.length > 16) { session.history = session.history.slice(-16); }
    writeJSON(SS, SESSION_PREFIX + session.sessionId, session);
    pruneSessions();
  }

  // ---------------------------------------------------------------------------
  // 危险与意图
  // ---------------------------------------------------------------------------

  function stripSafePhrases(value) {
    var result = text(value);
    for (var i = 0; i < DANGER_SAFE_PHRASES.length; i++) {
      var phrase = DANGER_SAFE_PHRASES[i];
      var index = result.indexOf(phrase);
      while (index !== -1) {
        result = result.slice(0, index) + result.slice(index + phrase.length);
        index = result.indexOf(phrase);
      }
    }
    return result;
  }

  function dangerRule(message) {
    var low = compact(stripSafePhrases(message));
    if (!low) { return null; }
    for (var r = 0; r < DANGER_RULES.length; r++) {
      var rule = DANGER_RULES[r];
      for (var p = 0; p < rule.patterns.length; p++) {
        if (rule.patterns[p].test(low)) { return rule; }
      }
    }
    return null;
  }

  function detectIntent(message, slots) {
    var low = compact(message);
    if (!low) { return 'UNKNOWN'; }
    if (dangerRule(message)) { return 'DANGER'; }
    if (/点检|检查表|点检表|点检清单|巡检表|日检|周检|月检/.test(low)) { return 'CHK'; }
    if (/报修|工单|派单|维修单|报障|申请维修|创建工单|结案|回填/.test(low)) { return 'WO'; }
    if (/排查|一步步|逐步|引导|故障树|排查树|带我|怎么查|如何查/.test(low)) { return 'TRG'; }
    var hasSlots = !!(slots.equipment || slots.equipmentCode || slots.category || slots.symptom);
    if (!hasSlots && /^(你好|您好|hi|hello|嗨|在吗|谢谢|多谢|辛苦了|你是谁|你能做什么|怎么用|使用说明|帮助|菜单)/.test(low)) { return 'CHAT'; }
    if (/天气|股票|写诗|讲个笑话|翻译|编程|写代码|数学题|电影|新闻/.test(low)) { return 'UNKNOWN'; }
    if (hasSlots) { return 'QA'; }
    if (/怎么|如何|为什么|什么|能否|可以|多少|哪|[?？]/.test(text(message))) { return 'QA'; }
    return 'UNKNOWN';
  }

  // ---------------------------------------------------------------------------
  // 聊天入口
  // ---------------------------------------------------------------------------

  function handleChat(body) {
    body = isObject(body) ? body : {};
    var message = text(body.message).trim();
    var sid = text(body.sessionId) || makeSessionId();
    var session = getSession(sid);
    session.role = text(body.role) || session.role || 'student';
    if (!message) {
      session.pendingIntent = 'QA';
      saveSession(session);
      return clarifyPayload(sid, 'QA', { equipment: null, equipmentCode: '', category: '', symptom: '', symptomSpecificity: 0 }, '');
    }
    session.history.push({ role: 'user', content: truncate(message, 300), at: nowIso() });

    var danger = dangerRule(message);
    var payload;
    if (danger) {
      session.lastIntent = 'DANGER';
      session.pendingIntent = '';
      payload = dangerPayload(sid, danger, message);
    } else {
      var rawSlots = extractSlots(message, text(body.equipmentCode));
      var rawIntent = detectIntent(message, rawSlots);
      var slots = mergeSlots(session, rawSlots, text(body.equipmentCode));
      var intent = rawIntent;
      if (session.pendingIntent && (rawIntent === 'QA' || rawIntent === 'UNKNOWN')) { intent = session.pendingIntent; }
      if (intent === 'CHAT') {
        session.pendingIntent = '';
        payload = chatPayload(sid);
      } else if (intent === 'CHK') {
        payload = handleChecklistChat(sid, session, slots, message);
      } else if (intent === 'WO') {
        payload = handleWorkorderChat(sid, session, slots, message);
      } else if (intent === 'TRG') {
        payload = handleTroubleshootChat(sid, session, slots, message);
      } else if (intent === 'QA') {
        payload = handleQAChat(sid, session, slots, message);
      } else {
        session.pendingIntent = '';
        payload = unknownPayload(sid);
      }
      session.lastIntent = payload.intent || intent;
    }
    session.history.push({ role: 'assistant', content: truncate(payload.conclusion || payload.text, 240), at: nowIso() });
    saveSession(session);
    payload.sessionId = sid;
    return payload;
  }

  // ---------------------------------------------------------------------------
  // 点检
  // ---------------------------------------------------------------------------

  function inferSeverity(template) {
    var haystack = [template.name, template.criterion, template.judgment, template.abnormalAction, template.safetyTip].join(' ');
    if (/冒烟|起火|漏电|触电|联锁|超温|超压|急停|安全装置|防护|绝缘|过热|温升|振动|异响/.test(haystack)) { return 'HIGH'; }
    return 'MEDIUM';
  }

  function generateChecklistData(payload) {
    payload = isObject(payload) ? payload : {};
    var equipmentCode = text(payload.equipmentCode);
    if (!equipmentCode) { throw apiError(400, 'MISSING_EQUIPMENT_CODE', '缺少设备编码 equipmentCode。'); }
    var equipment = findEquipment(equipmentCode);
    if (!equipment) { throw apiError(404, 'EQUIPMENT_NOT_FOUND', '未找到设备 ' + equipmentCode + '。'); }
    var requestedFrequency = text(payload.frequency || 'D').toUpperCase();
    if (['D', 'W', 'M'].indexOf(requestedFrequency) === -1) { throw apiError(400, 'INVALID_FREQUENCY', 'frequency 只支持 D/W/M。'); }
    var templates = DATA.checklists[equipment.category] || {};
    var sourceItems = templates[requestedFrequency];
    var actualFrequency = requestedFrequency;
    var fallback = false;
    if ((!sourceItems || !sourceItems.length) && requestedFrequency !== 'D') {
      sourceItems = templates.D || [];
      actualFrequency = 'D';
      fallback = sourceItems.length > 0;
    }
    if (!sourceItems || !sourceItems.length) {
      throw apiError(404, 'CHECKLIST_TEMPLATE_NOT_FOUND', '未找到 ' + equipment.category + '/' + requestedFrequency + ' 的点检模板。');
    }
    var prefix = equipment.category + '-' + actualFrequency + '-' + dateCompact(new Date());
    var checklistId = 'CL-' + prefix + '-' + pad(nextSeq(prefix), 3);
    var items = sourceItems.map(function (item, index) {
      var copy = clone(item);
      copy.index = index + 1;
      copy.required = true;
      copy.frequency = actualFrequency;
      return copy;
    });
    return {
      checklistId: checklistId,
      equipmentCode: equipment.equipmentCode,
      equipmentName: equipment.name,
      equipment: clone(equipment),
      category: equipment.category,
      categoryName: categoryName(equipment.category),
      location: text(equipment.location),
      frequency: actualFrequency,
      frequencyName: frequencyName(actualFrequency),
      requestedFrequency: requestedFrequency,
      frequencyFallback: fallback,
      generatedAt: nowIso(),
      operator: text(payload.operator),
      items: items,
      totalCount: items.length
    };
  }

  function submitChecklistData(payload) {
    payload = isObject(payload) ? payload : {};
    var checklist = isObject(payload.checklist) ? payload.checklist : null;
    var rawItems = Array.isArray(payload.items) ? payload.items : null;
    if (!checklist) { throw apiError(400, 'MISSING_CHECKLIST', '缺少 checklist 对象。'); }
    if (!rawItems) { throw apiError(400, 'MISSING_ITEMS', '缺少 items 数组。'); }
    if (!rawItems.length) { throw apiError(400, 'EMPTY_ITEMS', '点检项不能为空。'); }
    var checklistId = text(checklist.checklistId);
    var equipmentCode = text(checklist.equipmentCode);
    if (!checklistId) { throw apiError(400, 'MISSING_CHECKLIST_ID', '清单缺少 checklistId。'); }
    if (!equipmentCode) { throw apiError(400, 'MISSING_EQUIPMENT_CODE', '清单缺少 equipmentCode。'); }
    var equipment = findEquipment(equipmentCode);
    var equipmentName = text(checklist.equipmentName) || (equipment ? equipment.name : equipmentCode);
    var category = text(checklist.category) || (equipment ? equipment.category : '');
    var templates = Array.isArray(checklist.items) ? checklist.items : [];
    var templateMap = {};
    templates.forEach(function (template) {
      if (template && template.code) { templateMap[text(template.code)] = template; }
    });
    var seen = {};
    var normalized = [];
    rawItems.forEach(function (item) {
      var code = text(item && item.code);
      if (!code) { throw apiError(400, 'INVALID_ITEM_CODE', '点检项缺少 code。'); }
      if (seen[code]) { throw apiError(400, 'DUPLICATE_ITEM', '点检项 ' + code + ' 重复提交。'); }
      seen[code] = true;
      var result = text(item.result).toUpperCase();
      if (RESULT_VALUES.indexOf(result) === -1) { throw apiError(400, 'INVALID_RESULT', '点检项 ' + code + ' 的 result 只支持 OK/ABNORMAL/NA。'); }
      var note = text(item.note);
      if (result === 'ABNORMAL' && !note) { throw apiError(400, 'NOTE_REQUIRED', '异常项 ' + code + ' 必须填写备注。'); }
      var severity = text(item.severity).toUpperCase();
      if (SEVERITIES.indexOf(severity) === -1) {
        severity = templateMap[code] ? inferSeverity(templateMap[code]) : 'MEDIUM';
      }
      normalized.push({ code: code, result: result, note: note, severity: severity });
    });
    var missing = templates.filter(function (template) {
      return template && template.code && !seen[text(template.code)];
    });
    var abnormal = normalized.filter(function (item) { return item.result === 'ABNORMAL'; });
    var checkedAt = nowIso();
    var dayCompact = dateCompact(new Date());
    var submissionId = 'SUB-' + dayCompact + '-' + pad(nextSeq('SUB-' + dayCompact), 3);
    var anomalies = [];
    abnormal.forEach(function (item) {
      var template = templateMap[item.code] || {};
      var anomalyId = 'AN-' + dayCompact + '-' + pad(nextSeq('AN-' + dayCompact), 3);
      anomalies.push({
        anomalyId: anomalyId,
        submissionId: submissionId,
        checklistId: checklistId,
        equipmentCode: equipmentCode,
        equipmentName: equipmentName,
        category: category,
        categoryName: categoryName(category),
        code: item.code,
        name: text(template.name) || item.code,
        location: text(template.location),
        severity: item.severity,
        note: item.note || text(template.abnormalAction) || '点检判定异常',
        abnormalAction: text(template.abnormalAction),
        status: 'OPEN',
        createdAt: checkedAt
      });
    });
    var summary = {
      total: normalized.length,
      ok: normalized.filter(function (item) { return item.result === 'OK'; }).length,
      abnormal: abnormal.length,
      na: normalized.filter(function (item) { return item.result === 'NA'; }).length,
      missing: missing.length
    };
    var submission = {
      submissionId: submissionId,
      checklistId: checklistId,
      equipmentCode: equipmentCode,
      equipmentName: equipmentName,
      category: category,
      categoryName: categoryName(category),
      frequency: text(checklist.frequency) || 'D',
      items: normalized,
      note: text(payload.note),
      operator: text(payload.operator) || text(checklist.operator) || '实训学生',
      checkedAt: checkedAt,
      summary: summary
    };
    var submissions = readList(STORE_KEYS.submissions);
    submissions.unshift(submission);
    writeList(STORE_KEYS.submissions, submissions);
    if (anomalies.length) {
      var allAnomalies = readList(STORE_KEYS.anomalies);
      anomalies.forEach(function (anomaly) { allAnomalies.unshift(anomaly); });
      writeList(STORE_KEYS.anomalies, allAnomalies);
    }
    return clone({
      submissionId: submissionId,
      checklistId: checklistId,
      equipmentCode: equipmentCode,
      equipmentName: equipmentName,
      checkedAt: checkedAt,
      anomalies: anomalies,
      summary: summary
    });
  }

  function handleChecklistChat(sid, session, slots, message) {
    var equipment = slots.equipment;
    if (!equipment && slots.category) { equipment = equipmentForCategory(slots.category, slots.symptom); }
    if (!equipment) {
      session.pendingIntent = 'CHK';
      return clarifyPayload(sid, 'CHK', slots, message);
    }
    var frequency = slots.frequency || session.frequency || 'D';
    session.frequency = frequency;
    var checklist;
    try {
      checklist = generateChecklistData({ equipmentCode: equipment.equipmentCode, frequency: frequency });
    } catch (error) {
      var failPayload = basePayload(sid, 'CHK');
      failPayload.conclusion = '点检清单生成失败：' + error.message;
      failPayload.text = '结论：点检清单生成失败：' + error.message + '\n下一步：到「点检填报」页选择设备与频次重试。';
      return failPayload;
    }
    session.pendingIntent = '';
    var related = retrieve(categoryName(equipment.category) + ' ' + checklist.items.slice(0, 6).map(function (item) { return item.name; }).join(' '), { category: equipment.category });
    var sources = [];
    related.forEach(function (hit) { if (sources.length < 2 && hit.score >= 3) { sources.push({ id: hit.entry.id, title: hit.entry.title }); } });
    var payload = basePayload(sid, 'CHK');
    payload.answerType = 'CHECKLIST';
    payload.conclusion = '已生成 ' + equipment.name + ' 的' + frequencyName(checklist.frequency) + '清单，共 ' + checklist.totalCount + ' 项（' + checklist.checklistId + '）。';
    payload.confidence = 'HIGH';
    payload.checklist = checklist;
    payload.equipmentCode = equipment.equipmentCode;
    payload.citations = sources.map(function (source) { return source.id; });
    payload.sources = sources;
    payload.actions = [
      { action: '打开「点检填报」页，按清单逐项记录结果', criterion: '每项选择 OK / 异常 / 不适用；异常项必须填写备注', riskLevel: 'MEDIUM' },
      { action: '提交后查看异常汇总与看板', criterion: '异常项自动生成异常记录并进入看板', riskLevel: 'LOW' }
    ];
    var textLines = [
      '结论：已生成 ' + equipment.name + ' 的' + frequencyName(checklist.frequency) + '清单，共 ' + checklist.totalCount + ' 项。',
      '清单编号：' + checklist.checklistId,
      '主要项目：' + checklist.items.slice(0, 8).map(function (item) { return item.code + ' ' + item.name; }).join('；'),
      '下一步：到「点检填报」页逐项记录并提交；异常项会自动进入看板。',
      '风险提示：涉及旋转、带电、高温部位须按安全提示执行。',
      sources.length ? '来源：' + sources.map(function (source) { return '[' + source.id + '] ' + source.title; }).join('；') : '来源：点检模板库。'
    ];
    if (checklist.frequencyFallback) { textLines.splice(2, 0, '说明：该设备暂无' + frequencyName(checklist.requestedFrequency) + '模板，已按日检模板生成。'); }
    payload.text = textLines.join('\n');
    return payload;
  }

  // ---------------------------------------------------------------------------
  // 看板
  // ---------------------------------------------------------------------------

  function parseDate(value) {
    if (!value) { return null; }
    var str = text(value).trim();
    if (!str) { return null; }
    var date = new Date(str);
    if (!isNaN(date.getTime())) { return date; }
    var match = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (match) { return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0)); }
    return null;
  }

  function inWindow(value, cutoff, now) {
    var date = parseDate(value);
    if (!date) { return true; }
    if (date.getTime() > now.getTime() + 300000) { return false; }
    return date.getTime() >= cutoff.getTime();
  }

  function dashboardData(daysValue) {
    var days = parseInt(text(daysValue), 10);
    if (!days || days < 1) { days = 30; }
    if (days > 3650) { days = 3650; }
    var now = new Date();
    var cutoff = new Date(now.getTime() - days * 24 * 3600 * 1000);
    var submissions = readList(STORE_KEYS.submissions).filter(function (item) { return inWindow(item.checkedAt, cutoff, now); });
    var anomalies = readList(STORE_KEYS.anomalies).filter(function (item) { return inWindow(item.createdAt, cutoff, now); });
    var workorders = readList(STORE_KEYS.workorders);
    var openWorkOrders = workorders.filter(function (item) { return text(item.status) !== 'CLOSED'; }).length;
    var workorderByAnomaly = {};
    workorders.forEach(function (item) { if (item.anomalyId) { workorderByAnomaly[text(item.anomalyId)] = item; } });

    var byCategoryMap = {};
    anomalies.forEach(function (item) {
      var category = text(item.category) || 'UNKNOWN';
      if (!byCategoryMap[category]) { byCategoryMap[category] = { category: category, categoryName: categoryName(category), name: categoryName(category), count: 0 }; }
      byCategoryMap[category].count += 1;
    });
    var byCategory = Object.keys(byCategoryMap).map(function (key) { return byCategoryMap[key]; }).sort(function (a, b) { return b.count - a.count; });

    var topEquipmentMap = {};
    anomalies.forEach(function (item) {
      var code = text(item.equipmentCode) || 'UNKNOWN';
      if (!topEquipmentMap[code]) {
        topEquipmentMap[code] = {
          equipmentCode: code,
          name: text(item.equipmentName) || code,
          category: text(item.category),
          categoryName: categoryName(text(item.category)),
          count: 0
        };
      }
      topEquipmentMap[code].count += 1;
    });
    var topEquipment = Object.keys(topEquipmentMap).map(function (key) { return topEquipmentMap[key]; })
      .sort(function (a, b) { return b.count - a.count; }).slice(0, 5);

    var sortedAnomalies = anomalies.slice().sort(function (a, b) {
      var da = parseDate(a.createdAt);
      var db = parseDate(b.createdAt);
      return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
    });
    var recentAnomalies = sortedAnomalies.slice(0, 10).map(function (item) {
      var copy = clone(item);
      var workorder = workorderByAnomaly[text(item.anomalyId)];
      if (workorder) {
        copy.workorderId = text(workorder.workorderId);
        copy.workorderNo = text(workorder.workorderNo);
      }
      return copy;
    });

    var trendMap = {};
    anomalies.forEach(function (item) {
      var date = parseDate(item.createdAt);
      var key = date ? dateKey(date) : dateKey(now);
      trendMap[key] = (trendMap[key] || 0) + 1;
    });
    var trend = [];
    for (var offset = 6; offset >= 0; offset--) {
      var day = new Date(now.getTime() - offset * 24 * 3600 * 1000);
      var key = dateKey(day);
      trend.push({ date: key, count: trendMap[key] || 0 });
    }
    return {
      summary: {
        submissions: submissions.length,
        anomalies: anomalies.length,
        highRisk: anomalies.filter(function (item) { return text(item.severity) === 'HIGH'; }).length,
        openWorkOrders: openWorkOrders
      },
      byCategory: byCategory,
      topEquipment: topEquipment,
      recentAnomalies: recentAnomalies,
      trend: trend
    };
  }

  // ---------------------------------------------------------------------------
  // 工单
  // ---------------------------------------------------------------------------

  function decorateWorkorder(workorder) {
    var copy = clone(workorder);
    var next = WORKORDER_NEXT[text(copy.status)];
    copy.nextStatus = (text(copy.status) !== 'CLOSED' && next && next !== 'CLOSED') ? next : '';
    return copy;
  }

  function createWorkorderData(anomalyId, note, operator) {
    var targetId = text(anomalyId).toUpperCase();
    if (!targetId) { throw apiError(400, 'MISSING_ANOMALY_ID', '缺少 anomalyId。'); }
    var anomalies = readList(STORE_KEYS.anomalies);
    var index = -1;
    for (var i = 0; i < anomalies.length; i++) {
      if (text(anomalies[i].anomalyId).toUpperCase() === targetId) { index = i; break; }
    }
    if (index === -1) { throw apiError(404, 'ANOMALY_NOT_FOUND', '未找到异常记录 ' + targetId + '。'); }
    var anomaly = anomalies[index];
    var workorders = readList(STORE_KEYS.workorders);
    if (anomaly.workorderId) {
      for (var w = 0; w < workorders.length; w++) {
        if (text(workorders[w].workorderId) === text(anomaly.workorderId)) { return decorateWorkorder(workorders[w]); }
      }
    }
    var day = dateCompact(new Date());
    var workorderId = 'WO-' + day + '-' + pad(nextSeq('WO-' + day), 3);
    var now = nowIso();
    var workorder = {
      workorderId: workorderId,
      workorderNo: workorderId,
      anomalyId: text(anomaly.anomalyId),
      equipmentCode: text(anomaly.equipmentCode),
      equipmentName: text(anomaly.equipmentName),
      category: text(anomaly.category),
      categoryName: text(anomaly.categoryName) || categoryName(text(anomaly.category)),
      severity: normalizeSeverity(anomaly.severity),
      title: (text(anomaly.equipmentName) || text(anomaly.equipmentCode) || '设备') + ' ' + (text(anomaly.name) || '点检异常') + '（' + text(anomaly.severity || 'MEDIUM') + '）',
      description: text(note) || text(anomaly.note),
      status: 'DRAFT',
      note: text(note),
      operator: text(operator),
      repairReport: null,
      candidateWritten: false,
      statusHistory: [{ status: 'DRAFT', at: now, operator: text(operator) }],
      createdAt: now,
      updatedAt: now
    };
    workorders.unshift(workorder);
    writeList(STORE_KEYS.workorders, workorders);
    anomalies[index].workorderId = workorderId;
    anomalies[index].workorderNo = workorderId;
    anomalies[index].status = 'OPEN';
    writeList(STORE_KEYS.anomalies, anomalies);
    return decorateWorkorder(workorder);
  }

  function listWorkordersData(statusValue) {
    var status = text(statusValue).toUpperCase();
    var list = readList(STORE_KEYS.workorders).map(decorateWorkorder);
    if (status && STATUS_FLOW.indexOf(status) !== -1) {
      list = list.filter(function (item) { return text(item.status) === status; });
    }
    list.sort(function (a, b) {
      var da = parseDate(a.createdAt);
      var db = parseDate(b.createdAt);
      var diff = (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
      if (diff !== 0) { return diff; }
      return text(b.workorderId).localeCompare(text(a.workorderId));
    });
    return list;
  }

  function updateWorkorderData(workorderId, payload) {
    payload = isObject(payload) ? payload : {};
    var targetId = text(workorderId).toUpperCase();
    if (!targetId) { throw apiError(400, 'MISSING_WORKORDER_ID', '缺少工单号。'); }
    var targetStatus = text(payload.status).toUpperCase();
    if (!targetStatus) { throw apiError(400, 'MISSING_STATUS', '缺少目标状态 status。'); }
    if (STATUS_FLOW.indexOf(targetStatus) === -1) {
      throw apiError(400, 'INVALID_STATUS', '无效工单状态 ' + targetStatus + '；允许值：' + STATUS_FLOW.join(', ') + '。');
    }
    var report = payload.repairReport;
    if (report !== undefined && report !== null && !isObject(report)) {
      throw apiError(400, 'INVALID_REPAIR_REPORT', 'repairReport 必须是对象。');
    }
    var workorders = readList(STORE_KEYS.workorders);
    var index = -1;
    for (var i = 0; i < workorders.length; i++) {
      if (text(workorders[i].workorderId).toUpperCase() === targetId || text(workorders[i].workorderNo).toUpperCase() === targetId) { index = i; break; }
    }
    if (index === -1) { throw apiError(404, 'WORKORDER_NOT_FOUND', '未找到工单 ' + workorderId + '。'); }
    var workorder = workorders[index];
    var currentStatus = text(workorder.status).toUpperCase();
    if (targetStatus !== currentStatus) {
      var allowedNext = WORKORDER_NEXT[currentStatus];
      if (targetStatus !== allowedNext) {
        throw apiError(400, 'INVALID_STATUS_TRANSITION',
          '工单状态不能从 ' + currentStatus + ' 直接流转到 ' + targetStatus + '；下一步可选：' + (allowedNext || '无（已结案）') + '。');
      }
    }
    var now = nowIso();
    workorder.status = targetStatus;
    workorder.updatedAt = now;
    workorder.lastOperator = text(payload.operator);
    if (report !== undefined && report !== null) { workorder.repairReport = clone(report); }
    if (targetStatus === 'CLOSED') {
      workorder.closedAt = now;
      workorder.closedBy = text(payload.operator);
    } else {
      delete workorder.closedAt;
    }
    if (!Array.isArray(workorder.statusHistory)) { workorder.statusHistory = []; }
    workorder.statusHistory.push({ status: targetStatus, at: now, operator: text(payload.operator) });
    if (targetStatus === 'CLOSED' && currentStatus !== 'CLOSED' && isObject(report) && Object.keys(report).length) {
      var day = dateCompact(new Date());
      var candidateId = 'KC-' + day + '-' + pad(nextSeq('KC-' + day), 3);
      var actions = [];
      if (Array.isArray(report.actions)) {
        report.actions.forEach(function (action) {
          var actionText = text(action && action.action ? action.action : action);
          if (actionText) { actions.push(actionText); }
        });
      } else if (text(report.actions)) {
        actions.push(text(report.actions));
      }
      var candidate = {
        candidateId: candidateId,
        title: text(report.title) || ((text(workorder.title) || text(workorder.equipmentName) || '维修') + ' 维修经验'),
        rootCause: text(report.rootCause || report.cause),
        actions: actions,
        parts: text(report.parts),
        downTime: text(report.downTime),
        acceptor: text(report.acceptor),
        residualRisk: text(report.residualRisk),
        sourceWorkOrder: text(workorder.workorderNo || workorder.workorderId),
        equipmentCode: text(workorder.equipmentCode),
        equipmentName: text(workorder.equipmentName),
        category: text(workorder.category),
        severity: text(workorder.severity),
        anomalyId: text(workorder.anomalyId),
        reviewStatus: 'PENDING_REVIEW',
        createdAt: now
      };
      var candidates = readList(STORE_KEYS.candidates);
      candidates.unshift(candidate);
      writeList(STORE_KEYS.candidates, candidates);
      workorder.knowledgeCandidateId = candidateId;
      workorder.candidateWritten = true;
    }
    workorders[index] = workorder;
    writeList(STORE_KEYS.workorders, workorders);
    if (targetStatus === 'CLOSED') {
      var anomalies = readList(STORE_KEYS.anomalies);
      anomalies.forEach(function (anomaly) {
        if (text(anomaly.anomalyId) === text(workorder.anomalyId)) { anomaly.status = 'CLOSED'; anomaly.closedAt = now; }
      });
      writeList(STORE_KEYS.anomalies, anomalies);
    }
    return decorateWorkorder(workorder);
  }

  function handleWorkorderChat(sid, session, slots, message) {
    var payload = basePayload(sid, 'WO');
    if (slots.anomalyId) {
      try {
        var workorder = createWorkorderData(slots.anomalyId, message, session.role || 'teacher');
        payload.answerType = 'WORKORDER';
        payload.conclusion = '已创建工单 ' + workorder.workorderNo + '（状态 ' + workorder.status + '，等级 ' + workorder.severity + '）。';
        payload.confidence = 'HIGH';
        payload.workorder = workorder;
        payload.actions = [
          { action: '在「工单管理」页推进状态：待确认→派单→受理→维修中→待验收', criterion: '每一步都有状态记录与操作人', riskLevel: 'LOW' },
          { action: '维修完成后在结案弹窗填写根因、处置、备件与停机时长', criterion: '结案后自动写入知识候选池', riskLevel: 'MEDIUM' }
        ];
        payload.text = [
          '结论：已创建工单 ' + workorder.workorderNo + '。',
          '等级：' + workorder.severity + '；来源异常：' + workorder.anomalyId,
          '下一步：到「工单管理」页推进状态并完成结案回填。',
          '风险提示：派单与维修须由实训教师或维修人员确认。',
          '来源：异常记录 ' + workorder.anomalyId + '。'
        ].join('\n');
        return payload;
      } catch (error) {
        payload.conclusion = '工单创建失败：' + error.message;
        payload.text = '结论：工单创建失败：' + error.message + '\n下一步：到「点检填报」重新提交异常后，在看板中点击「建单」。';
        return payload;
      }
    }
    var equipment = slots.equipment;
    if (!equipment && slots.category) { equipment = equipmentForCategory(slots.category, slots.symptom); }
    if (!equipment) {
      session.pendingIntent = 'WO';
      return clarifyPayload(sid, 'WO', slots, message);
    }
    payload.answerType = 'WORKORDER_ADVICE';
    payload.conclusion = '已识别设备 ' + equipment.name + '。工单由异常记录生成：先提交点检异常，再在看板/点检结果中点击「创建工单」。';
    payload.confidence = 'HIGH';
    payload.equipmentCode = equipment.equipmentCode;
    payload.actions = [
      { action: '到「点检填报」提交一次包含异常的点检', criterion: '异常项必须填写备注并可选择严重度', riskLevel: 'LOW' },
      { action: '在「异常看板」的最近异常中点击「建单」', criterion: '自动生成工单并保留来源异常编号', riskLevel: 'LOW' },
      { action: '在「工单管理」推进状态并结案回填', criterion: '结案根因自动进入知识候选池', riskLevel: 'MEDIUM' }
    ];
    payload.text = [
      '结论：工单由点检异常生成，当前设备 ' + equipment.name + ' 暂无待处理异常。',
      '路径：点检填报（提交异常）→ 异常看板（建单）→ 工单管理（推进/结案）→ 知识回流。',
      '风险提示：涉及安全类异常（冒烟、漏电、超温）先停机断电并联系教师。',
      '来源：本地工单与点检数据。'
    ].join('\n');
    return payload;
  }

  // ---------------------------------------------------------------------------
  // 其他 API
  // ---------------------------------------------------------------------------

  function handleHealth() {
    return {
      status: 'ok',
      mode: 'offline',
      offline: true,
      version: VERSION,
      generatedAt: nowIso(),
      data: DATA.meta || {},
      stats: dataStats(),
      warnings: []
    };
  }

  function handleEquipment(queryValue) {
    var query = compact(queryValue);
    var list = DATA.equipment;
    if (query) {
      list = list.filter(function (equipment) {
        var haystack = compact([
          equipment.equipmentCode, equipment.name, equipment.category,
          categoryName(equipment.category), equipment.location, equipment.brand,
          (equipment.commonFaults || []).join(' '), (equipment.safetyRules || []).join(' ')
        ].join(' '));
        return haystack.indexOf(query) !== -1;
      });
    }
    return clone(list);
  }

  function handleChatRequest(body) {
    return handleChat(body);
  }

  function handleTroubleshootAnswerRequest(body) {
    body = isObject(body) ? body : {};
    var sid = text(body.sessionId) || makeSessionId();
    var session = getSession(sid);
    var payload = handleTroubleshootAnswer(sid, session, text(body.reply), text(body.treeId));
    session.lastIntent = 'TRG';
    saveSession(session);
    payload.sessionId = sid;
    return payload;
  }

  function handleChecklistGenerateRequest(body) {
    return generateChecklistData(body);
  }

  function handleChecklistSubmitRequest(body) {
    body = isObject(body) ? body : {};
    return submitChecklistData(body);
  }

  function handleDashboardRequest(daysValue) {
    return dashboardData(daysValue);
  }

  function handleWorkorderCreateRequest(body) {
    body = isObject(body) ? body : {};
    return createWorkorderData(text(body.anomalyId), text(body.note), text(body.operator));
  }

  function handleWorkorderUpdateRequest(workorderId, body) {
    return updateWorkorderData(workorderId, body);
  }

  // ---------------------------------------------------------------------------
  // 路由与 fetch
  // ---------------------------------------------------------------------------

  function handleKnowledge(query) {
    var q = compact(query.query || '');
    var category = text(query.category || '').toUpperCase();
    var source = text(query.source || '').toUpperCase();
    var rows = [];
    DATA.knowledge.forEach(function (entry) {
      var sourceType = entry.source && entry.source.type ? text(entry.source.type).toUpperCase() : '';
      if (category && text(entry.equipmentCategory).toUpperCase() !== category) { return; }
      if (source && sourceType !== source) { return; }
      if (q) {
        var haystack = compact([
          entry.title, entry.symptom,
          (entry.symptomKeywords || []).join(' '),
          (entry.tags || []).join(' '),
          (entry.causes || []).map(function (c) { return c.rootCause || ''; }).join(' '),
          (entry.actions || []).join(' ')
        ].join(' '));
        if (haystack.indexOf(q) === -1) { return; }
      }
      rows.push(entry);
    });
    rows.sort(function (a, b) {
      var ka = text(a.equipmentCategory) + text(a.id);
      var kb = text(b.equipmentCategory) + text(b.id);
      return ka < kb ? -1 : (ka > kb ? 1 : 0);
    });
    var limit = parseInt(query.limit || '200', 10);
    if (!isFinite(limit) || limit < 1) { limit = 200; }
    if (limit > 300) { limit = 300; }
    var categories = {};
    var sources = {};
    rows.forEach(function (entry) {
      if (entry.equipmentCategory) { categories[entry.equipmentCategory] = true; }
      if (entry.source && entry.source.type) { sources[entry.source.type] = true; }
    });
    return { total: rows.length, items: rows.slice(0, limit), categories: Object.keys(categories).sort(), sources: Object.keys(sources).sort() };
  }

  function dispatch(method, path, query, body) {
    if (method === 'GET' && path === '/api/health') { return handleHealth(); }
    if (method === 'GET' && path === '/api/equipment') { return handleEquipment(getQuery(query, 'query')); }
    if (method === 'GET' && path === '/api/knowledge') { return handleKnowledge({ query: getQuery(query, 'query'), category: getQuery(query, 'category'), source: getQuery(query, 'source'), limit: getQuery(query, 'limit') }); }
    if (method === 'GET' && path === '/api/dashboard') { return handleDashboardRequest(getQuery(query, 'days')); }
    if (method === 'GET' && path === '/api/workorders') { return listWorkordersData(getQuery(query, 'status')); }
    if (method === 'POST' && path === '/api/chat') { return handleChatRequest(body); }
    if (method === 'POST' && path === '/api/troubleshoot/answer') { return handleTroubleshootAnswerRequest(body); }
    if (method === 'POST' && path === '/api/checklists/generate') { return handleChecklistGenerateRequest(body); }
    if (method === 'POST' && path === '/api/checklists/submit') { return handleChecklistSubmitRequest(body); }
    if (method === 'POST' && path === '/api/workorders') { return handleWorkorderCreateRequest(body); }
    var workorderMatch = /^\/api\/workorders\/(.+)$/.exec(path);
    if (workorderMatch) {
      var workorderId = decodeURIComponent(workorderMatch[1]);
      if (method === 'PATCH') { return handleWorkorderUpdateRequest(workorderId, body); }
      if (method === 'GET') {
        var list = listWorkordersData('');
        for (var i = 0; i < list.length; i++) {
          if (text(list[i].workorderId) === workorderId || text(list[i].workorderNo) === workorderId) { return list[i]; }
        }
        throw apiError(404, 'WORKORDER_NOT_FOUND', '未找到工单 ' + workorderId + '。');
      }
      throw apiError(405, 'METHOD_NOT_ALLOWED', '不支持的方法 ' + method);
    }
    if (path.indexOf('/api/') === 0) { throw apiError(404, 'NOT_FOUND', '离线演示未实现该接口：' + path); }
    throw apiError(404, 'NOT_FOUND', '未知请求：' + path);
  }

  function makeResponse(payload, status) {
    var bodyText = JSON.stringify(payload);
    status = status || 200;
    if (typeof Response === 'function') {
      try {
        return new Response(bodyText, {
          status: status,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      } catch (e) { /* 退回最小实现 */ }
    }
    return {
      ok: status >= 200 && status < 300,
      status: status,
      statusText: '',
      headers: { get: function () { return 'application/json; charset=utf-8'; } },
      text: function () { return Promise.resolve(bodyText); },
      json: function () { return Promise.resolve(payload); },
      clone: function () { return makeResponse(payload, status); }
    };
  }

  function makePlainResponse(bodyText, status) {
    status = status || 200;
    if (typeof Response === 'function') {
      try {
        return new Response(bodyText || '', {
          status: status,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      } catch (e) { /* 退回最小实现 */ }
    }
    return {
      ok: status >= 200 && status < 300,
      status: status,
      statusText: '',
      headers: { get: function () { return 'text/plain; charset=utf-8'; } },
      text: function () { return Promise.resolve(bodyText || ''); },
      json: function () { return Promise.reject(new Error('Not JSON')); },
      clone: function () { return makePlainResponse(bodyText, status); }
    };
  }

  function resolveRequest(input, init) {
    var url = '';
    var method = 'GET';
    if (typeof input === 'string') { url = input; }
    else if (input && typeof input === 'object') {
      url = text(input.url);
      method = text(input.method) || 'GET';
    }
    if (init && init.method) { method = text(init.method); }
    var URLCtor = null;
    try { URLCtor = (typeof URL !== 'undefined') ? URL : root.URL; } catch (e) { URLCtor = null; }
    if (!URLCtor) { return { isApi: false, path: '', query: null, protocol: '', method: method.toUpperCase() }; }
    var pageProtocol = 'file:';
    try { if (root.location && root.location.protocol) { pageProtocol = root.location.protocol; } } catch (e) { /* ignore */ }
    var parsed;
    try {
      // 用 http 虚拟基址解析以正确处理 '/api/xxx' 这类根路径（file:// 基址会把它们解析成 /D:/api/xxx）
      parsed = new URLCtor(url, 'http://offline.local/');
    } catch (e) {
      return { isApi: false, path: '', query: null, protocol: pageProtocol, method: method.toUpperCase() };
    }
    var path = parsed.pathname || '';
    var isAbsolute = /^[a-z][a-z0-9+.\-]*:/i.test(text(url));
    return {
      isApi: path === '/api' || path.indexOf('/api/') === 0,
      path: path,
      query: parsed.searchParams || null,
      protocol: isAbsolute ? parsed.protocol : pageProtocol,
      method: method.toUpperCase()
    };
  }

  function installFetch() {
    var nativeFetch = (typeof root.fetch === 'function') ? root.fetch.bind(root) : null;
    root.fetch = function (input, init) {
      var info = resolveRequest(input, init);
      if (!info.isApi) {
        if (nativeFetch && info.protocol && info.protocol !== 'file:') { return nativeFetch(input, init); }
        return Promise.resolve(makePlainResponse('', 404));
      }
      if (init && init.signal && init.signal.aborted) {
        var abortError = new Error('请求已取消');
        abortError.name = 'AbortError';
        return Promise.reject(abortError);
      }
      var body;
      try { body = parseBody(init && init.body); }
      catch (error) {
        return Promise.resolve(makeResponse({ error: { code: error.code || 'BAD_JSON', message: error.message } }, error.status || 400));
      }
      var result;
      try {
        result = { status: 200, payload: dispatch(info.method, info.path, info.query, body) };
      } catch (error) {
        if (error && error.__apiError) {
          result = { status: error.status, payload: { error: { code: error.code, message: error.message } } };
        } else {
          try { if (root.console && root.console.error) { root.console.error('[离线演示] 内部错误', error); } } catch (e2) { /* ignore */ }
          result = { status: 500, payload: { error: { code: 'INTERNAL', message: '离线演示内部错误：' + (error && error.message ? error.message : 'unknown') } } };
        }
      }
      return Promise.resolve(makeResponse(result.payload, result.status));
    };
  }

  function resetOfflineData() {
    Object.keys(STORE_KEYS).forEach(function (key) { try { LS.removeItem(STORE_KEYS[key]); } catch (e) { /* ignore */ } });
  }

  function init() {
    buildCategoryAliases();
    buildEquipmentAliases();
    buildSymptomTerms();
    buildIndexes();
  }

  init();
  installFetch();

  try {
    root.__WXBST_OFFLINE__ = {
      version: VERSION,
      mode: 'offline',
      stats: dataStats(),
      reset: resetOfflineData
    };
  } catch (e) { /* ignore */ }
})();
