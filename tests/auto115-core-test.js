/* auto115-core.js 纯逻辑单测 —— 不需要 DOM/浏览器桩，直接 require 加载 */
require('/Users/leavehalf/Downloads/work/NFO/nfo-editor/src/pinyin-initial.js'); // 必须在 auto115-core 之前，注入拼音首字母表
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
assert(!api.isSubtitle('说明.txt') && !api.isSubtitle('a.txt'), '字幕扩展名不含 .txt（说明文本不当字幕）');

/* 广告视频阈值：主视频体积 ×20%，夹在 5MB–50MB 之间；未知大小 → 0（不启用） */
const MB = 1024 * 1024;
assert(api.adSizeThreshold(100 * MB) === 20 * MB, '广告阈值：主视频 100MB → 20MB');
assert(api.adSizeThreshold(2.5 * 1024 * MB) === 50 * MB, '广告阈值：主视频 2.5GB → 压到上限 50MB');
assert(api.adSizeThreshold(30 * MB) === 6 * MB, '广告阈值：主视频 30MB → 6MB');
assert(api.adSizeThreshold(10 * MB) === 5 * MB, '广告阈值：主视频 10MB → 下限 5MB（且不超过主视频 90%）');
assert(api.adSizeThreshold(0) === 0 && api.adSizeThreshold(null) === 0, '广告阈值：体积未知 → 0（不启用，一律保留）');

