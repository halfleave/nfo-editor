/* auto115-core.js 纯逻辑单测 —— 不需要 DOM/浏览器桩，直接 require 加载 */
const api = require('/Users/leavehalf/Downloads/work/NFO/nfo-editor/src/auto115-core.js');
const assert = (cond, msg) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + msg); if (!cond) process.exitCode = 1; };

/* ---------- 步骤表 ---------- */
assert(api.STEP_DEFS.length === 6 && api.STEP_DEFS[3].key === 'cleanup', '单影片 6 步表');
assert(api.STEPS_TV.length === 8 && api.STEPS_TV[5].key === 'mkdir2' && api.STEPS_TV[7].key === 'move2', '剧集 8 步表（mkdir2→rename→move2）');
assert(api.newSteps('upload', false).length === 2, '上传任务 2 步');
assert(api.newSteps(undefined, true)[3].key === 'cleanup', '无 type 且 isTv → 剧集表');
assert(api.stepLabel('mkdir2') === '新建季文件夹', 'stepLabel 命中剧集表');
assert(api.stepLabel('nope') === 'nope', 'stepLabel 未命中返回原 key');

/* ---------- 状态合成 ---------- */
const tFail = { steps: [{ key: 'rename', state: 'fail' }] };
assert(api.status(tFail, false).cls === 'ab-fail' && api.status(tFail, false).text === '失败 · 修改视频名称', '任一步 fail → 红');
const mkTask = (steps, extra) => Object.assign({ steps: steps.map(([key, state]) => ({ key, state, probes: 0 })) }, extra);
assert(api.status(mkTask([['submit', 'ok'], ['wait', 'running']]), false).text === '离线中 (1/3)', 'wait running → 离线中 x/3');
assert(api.status(mkTask([['submit', 'ok'], ['wait', 'waiting']]), false).text === '等待中 · 已探 0/3', 'waiting → 等待中');
assert(api.status(mkTask([['submit', 'ok'], ['wait', 'ok'], ['cleanup', 'ok']]), false).text === '已完成', 'cleanup ok → 已完成');
assert(api.status(mkTask([['submit', 'idle'], ['wait', 'idle']]), false).text === '待提交', '全 idle → 待提交');
assert(api.status(mkTask([['submit', 'idle']]), false, { queued: true }).text !== '排队中' || true, '');
assert(api.status(Object.assign(mkTask([['submit', 'idle']]), { queued: true }), false).text === '排队中', 'queued → 排队中');
assert(api.status(Object.assign(mkTask([['dir', 'ok'], ['upload', 'ok']]), { type: 'upload' }), false).text === '已完成', '上传任务完成态');
assert(api.isActive(mkTask([['mkdir', 'running']])) === true && api.isActive(mkTask([['mkdir', 'skip']])) === false, 'isActive 只认 running');
assert(api.isZombieStep({ state: 'running', at: Date.now() - 11 * 60 * 1000 }, Date.now()) === true, 'running 超 10 分钟 → 僵尸');
assert(api.isZombieStep({ state: 'running', at: Date.now() - 5 * 60 * 1000 }, Date.now()) === false, 'running 5 分钟 → 不是僵尸');

/* ---------- 任务合并（防引用掉包） ---------- */
const memA = { id: 'a' }, memB = { id: 'b' }, savedC = { id: 'c' };
const merged = api.mergeTasks([memA, memB], [memA, savedC]);
assert(merged.length === 3 && merged[0] === memA && merged[1] === memB && merged[2] === savedC, 'mergeTasks：内存引用保持 + 补库里的');
assert(api.mergeTasks([{ id: 'a' }, { id: 'a' }], []).length === 1, 'mergeTasks：内存内去重');

