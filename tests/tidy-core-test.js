#!/usr/bin/env node
/* tidy-core（文件整理纯逻辑：水印清洗 + 规则注册表）测试
 * 运行：node tests/tidy-core-test.js （由 tools/check.js 汇总）
 * 约定：一行一个 assert，PASS/FAIL 开头便于 check.js 统计 */
const TidyCore = require('../src/tidy-core.js').TidyCore;
function assert(cond, msg){ console.log((cond ? 'PASS' : 'FAIL') + ' ' + msg); if (!cond) process.exitCode = 1; }

/* —— 注册表 —— */
assert(Array.isArray(TidyCore.RULE_GROUPS) && TidyCore.RULE_GROUPS.length === 4, '注册表：4 个分组（A命名/B结构/C清理/D归属）');
const allRules = [];
TidyCore.RULE_GROUPS.forEach(g => g.rules.forEach(r => allRules.push(r)));
const rids = allRules.map(r => r.id);
assert(new Set(rids).size === rids.length, '注册表：规则 id 无重复');
assert(TidyCore.findRule('watermark') && TidyCore.findRule('watermark').rule.done, '注册表：watermark 存在且标记为已实现');
assert(!!TidyCore.findRule('crossMove') && TidyCore.findRule('crossMove').group.id === 'D', '注册表：crossMove 属 D 组');
assert(!TidyCore.findRule('nope'), '注册表：未知规则返回 null');

/* —— 内置水印 —— */
assert(Array.isArray(TidyCore.WATERMARK_DEFAULT) && TidyCore.WATERMARK_DEFAULT.length >= 4, '水印：内置条目 ≥4 条');
const d1 = TidyCore.defaultWatermarks();
d1[0].src = 'XXX';
assert(TidyCore.WATERMARK_DEFAULT[0].src !== 'XXX', '水印：defaultWatermarks 返回深拷贝（改副本不污染常量）');

/* —— 清洗：前缀类 —— */
assert(TidyCore.applyWatermarks('www.98T.la@66.zip', TidyCore.defaultWatermarks()) === '66.zip', '清洗：R1 www.98T.la@ 前缀');
assert(TidyCore.applyWatermarks('uwww.98T.la@ 66.zip', TidyCore.defaultWatermarks()) === '66.zip', '清洗：R1 uwww 前缀 + 空格收敛');
assert(TidyCore.applyWatermarks('fulidao.xyz@1 (1).avi', TidyCore.defaultWatermarks()) === '1 (1).avi', '清洗：R2 fulidao.xyz@');
assert(TidyCore.applyWatermarks('【7d68.xyz】 (8).mp4', TidyCore.defaultWatermarks()) === '(8).mp4', '清洗：R3 前缀括注');

/* —— 清洗：大小写不敏感 —— */
assert(TidyCore.applyWatermarks('WWW.98T.LA@a.mp4', TidyCore.defaultWatermarks()) === 'a.mp4', '清洗：站点指纹大小写不敏感');

/* —— 清洗：中部/尾部 —— */
assert(TidyCore.applyWatermarks('abc www.98t.la@ def.mp4', TidyCore.defaultWatermarks()) === 'abc def.mp4', '清洗：R5 中部散落站点指纹');
assert(TidyCore.applyWatermarks('我的电影.mp4【www.abc.com】', TidyCore.defaultWatermarks()) === '我的电影.mp4', '清洗：R4 尾缀站点括注');
assert(TidyCore.applyWatermarks('影片[中文字幕].mkv', TidyCore.defaultWatermarks()) === '影片[中文字幕].mkv', '清洗：保留 [中文字幕] 类内容标签');

/* —— 清洗：不误伤 —— */
assert(TidyCore.applyWatermarks('SDDE-045 巨乳処刑人.mp4', TidyCore.defaultWatermarks()) === 'SDDE-045 巨乳処刑人.mp4', '清洗：普通名字原样不动');
assert(TidyCore.applyWatermarks('', TidyCore.defaultWatermarks()) === '', '清洗：空串安全');

/* —— 清洗：全局匹配（水印/广告不在首尾也要删） —— */
assert(TidyCore.applyWatermarks('[98T]www.98t.la@ABC-123.mp4', TidyCore.defaultWatermarks()) === '[98T]ABC-123.mp4', '清洗：开头被别的标签占位时仍能删站点指纹');
assert(TidyCore.applyWatermarks('ABC-123【www.98t.la】【中文字幕】.mp4', TidyCore.defaultWatermarks()) === 'ABC-123【中文字幕】.mp4', '清洗：夹在中间的站点括注照样删');
assert(TidyCore.applyWatermarks('我的视频 www.abc.com@ 2026.mp4', TidyCore.defaultWatermarks()) === '我的视频 2026.mp4', '清洗：中文名里散落的站名@');

/* —— 清洗：全局匹配下仍要守住正常标注 —— */
assert(TidyCore.applyWatermarks('ABC-123【4k】.mp4', TidyCore.defaultWatermarks()) === 'ABC-123【4k】.mp4', '清洗：无域名特征的【4k】不删');
assert(TidyCore.applyWatermarks('ABC-123【1080p.x264】.mp4', TidyCore.defaultWatermarks()) === 'ABC-123【1080p.x264】.mp4', '清洗：规格类【1080p.x264】不删');
assert(TidyCore.applyWatermarks('【中文字幕】ABC-123.mp4', TidyCore.defaultWatermarks()) === '【中文字幕】ABC-123.mp4', '清洗：纯中文括注不删');