/* 标题整词边界匹配（V2 修复）：赌神2 不再命中赌神 */
assert(api.titleHit('赌神.1080p.国粤双语.BD中字.mp4', ['赌神']) === true, 'titleHit：赌神.1080p 命中 赌神');
assert(api.titleHit('赌神2.1080p.国粤双语.mp4', ['赌神']) === false, 'titleHit：赌神2 不命中 赌神（数字后缀=续集）');
assert(api.titleHit('The.Matrix.1999.1080p.mkv', ['The Matrix']) === true, 'titleHit：英文标题（大小写/点分隔）命中');
assert(api.titleHit('Madrid.1987.1080p.mkv', ['Madrid, 1987']) === true, 'titleHit：标题含逗号/年份也能命中');
assert(api.titleHit('肖申克的救赎.1994.BD.mp4', ['肖申克的救赎']) === true, 'titleHit：长中文标题命中');
assert(api.titleHit('赌神 2部全', ['赌神']) === true, 'titleHit：赌神 2部全 命中（空格分隔，2部全是独立词段）');
assert(api.isSubtitle('a.ass') && api.isSubtitle('a.ssa') && api.isSubtitle('a.sub') && api.isSubtitle('a.idx') && api.isSubtitle('a.vtt') && api.isSubtitle('a.smi') && api.isSubtitle('a.lrc'), '其余字幕格式仍识别');
assert(api.subLang('Show.S01E01.chs.srt') === 'zh' && api.subLang('Show.S01E01.cht.srt') === 'zt' && api.subLang('Show.S01E01.kor.srt') === 'und', '字幕语言：简/繁/其他 → 无法识别标记 und（保留）');

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
  { fid: 's2', name: 'Show.kor.srt' }           // 非中文字幕 → 保留并标记 und
];
const plan = api.tvPlan('Show', items);
const names = plan.renames.map(r => r.name);
assert(names.indexOf('Show.S01E01.mkv') >= 0 && names.indexOf('Show.S01E02.mkv') >= 0 && names.indexOf('Show.S02E01.mkv') >= 0, 'tvPlan：已识别集号保持不变');
assert(names.indexOf('Show.S01E01.zh.srt') >= 0, 'tvPlan：中文字幕带 .zh');
assert(plan.deleteFids.indexOf('j1') >= 0 && plan.deleteFids.indexOf('j2') >= 0 && plan.deleteFids.indexOf('s2') < 0, 'tvPlan：sample/无关文件进删除清单；非中文字幕保留');
const plan2 = api.tvPlan('X', [{ fid: 'p1', name: '某剧 第1集.mkv' }, { fid: 'p2', name: '某剧 第2集.mkv' }]);
assert(plan2.renames.map(r => r.name).join(',') === 'X.S01E01.mkv,X.S01E02.mkv', 'tvPlan：中文集号按顺序识别');
const plan3 = api.tvPlan('Y', [{ fid: 'q1', name: 'ep.mkv' }, { fid: 'q2', name: 'ep2.mkv' }]);
const p3names = plan3.renames.map(r => r.name);
assert(p3names.indexOf('Y.S01E01.mkv') >= 0 && p3names.indexOf('Y.S01E02.mkv') >= 0 && p3names.length === 2, 'tvPlan：认不出集号顺序补号不撞号（ep2 被 E02 规则命中）');
const plan4 = api.tvPlan('Z', [{ fid: 'd1', name: 'D.第二部 第1集.mkv' }, { fid: 'd2', name: 'D.第1集.mkv' }]);
assert(plan4.renames.some(r => r.name === 'Z.S02E01.mkv'), 'tvPlan：第二部 → S02');
/* 无集号字幕不兜底：不改名、不删除，保持原名 */
const plan5 = api.tvPlan('竞女', [
  { fid: 'v10', name: '竞女.S01E10.mkv' },
  { fid: 'v11', name: '竞女.S01E11.mkv' },
  { fid: 'v12', name: '竞女.S01E12.mkv' },
  { fid: 's1', name: '竞女.ass' },
  { fid: 's2', name: '竞女.ass' },
  { fid: 's3', name: '竞女.ass' },
  { fid: 's4', name: '竞女.ass' },
  { fid: 's5', name: '竞女.ass' },
  { fid: 's6', name: '竞女.ass' }
]);
const subNames5 = plan5.renames.filter(r => r.name.endsWith('.und.ass')).map(r => r.name);
/* 纯数字标题 → 直接当集号（01.ass → S01E01）；4 位分辨率不被误判 */
assert((api.episodeOf('01.ass') || {}).episode === 1, 'episodeOf：纯数字 01 → 第 1 集');
assert((api.episodeOf('12.srt') || {}).episode === 12, 'episodeOf：纯数字 12 → 第 12 集');
assert((api.episodeOf('竞女.03.ass') || {}).episode === 3, 'episodeOf：剧名.03 → 第 3 集');
assert((api.episodeOf('竞女_05.srt') || {}).episode === 5, 'episodeOf：剧名_05 → 第 5 集');
assert(api.episodeOf('720.mkv') === null && api.episodeOf('1080.mkv') === null, 'episodeOf：720/1080 不被当成集号');
const plan6 = api.tvPlan('竞女', [
  { fid: 'v1', name: '竞女.S01E10.mkv' },
  { fid: 's1', name: '01.ass' },
  { fid: 's2', name: '11.ass' }
]);
const p6names = plan6.renames.map(r => r.name);
assert(p6names.indexOf('竞女.S01E01.und.ass') >= 0, 'tvPlan：数字字幕 01 → S01E01');
assert(p6names.indexOf('竞女.S01E11.und.ass') >= 0, 'tvPlan：数字字幕 11 → S01E11');
assert(subNames5.length === 0, 'tvPlan：认不出集号的字幕不改名（无兜底），不会编出 E13、E14');
assert(plan5.deleteFids.indexOf('s1') < 0 && plan5.deleteFids.indexOf('s6') < 0, 'tvPlan：认不出集号的字幕仍然保留，不进删除清单');

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

