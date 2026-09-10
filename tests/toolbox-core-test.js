#!/usr/bin/env node
/* toolbox-core（工具箱注册表 + 权限判定）纯逻辑测试
 * 运行：node tests/toolbox-core-test.js （由 tools/check.js 汇总）
 * 约定：一行一个 assert，PASS/FAIL 开头便于 check.js 统计 */
const ToolboxCore = require('../src/toolbox-core.js').ToolboxCore;
function assert(cond, msg){ console.log((cond ? 'PASS' : 'FAIL') + ' ' + msg); if (!cond) process.exitCode = 1; }

/* —— 注册表完整性（字段结构 = 骨架，坏了后面全歪） —— */
assert(Array.isArray(ToolboxCore.TOOLS), '注册表：TOOLS 是数组');
assert(ToolboxCore.TOOLS.length === 5, '注册表：共 5 个工具');

const ids = ToolboxCore.TOOLS.map(t => t.id);
assert(new Set(ids).size === ids.length, '注册表：id 无重复');
assert(ids.indexOf('newNfo') >= 0 && ids.indexOf('tidy115') >= 0, '注册表：含 newNfo / tidy115');

const REQUIRED = ['id', 'name', 'icon', 'tier', 'page'];
const missing = [];
ToolboxCore.TOOLS.forEach(t => REQUIRED.forEach(k => { if (!t[k]) missing.push(t.id + '.' + k); }));
assert(missing.length === 0, '注册表：必填字段齐全' + (missing.length ? ' → 缺 ' + missing.join(',') : ''));

const badTier = ToolboxCore.TOOLS.filter(t => t.tier !== 'free' && t.tier !== 'full');
assert(badTier.length === 0, '注册表：tier 只能是 free / full');

const quotaTools = ToolboxCore.TOOLS.filter(t => t.quota);
assert(quotaTools.length === 1 && quotaTools[0].id === 'tidy115', '注册表：仅 tidy115 带 quota');

/* —— canUse：免费档 —— */
assert(ToolboxCore.canUse('newNfo', '').ok, '权限：免费可用「新增 NFO」');
assert(!ToolboxCore.canUse('subtitle', '').ok && ToolboxCore.canUse('subtitle', '').reason === '即将上线', '权限：免费不可用「字幕下载」→ 即将上线');
assert(!ToolboxCore.canUse('magnet', '').ok && ToolboxCore.canUse('magnet', '').reason === '即将上线', '权限：免费不可用「磁力管理」→ 即将上线');
assert(ToolboxCore.canUse('tidy115', '').ok, '权限：免费可用「文件整理」（额度未用完）');
assert(!ToolboxCore.canUse('poster', '').ok && ToolboxCore.canUse('poster', '').reason === '即将上线', '权限：未实现的工具 → 即将上线');

/* —— canUse：中级档 —— */
assert(!ToolboxCore.canUse('subtitle', 'medium').ok && ToolboxCore.canUse('subtitle', 'medium').reason === '即将上线', '权限：中级仍不可用「字幕下载」（仅高级）→ 即将上线');
assert(!ToolboxCore.canUse('magnet', 'medium').ok && ToolboxCore.canUse('magnet', 'medium').reason === '即将上线', '权限：中级仍不可用「磁力管理」（仅高级）→ 即将上线');
assert(ToolboxCore.canUse('newNfo', 'medium').ok, '权限：中级可用「新增 NFO」');

/* —— canUse：高级档 —— */
assert(ToolboxCore.canUse('subtitle', 'full').ok, '权限：高级可用「字幕下载」');
assert(ToolboxCore.canUse('magnet', 'full').ok, '权限：高级可用「磁力管理」');
assert(ToolboxCore.findTool('magnet').name === '磁力管理', '注册表：磁力工具名称为「磁力管理」（M3.1 改名）');
assert(ToolboxCore.canUse('tidy115', 'full').ok, '权限：高级可用「文件整理」');
assert(!ToolboxCore.canUse('poster', 'full').ok, '权限：高级也进不去未实现的工具');

/* —— 配额拦截 —— */
const usedUp = [{ field: 'tidy115', remaining: 0, limit: 15 }];
assert(!ToolboxCore.canUse('tidy115', '', usedUp).ok && ToolboxCore.canUse('tidy115', '', usedUp).reason === '今日次数已用完', '配额：文件整理额度用尽 → 拦截');
assert(ToolboxCore.canUse('tidy115', '', [{ field: 'tidy115', remaining: 3, limit: 15 }]).ok, '配额：还剩 3 次 → 放行');
assert(ToolboxCore.canUse('tidy115', '', [{ field: 'tmdbSearch', remaining: 0, limit: 15 }]).ok, '配额：字段不匹配 → 不误拦');
assert(ToolboxCore.canUse('tidy115', 'full', usedUp).ok, '配额：高级档不受配额限制');

/* —— 未知工具兜底 —— */
assert(!ToolboxCore.canUse('notExist', 'full').ok && ToolboxCore.canUse('notExist', 'full').reason === '未知工具', '兜底：未知工具 → 未知工具');
assert(ToolboxCore.findTool('notExist') === null && ToolboxCore.findTool('magnet').id === 'magnet', '兜底：findTool 命中/落空都正确');

/* —— visibleTools —— */
const list = ToolboxCore.visibleTools('');
assert(list.length === 5, 'visibleTools：全量返回 5 项（不隐藏）');
assert(list.every(x => x.tool && typeof x.ok === 'boolean' && typeof x.reason === 'string'), 'visibleTools：每项含 tool / ok / reason');
assert(list.filter(x => x.ok).length === 2, 'visibleTools：免费档可用项 = 2（newNfo / tidy115）');

/* —— toolContext —— */
const ctx1 = ToolboxCore.toolContext({ data: { title: 'Inception', year: '2010', dvdid: 'ABC-123', imdbid: 'tt1375666' } });
assert(ctx1.title === 'Inception' && ctx1.year === '2010' && ctx1.code === 'ABC-123' && ctx1.imdbId === 'tt1375666', '上下文：从 film.data 正常取值');
const ctx2 = ToolboxCore.toolContext({ title: '顶层标题' });
assert(ctx2.title === '顶层标题' && ctx2.code === '', '上下文：缺失字段兜底为空串');
assert(ToolboxCore.toolContext(null).title === '', '上下文：传 null 不抛错');
assert(ToolboxCore.toolContext({ data: { title: '' }, title: '回退值' }).title === '回退值', '上下文：data 内为空串 → 回退到顶层字段');

console.log('toolbox-core 完成');
