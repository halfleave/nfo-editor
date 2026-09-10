#!/usr/bin/env node
/* tidy-core（文件整理纯逻辑：水印清洗 + 规则注册表）测试
 * 运行：node tests/tidy-core-test.js （由 tools/check.js 汇总）
 * 约定：一行一个 assert，PASS/FAIL 开头便于 check.js 统计 */
const TidyCore = require('../src/tidy-core.js').TidyCore;
function assert(cond, msg){ console.log((cond ? 'PASS' : 'FAIL') + ' ' + msg); if (!cond) process.exitCode = 1; }

/* —— 注册表 —— */
assert(Array.isArray(TidyCore.RULE_GROUPS) && TidyCore.RULE_GROUPS.length === 5, '注册表：5 个分组（导入/A命名/B结构/C清理/D归属）');
const allRules = [];
TidyCore.RULE_GROUPS.forEach(g => g.rules.forEach(r => allRules.push(r)));
const rids = allRules.map(r => r.id);
assert(new Set(rids).size === rids.length, '注册表：规则 id 无重复');
assert(TidyCore.findRule('watermark') && TidyCore.findRule('watermark').rule.done, '注册表：watermark 存在且标记为已实现');
assert(!!TidyCore.findRule('toYule') && TidyCore.findRule('toYule').group.id === 'D', '注册表：归位规则属 D 组');
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

/* —— 启用开关（on）：默认开启，关掉的条目跳过、但保留在列表里 —— */
assert(TidyCore.defaultWatermarks().every(function (w) { return w.on === true; }), '开关：内置条目默认全部开启');
assert(TidyCore.applyWatermarks('www.98t.la@fulidao.xyz@66.zip',
  [{ src: 'u?www\\.98t\\.la@', on: true }, { src: 'fulidao\\.xyz@', on: false }]) === 'fulidao.xyz@66.zip',
  '开关：关掉的条目完全不参与清洗（另一条照常生效）');
assert(TidyCore.applyWatermarks('www.98t.la@fulidao.xyz@66.zip',
  [{ src: 'u?www\\.98t\\.la@', on: true }, { src: 'fulidao\\.xyz@', on: true }]) === '66.zip',
  '开关：两条都开启时全部清洗');
assert(TidyCore.applyWatermarks('www.x.com@a.mp4', [{ src: 'www\\.x\\.com@' }]) === 'a.mp4',
  '开关：缺省 on 视为开启（老数据兼容）');
assert(TidyCore.applyWatermarks('www.98t.la@a.mp4',
  [{ src: 'u?www\\.98t\\.la@', on: false }]) === 'www.98t.la@a.mp4',
  '开关：唯一一条关掉时文件名原样保留');

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
const r2 = TidyCore.planRule('splitSeason', items, {});
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
assert(stAi.length === 4 && stAi[0].key === 'tree' && stAi[1].key === 'chat' && stAi[2].key === 'plan', '步骤：ai 模板 4 步（目录树/对话/清单/执行）');
assert(TidyCore.newSteps('nope').length === 0, '步骤：未知类型 → 空数组');
assert(TidyCore.newSteps('rule') !== stRule, '步骤：每次返回新数组（不共享引用）');

const mut = TidyCore.newSteps('rule');
TidyCore.stepSet(mut, 'plan', { state: 'ok', at: 123 });
assert(mut[1].state === 'ok' && mut[1].at === 123 && mut[0].state === 'idle', '步骤：stepSet 只改中目标键');
TidyCore.stepSet(mut, 'ghost', { state: 'ok' });
assert(mut[1].state === 'ok' && mut.length === 3, '步骤：stepSet 未知键 → 原样返回不抛错');
assert(TidyCore.stepSet(null, 'scan', { state: 'ok' }) !== undefined, '步骤：stepSet 容忍空数组');

/* ================= A 组：命名规则（9 条） ================= */

/* —— 扩展名小写 —— */
assert(TidyCore.planRule('extLower', [{ fid: '1', name: 'A.MP4' }]).ops[0].name === 'A.mp4', 'extLower：大写扩展名转小写');
assert(TidyCore.planRule('extLower', [{ fid: '1', name: 'A.mp4' }]).ops.length === 0, 'extLower：已小写不动（幂等）');
assert(TidyCore.planRule('extLower', [{ fid: '1', name: '没有扩展名' }]).ops.length === 0, 'extLower：无扩展名不动');