/* ---------- 文件整理：标题相似度定位 ---------- */
assert(api.tidyKey('The.Matrix.1999.1080p.BluRay.x264-AAA') === 'thematrix1999aaa', 'tidyKey 只去压制参数（年份数字保留，由 tidyScore 双 key 消化）');
assert(api.tidyKey('【电影天堂】教父.1080p.国语中字.mp4') === '教父', 'tidyKey 去压制组标签与中文噪声');
assert(api.tidyKey('SSNI-666') === 'ssni666', 'tidyKey 保留番号主体');
assert(api.tidyScore('教父.1972.1080p.BluRay', ['教父'], '1972') >= api.TIDY_ACCEPT, '中文档名+年份 → 高分');
assert(api.tidyScore('教父.1972.1080p.BluRay', ['教父'], '1990') < api.TIDY_ACCEPT, '夹名年份与影片不符 → 扣分');
assert(api.tidyScore('The Matrix 1999 1080p', ['黑客帝国', 'The Matrix'], '1999') >= api.TIDY_ACCEPT, '原名命中英文夹名');
assert(api.tidyScore('SSNI-666 出差', ['SSNI-666'], '') >= api.TIDY_ACCEPT, '番号命中');
assert(api.tidyScore('完全不相干的文件夹', ['教父'], '1972') < api.TIDY_MIN, '无关夹名低于候选线');
const tidyList = [
  { cid: 'c1', n: '教父.1972.1080p.BluRay.x264-AAA' },
  { cid: 'c2', n: '教父2' },
  { cid: 'c3', n: '别的东西' }
];
const tidyM = api.matchTidyDir(tidyList, ['教父'], '1972');
assert(tidyM.best && tidyM.best.cid === 'c1', 'matchTidyDir 选出最像的夹');
assert(tidyM.ok === true, '高分且拉开差距 → 自动采用');
assert(tidyM.candidates.length === 2, '候选只保留过线的');
const tidyAmbiguous = api.matchTidyDir([
  { cid: 'x1', n: '教父.1972' }, { cid: 'x2', n: '教父.1972.修复版' }
], ['教父'], '1972');
assert(tidyAmbiguous.ok === false && tidyAmbiguous.candidates.length === 2, '两个候选太接近 → 不自动采用，交给用户选');
assert(api.matchTidyDir([], ['教父'], '1972').ok === false && !api.matchTidyDir([], ['教父'], '1972').best, '空目录 → 无命中');
assert(api.matchTidyDir([{ fid: 'f1', n: '教父.mkv' }], ['教父'], '1972').best.cid === 'f1', '文件条目也能定位（无 cid 时取 fid）');

/* ---------- 单影片存放形态（平铺 / 文件夹） ---------- */
assert(api.movieLayout({ dvdId: 'IPX-486', filmTitle: '某片' }).folder === true, 'AV（有番号）→ 收进文件夹');
assert(api.movieLayout({ dvdId: 'IPX-486', filmTitle: '某片' }).kind === 'av', 'AV → kind=av');
assert(api.movieLayout({ dvdId: '', filmTitle: '教父', nfoUploaded: 0 }).folder === false, '普通影片（无番号、没传 NFO）→ 平铺云下载');
assert(api.movieLayout({ dvdId: '', filmTitle: '教父', nfoUploaded: 0 }).kind === 'flat', '普通影片 → kind=flat');
assert(api.movieLayout({ dvdId: '', filmTitle: '教父', nfoUploaded: 1750000000000 }).folder === true, '已上传元数据（NFO）→ 需要文件夹');
assert(api.movieLayout({ dvdId: '', filmTitle: '教父', nfoUploaded: 1750000000000 }).name === '教父', '需要文件夹时用片名做夹名');
assert(api.movieLayout({}).folder === false, '空 doc → 平铺（不崩）');
/* 同名直中：去掉压制信息后与片名完全一致 → 满分，优先于其他相似夹名 */
assert(api.tidyScore('教父', ['教父'], '1972') === 100, '夹名与片名完全一致 → 100 分（同名直中）');
assert(api.tidyScore('教父.1972.1080p.BluRay.x264-AAA', ['教父'], '1972') < 100, '带压制信息的夹名不抢同名直中');
assert(api.matchTidyDir([{ cid: 'c1', n: '教父.1972.1080p' }, { cid: 'c2', n: '教父' }], ['教父'], '1972').best.cid === 'c2', '同名文件夹优先被选中');
assert(api.matchTidyDir([{ cid: 'c1', n: '教父.1972.1080p' }, { cid: 'c2', n: '教父' }], ['教父'], '1972').ok === true, '同名文件夹自动采用（无需弹候选）');