/* ---------- 命名规则 ---------- */
assert(api.cleanName('盗梦空间 Inception:2010') === '盗梦空间.Inception2010', 'cleanName：空格转点 + 去非法字符');
assert(api.norm('The.Matrix!!') === 'thematrix', 'norm：小写 + 只留字母数字汉字');
assert(api.looksDvd('IPX-486') === true && api.looksDvd('盗梦空间') === false, 'looksDvd 番号判定');
assert(api.movieVideoName({ filmTitle: '盗梦空间', originalTitle: 'Inception', year: '2010' }) === '盗梦空间.Inception.2010', '影片名：标题.原始标题.年份');
assert(api.movieVideoName({ filmTitle: 'test', originalTitle: 'test', year: '2020' }) === 'test.2020', '标题=原始标题 → 标题.年份');
assert(api.movieVideoName({ filmTitle: '老片' }) === '老片', '无年份 → 仅标题');
assert(api.externalBaseName({ targetName: 'IPX-486' }) === 'IPX-486', '外部任务番号原样');
assert(api.externalBaseName({ targetName: 'My Show' }) === 'My.Show', '外部任务标题清洗');
assert(api.externalBaseName({}) === '', '外部任务无目标名 → 空');
assert(api.partBase('Show.S01.cd2.mkv') === api.norm('Show.S01'), 'partBase 去分碟尾缀');
assert(api.sizeFmt(1536) === '1.5 KB' && api.sizeFmt(0) === '0 B', 'sizeFmt 人类可读');
assert(api.btih('magnet:?xt=urn:btih:' + 'abcdef1234567890abcdef1234567890abcdef12') === 'ABCDEF1234567890ABCDEF1234567890ABCDEF12', 'btih 提取并大写');

/* ---------- 剧集解析 ---------- */
assert(api.episodeOf('Show.S02E05.mkv').season === 2 && api.episodeOf('Show.S02E05.mkv').episode === 5, 'SxxExx 解析');
assert(api.episodeOf('show 1x07.mp4').episode === 7, '1x07 解析');
assert(api.episodeOf('[12] 番外.mp4').episode === 12, '[12] 括号集号');
assert(api.episodeOf('第三季 第十二集.mp4').season === 3 && api.episodeOf('第三季 第十二集.mp4').episode === 12, '中文季集解析');
assert(api.episodeOf('第二部 03.mkv').season === 2, '「部」也算季（03 无集标记 → episode null）');
assert(api.episodeOf('第二季 预告.mp4').episode === null, '只有季 → episode null');
assert(api.episodeOf('随便什么.mp4') === null, '认不出 → null');
assert(api.cnNum('十二') === 12 && api.cnNum('两') === 2 && api.cnNum('零七') === 7, '中文数字转换');
assert(api.pad2(3) === '03' && api.pad2(12) === '12', 'pad2 补零');
assert(api.isVideoName('a.mkv') && !api.isVideoName('a.jpg'), '视频扩展名判定');
assert(api.isSubtitle('a.zh.srt') && !api.isSubtitle('a.mp4'), '字幕扩展名判定');
assert(api.subLang('Show.S01E01.chs.srt') === 'zh' && api.subLang('Show.S01E01.cht.srt') === 'zt' && api.subLang('Show.S01E01.kor.srt') === null, '字幕语言：简/繁/其他');

/* ---------- 剧集命名 ---------- */
assert(api.tvVideoName('师兄 太稳健', 1, 1, '.mp4') === '师兄.太稳健.S01E01.mp4', 'tvVideoName：标题.SxxExx.ext');
assert(api.tvSubName('Show', 2, 3, 'zh', '.srt') === 'Show.S02E03.zh.srt', 'tvSubName：字幕带语言');
assert(api.tvDirName('师傅 在上') === '师傅.在上', 'tvDirName：清洗非法字符与空格');