/* —— 番号大写化 —— */
assert(TidyCore.planRule('dvdUpper', [{ fid: '1', name: 'opud-008 标题.mp4' }]).ops[0].name === 'OPUD-008 标题.mp4', 'dvdUpper：小写番号转大写');
assert(TidyCore.planRule('dvdUpper', [{ fid: '1', name: 'OPUD-008.mp4' }]).ops.length === 0, 'dvdUpper：已大写不动');
assert(TidyCore.planRule('dvdUpper', [{ fid: '1', name: '中文字幕 abc.mp4' }]).ops.length === 0, 'dvdUpper：开头的不是番号就不动');

/* —— 番号归一 —— */
assert(TidyCore.planRule('dvdNormalize', [{ fid: '1', name: 'SDDE_045.mp4' }]).ops[0].name === 'SDDE-045.mp4', 'dvdNormalize：下划线转连字符');
assert(TidyCore.planRule('dvdNormalize', [{ fid: '1', name: '24HSDDE-045P4.mp4' }]).ops[0].name === 'SDDE-045.mp4', 'dvdNormalize：剥离 24H 前缀与 P4 后缀');
assert(TidyCore.planRule('dvdNormalize', [{ fid: '1', name: 'SDDE-045 标题.mp4' }]).ops.length === 0, 'dvdNormalize：已规范不动');

/* —— 非法字符 —— */
assert(TidyCore.planRule('illegalChar', [{ fid: '1', name: '影片@名?.mp4' }]).ops[0].name === '影片名.mp4', 'illegalChar：删 @ ? 等保留字');
assert(TidyCore.planRule('illegalChar', [{ fid: '1', name: '正常名字.mp4' }]).ops.length === 0, 'illegalChar：干净名字不动');

/* —— 超长截断 —— */
const lc1 = TidyCore.planRule('lengthCap', [{ fid: '1', name: '长'.repeat(120) + '.mp4' }]).ops;
assert(lc1.length === 1 && lc1[0].name.length === 100 && lc1[0].name.slice(-4) === '.mp4', 'lengthCap：文件截到 100 字且保住扩展名');
const lc2 = TidyCore.planRule('lengthCap', [{ cid: '9', name: '长'.repeat(80) }]).ops;
assert(lc2.length === 1 && lc2[0].name.length === 60, 'lengthCap：目录截到 60 字');
assert(TidyCore.planRule('lengthCap', [{ fid: '1', name: '短名字.mp4' }]).ops.length === 0, 'lengthCap：不超长不动');

/* —— 发布标签剥离 —— */
assert(TidyCore.planRule('prefixClean', [{ fid: '1', name: '[字幕组] 名字[1080p].mkv' }]).ops[0].name === '名字.mkv', 'prefixClean：删发布/规格括注');
assert(TidyCore.planRule('prefixClean', [{ fid: '1', name: '名字【中文字幕】.mkv' }]).ops.length === 0, 'prefixClean：保留内容类标签');

/* —— 季夹归一（只作用文件夹） —— */
assert(TidyCore.planRule('seasonFolder', [{ cid: '9', name: 'Season 1' }]).ops[0].name === 'S01', 'seasonFolder：Season 1 → S01');
assert(TidyCore.planRule('seasonFolder', [{ cid: '9', name: '第2季' }]).ops[0].name === 'S02', 'seasonFolder：第2季 → S02');
assert(TidyCore.planRule('seasonFolder', [{ cid: '9', name: 'S01' }]).ops.length === 0, 'seasonFolder：已是 S01 不动');
assert(TidyCore.planRule('seasonFolder', [{ cid: '9', name: '2025' }]).ops.length === 0, 'seasonFolder：纯年份不动（不猜）');
assert(TidyCore.planRule('seasonFolder', [{ fid: '1', name: 'S2' }]).ops.length === 0, 'seasonFolder：文件不参与');

/* —— 图片序号化 —— */
assert(TidyCore.planRule('imageSeq', [{ fid: '1', name: '001 (1).jpg' }]).ops[0].name === '001.jpg', 'imageSeq：去掉重复标记');
assert(TidyCore.planRule('imageSeq', [{ fid: '1', name: '001.mp4' }]).ops.length === 0, 'imageSeq：视频不动');
assert(TidyCore.planRule('imageSeq', [{ fid: '1', name: '正常.jpg' }]).ops.length === 0, 'imageSeq：正常图片不动');

