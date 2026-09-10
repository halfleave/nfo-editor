/* ===================================================================
 * 文件整理 · 纯逻辑层（水印清洗 + 规则注册表）
 * -------------------------------------------------------------------
 * 配套文档：115/115文件整理规则.md（v0.3）
 * 铁律：本文件不读 state、不碰 DOM、不发请求，所有输入由参数传入。
 *       浏览器挂 window.TidyCore；Node 环境挂 module.exports.TidyCore。
 * 本层只产「op 列表」（改了哪个名字 → 改成什么），执行/预览由 UI 层负责。
 * =================================================================== */
(function (global) {
  'use strict';

  /* ================= 一、水印清洗 ================= */

  /* 内置水印（一律全局匹配，不再分前缀/后缀 —— 水印、广告、站点文本不管出现在哪都要删）
     条目模型：{ id, label, src(正则源码) }。第 4 条要求括注形如「域名」：点号后必须是
     2-8 位纯字母后缀，因此全局匹配也不会误删 `【4k】`『【中文字幕】』『【1080p.x264】』这类标注。 */
  var WATERMARK_DEFAULT = [
    { id: 'w98t',  label: '98T 站点指纹',    src: 'u?www\\.98t\\.la@' },
    { id: 'wfuli', label: 'fulidao 站点指纹', src: 'fulidao\\.xyz@' },
    { id: 'w7d68', label: '7d68 站点括注',    src: '【7d68\\.xyz】' },
    { id: 'wdom',  label: '域名式括注',       src: '【[a-z0-9.-]+\\.[a-z]{2,8}】\\s*' },
    { id: 'wtail', label: '含 www 的站名括注', src: '\\s*【[^】]*www[^】]*】' },
    { id: 'wmeta', label: '通用 www 站名@',   src: '[A-Za-z0-9.-]*www\\.[A-Za-z0-9.-]+@' }
  ];

  /* 深拷贝内置水印（避免调用方直接改到常量表） */
  function defaultWatermarks() {
    return WATERMARK_DEFAULT.map(function (w) {
      return { id: w.id, label: w.label, src: w.src };
    });
  }

  /* 单个条目 → 正则（一律全局匹配：水印/广告不管出现在开头、中间还是结尾都要删）
     非法正则返回 null，不抛错，避免用户手滑写坏让整页炸掉 */
  function watermarkRegExp(w) {
    if (!w || typeof w.src !== 'string' || !w.src) return null;
    try { return new RegExp(w.src, 'gi'); }
    catch (e) { return null; }
  }

  /* 清洗后的收尾：收敛空格、去掉残留的首尾分隔符，但**保住扩展名**。
     例：`www.98T.la@ 66.zip` → `66.zip`；`- 标题 .mp4` → `标题.mp4` */
  function finalizeName(s) {
    return String(s == null ? '' : s)
      .replace(/\s{2,}/g, ' ')            // 连续空格收敛
      .trim()
      .replace(/^[\s\-_.、]+/, '')        // 去掉开头残留的分隔符
      .replace(/[\s\-_]+(?=\.[A-Za-z0-9]+$)/, '') // 扩展名前的残留分隔符
      .trim();
  }

  /* 路径短显：层级多时把中间折叠掉，永远保住「首级 + 末几级」，避免长路径把一行撑爆。
     例（maxSeg=2）：'影视/云下载/2024/合集/名字很长很长' → '影视 / … / 名字很长很长'
     例（maxSeg=3）：同上一串 → '影视 / … / 合集 / 名字很长很长'
     段数不足就直接原样 join；空路径返回空串。 */
  function pathBrief(path, maxSeg) {
    var segs = String(path == null ? '' : path).split('/')
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return !!s; });
    if (!segs.length) return '';
    var n = parseInt(maxSeg, 10);
    if (!n || n < 2) n = 2;
    if (segs.length <= n) return segs.join(' / ');
    return segs[0] + ' / … / ' + segs.slice(-(n - 1)).join(' / ');
  }

  /* 对单个文件名套用整张水印表 → 清洗后的名字（可能为空串，交给上层判空） */
  function applyWatermarks(name, list) {
    var out = String(name == null ? '' : name);
    (list || []).forEach(function (w) {
      var re = watermarkRegExp(w);
      if (re) out = out.replace(re, '');
    });
    return finalizeName(out);
  }

  /* 预览：对一整批条目逐个算「清洗后」，结果**逐条保留**（含未变化的，供 UI 灰显） */
  function previewWatermark(items, list) {
    return (items || []).map(function (it) {
      var orig = (it && (it.name || it.n)) || '';
      var clean = applyWatermarks(orig, list);
      return { fid: (it && it.fid) || '', cid: (it && it.cid) || '', orig: orig, clean: clean, changed: !!clean && clean !== orig };
    });
  }

  /* 计划：只保留「会变化」的条目 → op 列表（供执行器消费） */
  function planWatermark(items, list) {
    return previewWatermark(items, list).filter(function (p) { return p.changed; })
      .map(function (p) {
        return { op: 'rename', fid: p.fid, orig: p.orig, name: p.clean, why: '水印清洗' };
      });
  }

  /* ================= 二、规则注册表 ================= */
  /* 分组见文档 §4.1；done=false 的规则在规则页显示为「即将上线」，不可勾选。
     本轮只落地 A 组第一条「水印清洗」（用户 2026-09-10 指定）。 */
  var RULE_GROUPS = [
    {
      id: 'A', name: '命名规范', risk: 'low', riskLabel: '低风险 · 只改名，可逆',
      rules: [
        { id: 'watermark', name: '水印清洗', risk: 'low', done: true },
        { id: 'extLower',  name: '扩展名小写', risk: 'low', done: false },
        { id: 'dvdUpper',  name: '番号大写化', risk: 'low', done: false },
        { id: 'releaseTag', name: '发布标签剥离', risk: 'low', done: false },
        { id: 'spaceNorm', name: '空格规范化', risk: 'low', done: false },
        { id: 'lenLimit',  name: '长度截断', risk: 'low', done: false }
      ]
    },
    {
      id: 'B', name: '结构整理', risk: 'mid', riskLabel: '中风险 · 建夹 / 移动',
      rules: [
        { id: 'mkdirByDvd', name: '番号建夹', risk: 'mid', done: false },
        { id: 'seasonFolder', name: '季夹归一', risk: 'mid', done: false },
        { id: 'cdSplit', name: '分碟归并', risk: 'mid', done: false }
      ]
    },
    {
      id: 'C', name: '清理', risk: 'high', riskLabel: '高风险 · 删除 / 归档',
      rules: [
        { id: 'emptyDir', name: '空夹清理', risk: 'high', done: false },
        { id: 'junkFile', name: '垃圾文件', risk: 'high', done: false },
        { id: 'dupFile',  name: '重复文件', risk: 'high', done: false }
      ]
    },
    {
      id: 'D', name: '归属', risk: 'highest', riskLabel: '最高风险 · 跨库移动（默认关闭）',
      rules: [
        { id: 'crossMove', name: '跨库归位', risk: 'highest', done: false }
      ]
    }
  ];

  function findRule(id) {
    for (var i = 0; i < RULE_GROUPS.length; i++) {
      var g = RULE_GROUPS[i];
      for (var j = 0; j < g.rules.length; j++) {
        if (g.rules[j].id === id) return { group: g, rule: g.rules[j] };
      }
    }
    return null;
  }

  /* 规则 id → op 列表的总入口（当前只实现水印清洗，其余返回空并给出原因） */
  function planRule(ruleId, items, options) {
    options = options || {};
    if (ruleId === 'watermark') {
      var list = options.watermarks || defaultWatermarks();
      return { ok: true, ops: planWatermark(items, list), reason: '' };
    }
    var hit = findRule(ruleId);
    if (!hit) return { ok: false, ops: [], reason: '未知规则' };
    return { ok: false, ops: [], reason: '即将上线' };
  }

  /* ================= 三、任务步骤模板 ================= */

  /* 任务卡展开时按步骤显示进度（对应 UI 层任务列表的展开体）。
     步骤状态：idle 未开始 / running 进行中 / ok 完成 / fail 失败 / skip 跳过
     模板只定 key + label；时间与文案(msg) 由执行方逐步写入。 */

  var TASK_STEPS = {
    rule: [
      { key: 'scan', label: '读取文件夹' },
      { key: 'plan', label: '生成整理计划' },
      { key: 'exec', label: '执行改名' }
    ],
    ai: [
      { key: 'tree', label: '读取文件夹目录树' },
      { key: 'chat', label: '与 AI 对话确定方案' },
      { key: 'exec', label: '确认并执行' }
    ]
  };

  function newSteps(kind){
    var tpl = TASK_STEPS[kind] || [];
    var out = [];
    for (var i = 0; i < tpl.length; i++){
      out.push({ key: tpl[i].key, label: tpl[i].label, state: 'idle', msg: '', at: 0 });
    }
    return out;
  }

  /* 就地更新某一步；找不到 key 时原样返回，不抛错 */
  function stepSet(steps, key, patch){
    var list = steps || [];
    for (var i = 0; i < list.length; i++){
      if (list[i].key === key){
        for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) list[i][k] = patch[k];
        break;
      }
    }
    return list;
  }

  var api = {
    WATERMARK_DEFAULT: WATERMARK_DEFAULT,
    defaultWatermarks: defaultWatermarks,
    watermarkRegExp: watermarkRegExp,
    finalizeName: finalizeName,
    pathBrief: pathBrief,
    applyWatermarks: applyWatermarks,
    previewWatermark: previewWatermark,
    planWatermark: planWatermark,
    RULE_GROUPS: RULE_GROUPS,
    findRule: findRule,
    planRule: planRule,
    TASK_STEPS: TASK_STEPS,
    newSteps: newSteps,
    stepSet: stepSet
  };

  global.TidyCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports.TidyCore = api;
})(typeof window !== 'undefined' ? window : this);