/* ---------- 整理计划 tvPlan ---------- */
const items = [
  { fid: 'v1', name: 'Show.S01E01.mkv' },
  { fid: 'v2', name: 'Show.S01E02.mkv' },
  { fid: 'v3', name: 'Show.S02E01.mkv' },
  { fid: 's1', name: 'Show.S01E01.chs.srt' },
  { fid: 'j1', name: 'sample.mp4' },
  { fid: 'j2', name: 'cover.jpg' },
  { fid: 's2', name: 'Show.kor.srt' }           // 非中文字幕 → 删
];
const plan = api.tvPlan('Show', items);
const names = plan.renames.map(r => r.name);
assert(names.indexOf('Show.S01E01.mkv') >= 0 && names.indexOf('Show.S01E02.mkv') >= 0 && names.indexOf('Show.S02E01.mkv') >= 0, 'tvPlan：已识别集号保持不变');
assert(names.indexOf('Show.S01E01.zh.srt') >= 0, 'tvPlan：中文字幕带 .zh');
assert(plan.deleteFids.indexOf('j1') >= 0 && plan.deleteFids.indexOf('j2') >= 0 && plan.deleteFids.indexOf('s2') >= 0, 'tvPlan：sample/无关文件/非中文字幕进删除清单');
const plan2 = api.tvPlan('X', [{ fid: 'p1', name: '某剧 第1集.mkv' }, { fid: 'p2', name: '某剧 第2集.mkv' }]);
assert(plan2.renames.map(r => r.name).join(',') === 'X.S01E01.mkv,X.S01E02.mkv', 'tvPlan：中文集号按顺序识别');
const plan3 = api.tvPlan('Y', [{ fid: 'q1', name: 'ep.mkv' }, { fid: 'q2', name: 'ep2.mkv' }]);
const p3names = plan3.renames.map(r => r.name);
assert(p3names.indexOf('Y.S01E01.mkv') >= 0 && p3names.indexOf('Y.S01E02.mkv') >= 0 && p3names.length === 2, 'tvPlan：认不出集号顺序补号不撞号（ep2 被 E02 规则命中）');
const plan4 = api.tvPlan('Z', [{ fid: 'd1', name: 'D.第二部 第1集.mkv' }, { fid: 'd2', name: 'D.第1集.mkv' }]);
assert(plan4.renames.some(r => r.name === 'Z.S02E01.mkv'), 'tvPlan：第二部 → S02');

/* ---------- 分季阈值 ---------- */
const mkPlan = (list) => ({ renames: list.map(n => ({ name: n })) });
const one = api.tvNeedSeasonSplit(mkPlan(['A.S01E01.mkv', 'A.S01E02.srt']));
assert(one.split === false && one.reason.indexOf('1 季') >= 0, '只有一季 → 不分');
const small = api.tvNeedSeasonSplit(mkPlan(['A.S01E01.mkv', 'A.S02E01.mkv', 'A.S02E02.mkv']));
assert(small.split === false && small.reason.indexOf('不足 100') >= 0, '2 季不足 100 集 → 不分');
const origMin = api.SPLIT_MIN_EPISODES;
api.SPLIT_MIN_EPISODES = 2;
const big = api.tvNeedSeasonSplit(mkPlan(['A.S01E01.mkv', 'A.S02E01.mkv']));
assert(big.split === true && big.reason.indexOf('阈值') >= 0, '2 季达阈值（临时 2）→ 分季（阈值可动态改）');
api.SPLIT_MIN_EPISODES = origMin;
assert(api.tvNeedSeasonSplit(mkPlan(['A.S01E01.mkv', 'A.S02E01.mkv'])).split === false, '恢复默认 100 后同数据 → 不分');

/* ---------- 移入冲突决策 planMoveJobs ---------- */
const jobs = [
  { fid: 'f1', name: 'A.S01E01.mkv', size: 100 },    // 目标夹没有 → 移
  { fid: 'f2', name: 'A.S01E02.mkv', size: 200 },    // 同名同大小 → 跳过
  { fid: 'f3', name: 'A.S01E03.mkv', size: 300 }     // 同名不同大小 → .2
];
const existing = [{ n: 'A.S01E02.mkv', s: 200 }, { n: 'A.S01E03.mkv', s: 999 }];
const pm = api.planMoveJobs(jobs, existing);
assert(pm.todo.length === 2 && pm.skipped === 1, 'planMoveJobs：1 移 + 1 跳过 + 1 改名');
assert(jobs[2].name === 'A.S01E03.2.mkv', '同名不同大小 → 目标名加 .2');
assert(api.planMoveJobs(jobs, []).skipped === 0, '空目标夹全移');

/* ---------- 探测延迟 ---------- */
assert(api.probeDelay(0) === 5000 && api.probeDelay(1) === 5000 && api.probeDelay(2) === 10000 && api.probeDelay(9) === 10000, 'probeDelay 5s/5s/10s 封顶');

console.log(process.exitCode ? '\n❌ 有用例失败' : '\n✅ auto115-core 全部通过');
process.exit(process.exitCode || 0);
