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

  /* 内置水印条目（用户可在规则页里增删改）：
     scope: 'any'    任意位置，全局删除（flags gi）
            'prefix' 仅文件名开头（锚 ^，flags i）
            'suffix' 仅文件名结尾（锚 $，flags i）
     src  : 正则源码字符串，**不含锚点**（锚点由 scope 决定）
     label: 展示用名称（给人看，不参与匹配） */
  var WATERMARK_DEFAULT = [
    { id: 'w98t',  label: '98T 站点前缀',     scope: 'any',    src: 'u?www\\.98t\\.la@' },
    { id: 'wfuli', label: 'fulidao 站点前缀', scope: 'any',    src: 'fulidao\\.xyz@' },
    { id: 'w7d68', label: '7d68 站点括注',    scope: 'any',    src: '【7d68\\.xyz】' },
    { id: 'wdom',  label: '域名式前缀括注',   scope: 'prefix', src: '【[a-z0-9.]+】\\s*' },
    { id: 'wtail', label: '站点头尾括注',     scope: 'suffix', src: '\\s*【[^】]*www[^】]*】' },
    { id: 'wmeta', label: '通用 www 站名@',   scope: 'prefix', src: '[A-Za-z0-9.-]*www\\.[A-Za-z0-9.-]+@' }
  ];

  /* 深拷贝内置水印（避免调用方直接改到常量表） */
  function defaultWatermarks() {
    return WATERMARK_DEFAULT.map(function (w) {
      return { id: w.id, label: w.label, scope: w.scope, src: w.src };
    });
  }

  /* 单个条目 → 正则（非法正则返回 null，不抛错，避免用户手滑写坏让整页炸掉） */
  function watermarkRegExp(w) {
    if (!w || typeof w.src !== 'string' || !w.src) return null;
    try {
      if (w.scope === 'prefix') return new RegExp('^' + w.src, 'i');
      if (w.scope === 'suffix') return new RegExp(w.src + '$', 'i');
      return new RegExp(w.src, 'gi');
    } catch (e) { return null; }
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

  var api = {
    WATERMARK_DEFAULT: WATERMARK_DEFAULT,
    defaultWatermarks: defaultWatermarks,
    watermarkRegExp: watermarkRegExp,
    finalizeName: finalizeName,
    applyWatermarks: applyWatermarks,
    previewWatermark: previewWatermark,
    planWatermark: planWatermark,
    RULE_GROUPS: RULE_GROUPS,
    findRule: findRule,
    planRule: planRule
  };

  global.TidyCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports.TidyCore = api;
})(typeof window !== 'undefined' ? window : this);