/* —— 水印条目模型：不再有 scope（一律全局） —— */
assert(TidyCore.defaultWatermarks().every(function (w) { return !('scope' in w); }), '水印：条目不再带 scope 字段');
assert(TidyCore.watermarkRegExp({ src: '^ABC' }).flags.indexOf('g') >= 0, '正则：一律全局匹配（带 g 标志）');

/* —— 路径短显 —— */
assert(TidyCore.pathBrief('影视/云下载', 2) === '影视 / 云下载', '路径：两级以内原样显示');
assert(TidyCore.pathBrief('影视/云下载/2024/合集/名字', 2) === '影视 / … / 名字', '路径：多级折叠中间（maxSeg=2）');
assert(TidyCore.pathBrief('影视/云下载/2024/合集/名字', 3) === '影视 / … / 合集 / 名字', '路径：多级折叠中间（maxSeg=3）');
assert(TidyCore.pathBrief(' 影视 / 云下载 ', 2) === '影视 / 云下载', '路径：容忍空格与多余分隔符');
assert(TidyCore.pathBrief('', 2) === '', '路径：空串安全');

/* —— 非法正则不炸 —— */
assert(TidyCore.watermarkRegExp({ src: '([' }) === null, '正则：非法源码返回 null 不抛错');
const bad = [{ id: 'x', label: '坏', src: '([' }, { id: 'y', label: '好', src: 'www\\.x\\.com@' }];
assert(TidyCore.applyWatermarks('www.x.com@a.mp4', bad) === 'a.mp4', '正则：坏条目跳过后仍继续清洗');

/* —— 预览 / 计划 —— */
const items = [
  { fid: '1', name: 'www.98T.la@66.zip' },
  { fid: '2', name: 'SDDE-045 巨乳処刑人.mp4' },
  { cid: '9', name: '【7d68.xyz】 (8).mp4' }
];
const pv = TidyCore.previewWatermark(items, TidyCore.defaultWatermarks());
assert(pv.length === 3, '预览：逐条返回（含未变化项）');
assert(pv[0].changed && pv[0].clean === '66.zip', '预览：第 1 条标记 changed 并给出新名');
assert(!pv[1].changed && pv[1].clean === pv[1].orig, '预览：未变化项 changed=false');
assert(pv[2].cid === '9' && pv[2].fid === '', '预览：透传 fid/cid（目录用 cid）');

const plan = TidyCore.planWatermark(items, TidyCore.defaultWatermarks());
assert(plan.length === 2, '计划：只保留会变化的条目（2 条）');
assert(plan[0].op === 'rename' && plan[0].fid === '1' && plan[0].name === '66.zip', '计划：第 1 条 op=rename 且带 fid');
assert(plan.every(o => o.why), '计划：每条 op 必带 why');

/* —— planRule 入口 —— */
const r1 = TidyCore.planRule('watermark', items, { watermarks: TidyCore.defaultWatermarks() });
assert(r1.ok && r1.ops.length === 2, 'planRule：watermark 走通并产出 2 op');
const r2 = TidyCore.planRule('extLower', items, {});
assert(!r2.ok && r2.reason === '即将上线', 'planRule：未实现规则 → 即将上线');
const r3 = TidyCore.planRule('nope', items, {});
assert(!r3.ok && r3.reason === '未知规则', 'planRule：未知规则 → 未知规则');

/* —— finalizeName 边界 —— */
assert(TidyCore.finalizeName('  a   b  ') === 'a b', 'finalize：收敛连续空格');
assert(TidyCore.finalizeName('-_-标题 .mp4') === '标题.mp4', 'finalize：去掉首尾残留分隔符');
assert(TidyCore.applyWatermarks('www.98T.la@', TidyCore.defaultWatermarks()) === '', '清洗：只剩指纹 → 空串（由上层判空归档）');

/* —— 任务步骤模板 —— */
const stRule = TidyCore.newSteps('rule');
assert(stRule.length === 3, '步骤：rule 模板 3 步（读取/计划/执行）');
assert(stRule[0].key === 'scan' && stRule[2].key === 'exec', '步骤：rule 键序 scan→plan→exec');
assert(stRule.every(s => s.state === 'idle' && s.msg === '' && s.at === 0), '步骤：初态全 idle 且无文案');
const stAi = TidyCore.newSteps('ai');
assert(stAi.length === 3 && stAi[0].key === 'tree' && stAi[1].key === 'chat', '步骤：ai 模板 3 步（目录树/对话/执行）');
assert(TidyCore.newSteps('nope').length === 0, '步骤：未知类型 → 空数组');
assert(TidyCore.newSteps('rule') !== stRule, '步骤：每次返回新数组（不共享引用）');

const mut = TidyCore.newSteps('rule');
TidyCore.stepSet(mut, 'plan', { state: 'ok', at: 123 });
assert(mut[1].state === 'ok' && mut[1].at === 123 && mut[0].state === 'idle', '步骤：stepSet 只改中目标键');
TidyCore.stepSet(mut, 'ghost', { state: 'ok' });
assert(mut[1].state === 'ok' && mut.length === 3, '步骤：stepSet 未知键 → 原样返回不抛错');
assert(TidyCore.stepSet(null, 'scan', { state: 'ok' }) !== undefined, '步骤：stepSet 容忍空数组');