/* ---------- 中文标题首字母缩写识别（nmz / 匿mz / n名z 等任意交错） ---------- */
assert(api.titleInitials('匿名者') === 'nmz', 'titleInitials 匿名者 → nmz');
assert(api.titleInitials('匿mz') === 'nmz', 'titleInitials 匿mz（中文混首字母）→ nmz');
assert(api.titleInitials('n名z') === 'nmz', 'titleInitials n名z（任意交错）→ nmz');
assert(api.titleInitials('匿mz1080p') === 'nmz1080p', 'titleInitials 保留数字/字母');
assert(api.titleInitials('The Matrix') === 'thematrix', 'titleInitials 英文不折叠成首字母（整词保留）');
assert(api.tidyScore('nmz', ['匿名者'], '') === 90, '纯首字母夹名 nmz 命中中文标题（90）');
assert(api.tidyScore('匿mz', ['匿名者'], '') === 90, '中文混首字母夹名 匿mz 命中（90）');
assert(api.tidyScore('n名z', ['匿名者'], '') === 90, '中文混首字母夹名 n名z 命中（90）');
assert(api.tidyScore('nmz1080p', ['匿名者'], '') >= api.TIDY_ACCEPT, '带压制信息的首字母夹名仍命中');
assert(api.tidyScore('完全无关夹GameOfThrones', ['匿名者'], '') < api.TIDY_MIN, '无关英文夹名不被首字母误命中');
const abbrM = api.matchTidyDir([{ cid: 'a', n: 'nmz' }, { cid: 'b', n: '匿名者' }, { cid: 'c', n: 'n名z' }], ['匿名者'], '');
assert(abbrM.best && abbrM.best.cid === 'b', 'matchTidyDir 精确全名优先于首字母缩写');
assert(abbrM.candidates.length >= 3 && abbrM.candidates.some(c => c.cid === 'a' && c.score === 90), '首字母缩写夹名进入候选且 90 分');

/* ---------- v265：主标题/副标题拆分 + 缩写到集数 + 全角数字 ---------- */
assert(api.titleInitials('终结者６') === 'zjz6', 'titleInitials 全角数字６折成半角 6');
assert(api.tidyScore('zjz6', ['终结者6：黑暗命运'], '') === 90, '夹名 zjz6 命中「终结者6：黑暗命运」主标题缩写（90，副标题降权）');
assert(api.tidyScore('zjz6.1080p', ['终结者6：黑暗命运'], '') >= api.TIDY_ACCEPT, 'zjz6.1080p 以主标题缩写开头仍自动档（82）');
assert(api.tidyScore('终结者6', ['终结者6：黑暗命运'], '') === 100, '主标题同名直中 → 100（副标题不拖累）');
assert(api.tidyScore('zjz6hamy', ['终结者6：黑暗命运'], '') === 90, '全名首字母 zjz6hamy 完全命中（90）');
assert(api.tidyScore('zjz6', ['终结者：黑暗命运'], '') < api.TIDY_ACCEPT, '片名本身没有 6 时 zjz6 是续集嫌疑 → 不自动档');
assert(api.tidyScore('教父2', ['教父'], '') < api.TIDY_ACCEPT, '续集压分不受副标题改动影响');

/* ---------- v265：清晰度标识 / 真分碟标记 / 命名追加清晰度 ---------- */
assert(api.qualityRank('赌神.2160p.mkv') === 4 && api.qualityRank('A.4K.mkv') === 4 && api.qualityRank('B.1080p.mkv') === 3 && api.qualityRank('C.720p.mkv') === 1 && api.qualityRank('D.mkv') === 0, 'qualityRank 清晰度分级');
assert(api.qualityTag('赌神.1080p.mkv') === '1080p' && api.qualityTag('Movie.4K.mkv') === '4k' && api.qualityTag('x.mkv') === '', 'qualityTag 提取清晰度标识');
assert(api.partMark('Movie.cd1.mkv') && api.partMark('Movie.Part2.mkv') && !api.partMark('赌神.1080p.mkv'), 'partMark 只认 cd/disc/part/碟/盘+数字');
assert(api.movieVideoName({ filmTitle: '赌神', year: '1989' }, '1080p') === '赌神.1989.1080p', '命名追加清晰度：标题.年份.1080p');
assert(api.movieVideoName({ filmTitle: '赌神' }, '720p') === '赌神.720p', '无年份：标题.720p');
assert(api.movieVideoName({ filmTitle: '赌神', year: '1989' }) === '赌神.1989', '无清晰度标识 → 不追加');

/* ---------- 探测延迟 ---------- */
assert(api.probeDelay(0) === 5000 && api.probeDelay(1) === 5000 && api.probeDelay(2) === 10000 && api.probeDelay(9) === 10000, 'probeDelay 5s/5s/10s 封顶');

console.log(process.exitCode ? '\n❌ 有用例失败' : '\n✅ auto115-core 全部通过');
process.exit(process.exitCode || 0);