/* ================= 导入组：JSON 整理 ================= */
const jp1 = TidyCore.parseTidyJson('{"root":"影视/云下载","items":[{"dir":"","from":"A.MP4","to":"A.mp4"}]}');
assert(jp1.ok && jp1.items.length === 1 && jp1.root === '影视/云下载', 'JSON：解析对象形态（带 root）');
const jp2 = TidyCore.parseTidyJson([{ path: '娱乐', old: 'a.mp4', newName: 'b.mp4' }]);
assert(jp2.ok && jp2.items[0].dir === '娱乐' && jp2.items[0].from === 'a.mp4' && jp2.items[0].to === 'b.mp4', 'JSON：数组形态 + 字段别名');
assert(TidyCore.parseTidyJson('这不是 json').ok === false, 'JSON：坏文本返回 ok=false');
assert(TidyCore.parseTidyJson('{"items":[{"from":"a"}]}').ok === false, 'JSON：缺 to 视为无效');
assert(TidyCore.parseTidyJson('{"items":[{"from":"a","to":"b"},{"from":"","to":"c"}]}').skipped === 1, 'JSON：不完整条目计入 skipped');

const jr1 = TidyCore.planJsonItems([{ dir: '', from: 'A.MP4', to: 'A.mp4' }], { root: '影视/云下载', byDir: { '': [{ fid: '7', name: 'A.MP4' }] } });
assert(jr1.ops.length === 1 && jr1.ops[0].fid === '7' && jr1.ops[0].name === 'A.mp4', 'JSON：定位到文件产出 rename op');
assert(TidyCore.planJsonItems([{ dir: '', from: '不存在.mp4', to: 'x.mp4' }], { byDir: { '': [] } }).miss.length === 1, 'JSON：找不到记进 miss');
const jr2 = TidyCore.planJsonItems([{ dir: '合集', from: 'old.mp4', to: 'new.mp4' }], { root: '影视/云下载', byDir: { '合集': [{ fid: '8', name: 'old.mp4' }] } });
assert(jr2.ops.length === 1, 'JSON：子目录条目按相对路径定位');
assert(TidyCore.planRule('jsonPlan', [], {}).ok === false, 'JSON：没导入清单时 planRule 明确报错');
assert(TidyCore.planRule('jsonPlan', [], { entries: [{ dir: '', from: 'a', to: 'b' }], byDir: { '': [{ fid: '1', name: 'a' }] } }).ops.length === 1, 'JSON：planRule 走通 jsonPlan');

/* ================= 目录树文本 ================= */
const treeTxt = TidyCore.renderTreeText({ children: [{ name: '夹', dir: true, children: [{ name: 'a.mp4' }] }, { name: 'b.txt' }] });
assert(treeTxt.indexOf('夹/') >= 0 && treeTxt.indexOf('a.mp4') >= 0 && treeTxt.indexOf('b.txt') >= 0, '目录树：渲染出层级与文件名');
assert(TidyCore.renderTreeText({ children: [] }) === '', '目录树：空节点返回空串');

/* ================= 步骤模板（两种任务流程） ================= */
assert(TidyCore.TASK_STEPS.rule.length === 3 && TidyCore.TASK_STEPS.rule[0].key === 'scan', '步骤：规则整理 3 步（读取/计划/执行）');
assert(TidyCore.TASK_STEPS.json.length === 3 && TidyCore.TASK_STEPS.json[0].key === 'read', '步骤：JSON 整理 3 步（读取清单/定位/执行）');
assert(TidyCore.TASK_STEPS.ai.length === 4 && TidyCore.TASK_STEPS.ai[0].key === 'tree', '步骤：AI 整理 4 步（目录树/对话/清单/执行）');
assert(TidyCore.newSteps('json')[0].label === '读取 JSON 清单', '步骤：newSteps 支持 json 模板');

/* ================= 规则注册表（全量） ================= */
assert(TidyCore.RULE_GROUPS.length === 5, '注册表：5 组（导入 / A / B / C / D）');
const atomTotal = TidyCore.RULE_GROUPS.reduce(function (n, g) { return n + g.rules.length; }, 0);
assert(atomTotal === 25, '注册表：共 25 条原子规则（1+9+6+6+3）');
assert(TidyCore.findRule('jsonPlan') && TidyCore.findRule('jsonPlan').rule.done === true, '注册表：JSON 整理已实现');
assert(TidyCore.RULE_GROUPS[1].rules.every(function (r) { return r.done === true; }), '注册表：A 组 9 条全部已实现');
assert(TidyCore.PRESETS.length === 6, '注册表：6 个预设包');
assert(TidyCore.PRESETS[0].rules.indexOf('watermark') >= 0, '注册表：安全快修包含水印清洗');
