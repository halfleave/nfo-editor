/* ===================================================================
 * 工具箱：注册表 + 权限判定（纯逻辑 · 零 DOM · 两端可复用）
 * -------------------------------------------------------------------
 * 配套文档：nfo-plan-v3.md 第 3 节（工具箱）/ 第 11 节（M2 骨架）
 * 铁律：本文件不读 state、不碰 DOM，所有输入由参数传入。
 *       浏览器挂 window.ToolboxCore；Node 环境挂 module.exports.ToolboxCore。
 * 注册表字段（改字段 = 骨架变更，须先确认）：
 *   id / name / icon / tier / page  必填
 *   quota  可选，受配额限制时填配额字段名（对齐 core-shared.js QUOTA_LIMITS）
 *   soon   可选，true = 尚未实现，卡片显示「即将上线」
 *   ctxKey 可选，可从影片带入的上下文键（M6 字幕页用）
 * 注：卡片不显示小字说明（2026-09-10 定），故注册表不设 desc 字段。
 * =================================================================== */
(function (global) {
  'use strict';

  /* 图标只存「键」，SVG 由 UI 层映射 —— 保证本文件不产出任何渲染产物 */
  var TOOLS = [
    { id: 'newNfo',   name: '新增 NFO',  icon: 'doc',    tier: 'free', page: 'newNfo' },
    { id: 'subtitle', name: '字幕下载',  icon: 'sub',    tier: 'full', page: 'subtitle' },
    { id: 'magnet',   name: '磁力管理',  icon: 'magnet', tier: 'full', page: 'magnet' },
    { id: 'tidy115',  name: '文件整理',  icon: 'folder', tier: 'free', page: 'tidy115', quota: 'tidy115' },
    { id: 'poster',   name: '海报生成',  icon: 'image',  tier: 'free', page: 'poster', soon: true }
  ];

  /* 档位排名：'' = 免费(0) / 'medium'(1) / 'full'(2) */
  function tierRank(tier) {
    var t = (tier || '').trim();
    if (t === 'full') return 2;
    if (t === 'medium') return 1;
    return 0;
  }

  function findTool(id) {
    for (var i = 0; i < TOOLS.length; i++) { if (TOOLS[i].id === id) return TOOLS[i]; }
    return null;
  }

  /* 从 usage（NfoCore.quotaData 的产物）取某字段剩余；取不到返回 null（= 不拦，避免误伤） */
  function quotaRemaining(field, usage) {
    if (!usage || !usage.length) return null;
    for (var i = 0; i < usage.length; i++) {
      var it = usage[i];
      if (it && it.field === field) return (typeof it.remaining === 'number') ? it.remaining : null;
    }
    return null;
  }

  /* 能否进入某工具 → { ok, reason }；reason 直接给 UI 显示，不翻译
     注：非高级档看高级工具，也统一显示「即将上线」（不暴露档位差异，2026-09-10 定） */
  function canUse(toolId, tier, usage) {
    var tool = findTool(toolId);
    if (!tool) return { ok: false, reason: '未知工具' };
    if (tool.soon) return { ok: false, reason: '即将上线' };
    if (tool.tier === 'full' && tierRank(tier) < 2) return { ok: false, reason: '即将上线' };
    if (tool.quota && tierRank(tier) < 2) {
      var left = quotaRemaining(tool.quota, usage);
      if (left !== null && left <= 0) return { ok: false, reason: '今日次数已用完' };
    }
    return { ok: true, reason: '' };
  }

  /* 全量返回（含灰态）—— 不隐藏任何工具，保留转化口子（见文档 3.1） */
  function visibleTools(tier, usage) {
    return TOOLS.map(function (tool) {
      var v = canUse(tool.id, tier, usage);
      return { tool: tool, ok: v.ok, reason: v.reason };
    });
  }

  /* 从影片对象推导工具入参（字幕 / 磁力等上下文工具用）；字段缺失一律留空，不抛错 */
  function toolContext(film) {
    var f = film || {};
    var d = f.data || {};
    return {
      title:  d.title  || f.title  || '',
      year:   d.year   || f.year   || '',
      code:   d.dvdid  || f.dvdid  || '',
      imdbId: d.imdbid || f.imdbid || ''
    };
  }

  var api = {
    TOOLS: TOOLS,
    findTool: findTool,
    canUse: canUse,
    visibleTools: visibleTools,
    toolContext: toolContext
  };

  global.ToolboxCore = api;
})(typeof window !== 'undefined' ? window : this);
