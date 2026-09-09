/* 隔离测试：115 自动化六步状态机（桩 DOM + 桩 115 接口） */
const fs = require('fs');
const vm = require('vm');
const SRC_DIR = '/Users/leavehalf/Downloads/work/NFO/nfo-editor/src/';
const coreSrc = fs.readFileSync(SRC_DIR + 'auto115-core.js', 'utf8');
const src = fs.readFileSync(SRC_DIR + 'ui-ios.js', 'utf8');

/* ---- DOM 桩 ---- */
const mkEl = () => ({
  style: {}, dataset: {}, textContent: '', innerHTML: '', value: '',
  classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
  addEventListener(){}, removeEventListener(){}, appendChild(){}, removeChild(){},
  querySelector(){ return null; }, querySelectorAll(){ return []; },
  setAttribute(){}, getAttribute(){ return null; }, closest(){ return null; }
});
const ctx = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: (f) => setTimeout(f, 0),
  cancelAnimationFrame(){},
};
const elCache = {};
const document_ = {
  getElementById: (id) => (elCache[id] || (elCache[id] = mkEl())),
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener(){}, createElement: mkEl, body: mkEl(), documentElement: mkEl()
};
Object.assign(ctx, {
  document: document_,
  addEventListener(){}, removeEventListener(){},
  navigator: { userAgent: 'test' },
  localStorage: { getItem: () => null, setItem(){}, removeItem(){} },
  fetch: () => Promise.reject(new Error('no net')),
  crypto: require('crypto').webcrypto,
  TextEncoder, TextDecoder, btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  BigInt, Uint8Array, Uint32Array, DataView, ArrayBuffer,
  URLSearchParams, Promise, Date, Math, JSON, Error, Array, Object, String, Number, Boolean, RegExp,
  encodeURIComponent, decodeURIComponent
});
const noop = function(){ return {}; };
// core-shared.js 的桩：默认一律 noop；但 isAvFilm 是「影片/AV 统一区分」的核心逻辑，必须给真实实现，
// 否则 ui-ios.js 内 `var isAvFilm = NfoCore.isAvFilm` 会捕获到 noop，导致分类断言失真。
ctx.NfoCore = new Proxy({ isAvFilm: (f) => !!(f && f.data && f.data.dvdId) }, { get: (t, k) => (k in t ? t[k] : noop) });
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
/* 先加载真实 Auto115Core（纯逻辑单点真相），再加载 ui-ios.js —— 后者的纯函数均转发 core */
vm.runInContext(coreSrc, ctx, { filename: 'auto115-core.js' });
try { vm.runInContext(src, ctx, { filename: 'ui-ios.js' }); }
catch (e) { console.log('LOAD WARN:', e.message); }
/* bootApp 定时器在 crypto 异步等待期间会触发，补齐其依赖的 state 字段防崩（state 为 let 声明，需在 vm 作用域内补） */
try { vm.runInContext('state.countries = state.countries || []; state.genres = state.genres || []; console.log("[DBG] vm内 state.countries=", JSON.stringify(state.countries));', ctx); } catch (e) { console.log('[DBG] 补丁异常:', e.message); }

/* ---- 桩：IndexedDB / toast / 115 代理 ---- */
const store = {};
ctx.idbGet = (s, k) => Promise.resolve(store[k]);
ctx.idbPut = (s, k, v) => { store[k] = JSON.parse(JSON.stringify(v)); return Promise.resolve(); };
const toasts = [];
ctx.showToast = (m, t) => toasts.push((t || '') + ':' + m);
ctx.escapeHtml = (s) => String(s == null ? '' : s);
ctx.switchPage = () => {};
ctx.state = { c115Cookie: 'UID=1;CID=2;SEID=3', countries: [], genres: [] }; /* 覆盖 vm 的 state（var 声明=ctx 属性），需带 bootApp 依赖的数组字段 */
ctx.currentDetailFilm = { id: 'film1', data: { title: '测试影片', dvdId: 'IPX-486' } };

/* 115 接口响应剧本 */
let script = {};
let calls = [];
ctx.c115ProxyFetch = async function (url, opts) {
  calls.push({ url, body: opts && opts.body, opts });
  const hit = Object.keys(script).find(k => url.indexOf(k) >= 0);
  const r = hit ? script[hit] : { state: true };
  let d = typeof r === 'function' ? r(calls.filter(c => c.url === url).length, url, opts || {}) : r;
  d = await d;
  if (d && d.__bin != null) return { ok: true, status: 200, d: {}, raw: '', bin: d.__bin };
  return { ok: true, status: 200, d, raw: JSON.stringify(d) };
};

const assert = (cond, msg) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + msg); if (!cond) process.exitCode = 1; };

/* 番号规则统一回归：影片/AV 的唯一区分标准是「是否含番号（dvdId）」，与分级/来源/TMDB 标志无关 */
assert(ctx.isAvFilm({ data: { dvdId: 'IPX-486' } }) === true, 'isAvFilm: 有番号 → AV');
assert(ctx.isAvFilm({ data: { dvdId: '' } }) === false, 'isAvFilm: 空番号 → 影片');
assert(ctx.isAvFilm({ data: {} }) === false, 'isAvFilm: 无 data.dvdId → 影片');
assert(ctx.isAvFilm({}) === false, 'isAvFilm: 无 data 对象 → 影片');
assert(ctx.isAvFilm({ data: { dvdId: 'ABC-123' }, adult: false }) === true, 'isAvFilm: 有番号且 adult=false → 仍判 AV（不看 adult 字段）');
assert(ctx.isAvFilm({ data: {}, adult: true }) === false, 'isAvFilm: 无番号且 adult=true → 仍判影片（不看 adult 字段）');

/* 字面量 LZ4 块编码（token + 扩展长度 + 原始字节），供加密回包构造用 */
const lz4LiteralForTest = (bytes) => {
  const out = [];
  if (bytes.length < 15){ out.push(bytes.length << 4); }
  else { out.push(0xF0); let x = bytes.length - 15; while (x >= 255){ out.push(255); x -= 255; } out.push(x); }
  for (const b of bytes) out.push(b);
  return new Uint8Array(out);
};

(async () => {
  /* 1. 大状态文案 */
  const t0 = { id: 'x', steps: ctx.auto115NewSteps(), magnet: 'magnet:?xt=urn:btih:AAA' };
  assert(ctx.auto115Status(t0).text === '待提交', '初始状态 = 待提交');
  ctx.auto115GetStep(t0, 'submit').state = 'running';
  assert(ctx.auto115Status(t0).text === '提交中…', '提交中');
  ctx.auto115GetStep(t0, 'submit').state = 'ok';
  const w = ctx.auto115GetStep(t0, 'wait'); w.state = 'running'; w.probes = 1;
  assert(ctx.auto115Status(t0).text === '离线中 (2/3)', '离线中 (2/3)');
  w.state = 'waiting'; w.probes = 3;
  assert(ctx.auto115Status(t0).text === '等待中 · 已探 3/3', '等待中 · 已探 3/3');
  w.state = 'ok';
  ctx.auto115GetStep(t0, 'mkdir').state = 'running';
  assert(ctx.auto115Status(t0).text === '整理中 · 定位文件夹', '整理中 · 定位文件夹');
  ctx.auto115GetStep(t0, 'mkdir').state = 'ok';
  ctx.auto115GetStep(t0, 'move').state = 'fail';
  assert(ctx.auto115Status(t0).text === '失败 · 清理文件', '失败步 → 失败 · 清理文件');

  /* 2. 完整六步成功流程（v2：定位文件夹 → 清理 → 改视频名 → 改文件夹名） */
  const NOW_SEC = Math.floor(Date.now() / 1000);
  script = {
    'ac=add_task_url': { state: true, info_hash: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01', name: '测试磁力' },
    'ac=task_lists': { tasks: [{ info_hash: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01', name: '测试磁力', percentDone: 100, status: 2, cid: 'ROOTCID' }] },
    'files?cid=3311283881428122938': { state: true, data: [
      { cid: 'DIR888', n: '旧文件夹', t: NOW_SEC - 86400 },        // 时间窗外，不应选中
      { cid: 'DIR777', n: 'xxx.mp4', t: NOW_SEC - 7200 },          // 名字像文件但是旧文件夹，不应选中
      { cid: 'DIR999', n: '测试磁力', t: NOW_SEC }                 // 名称精确匹配 → 选中
    ] },
    'files?cid=DIR999': { state: true, data: [
      { fid: 'F1', n: 'a.mp4', s: 100 },
      { fid: 'F2', n: 'movie.mkv', s: 900 },
      { fid: 'F3', n: 'sample.mp4', s: 5000 },
      { cid: 'SUB1', n: 'subs', t: NOW_SEC }                       // 子文件夹也应被清理
    ] },
    'files/edit': { state: true },
    'rb/delete': { state: true }
  };
  const doc = await ctx.auto115EnsureDoc();
  const t = { id: 't1', magnet: 'magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01', magnetTitle: '测试磁力', steps: ctx.auto115NewSteps(), createdAt: Date.now(), fv: 2 };
  doc.tasks.unshift(t);
  await ctx.auto115Run(t);
  const g = (k) => ctx.auto115GetStep(t, k).state;
  assert(g('submit') === 'ok', '步骤1 提交离线 = ok');
  assert(g('wait') === 'ok', '步骤2 等待离线完成 = ok');
  assert(g('mkdir') === 'ok', '步骤3 定位文件夹 = ok');
  assert(t.offlineDirCid === 'DIR999', '定位到 DIR999（名称匹配，未被 xxx.mp4 干扰）');
  assert(g('move') === 'ok', '步骤4 清理文件 = ok');
  assert(t.videoFid === 'F2', '保留最大视频 F2');
  const delCall = calls.find(c => c.url.indexOf('rb/delete') >= 0);
  assert(delCall && delCall.body.indexOf('F1') >= 0 && delCall.body.indexOf('F3') >= 0 && delCall.body.indexOf('SUB1') >= 0, '删除了 F1/F3/SUB1');
  assert(delCall && delCall.body.split('DIR999').length === 2 && delCall.body.indexOf('pid=DIR999') >= 0, 'DIR999 仅作为 pid 出现，未删文件夹本身');
  assert(g('rename') === 'ok', '步骤5 修改视频名称 = ok');
  assert(ctx.auto115GetStep(t, 'rename').msg.indexOf('IPX-486.mkv') >= 0, '改名为 IPX-486.mkv：' + ctx.auto115GetStep(t, 'rename').msg);
  assert(g('cleanup') === 'ok', '步骤6 修改文件夹名称 = ok');
  assert(ctx.auto115GetStep(t, 'cleanup').msg.indexOf('测试影片') >= 0, '文件夹改名（始终取标题）「测试影片」：' + ctx.auto115GetStep(t, 'cleanup').msg);
  assert(ctx.auto115Status(t).text === '已完成', '任务终态 = 已完成');

  /* 2b. 单文件磁力（AV，有番号）：无文件夹落地 → move 跳过，但 AV 需要文件夹 → 建好后把视频移进去 */
  script['files/add'] = { state: true, data: { cid: 'AVDIR' } };
  script['files?cid=AVDIR'] = { state: true, data: [] };
  script['files?cid=3311283881428122938'] = { state: true, data: [
    { fid: 'F9', n: '测试磁力', s: 123, t: NOW_SEC }
  ] };
  const t5 = { id: 't5', magnet: 'magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef02', magnetTitle: '单文件磁力', steps: ctx.auto115NewSteps(), createdAt: Date.now(), fv: 2 };
  doc.tasks.unshift(t5);
  await ctx.auto115Run(t5);
  const g5 = (k) => ctx.auto115GetStep(t5, k).state;
  assert(g5('mkdir') === 'ok' && ctx.auto115GetStep(t5, 'mkdir').msg.indexOf('单文件') >= 0, '单文件落地识别');
  assert(g5('move') === 'skip', '清理步骤自动跳过（单文件无杂物）');
  assert(g5('rename') === 'ok' && ctx.auto115GetStep(t5, 'rename').msg.indexOf('IPX-486.mp4') >= 0, '单文件改名为 IPX-486.mp4：' + ctx.auto115GetStep(t5, 'rename').msg);
  assert(g5('cleanup') === 'ok' && ctx.auto115GetStep(t5, 'cleanup').msg.indexOf('测试影片') >= 0, 'AV 单文件 → 建好文件夹再收进去：' + ctx.auto115GetStep(t5, 'cleanup').msg);
  assert(calls.some(c => c.url.indexOf('files/move') >= 0 && decodeURIComponent(c.body || '').indexOf('fid=F9') >= 0 && decodeURIComponent(c.body || '').indexOf('pid=AVDIR') >= 0), 'AV 单文件 → 视频移进新建的文件夹');
  assert(ctx.auto115Status(t5).text === '已完成', '单文件任务终态 = 已完成');

  /* 2c. 多 part 影片：cd1/cd2 全部保留，不误删第二张碟 */
  script = {
    'ac=add_task_url': { state: true, name: '多碟影片' },
    'ac=task_lists': { tasks: [{ info_hash: 'MULTI', name: '多碟影片', percentDone: 100, status: 2, cid: 'ROOTCID' }] },
    'files?cid=3311283881428122938': { state: true, data: [ { cid: 'DIRM', n: '多碟影片', t: NOW_SEC } ] },
    'files?cid=DIRM': { state: true, data: [
      { fid: 'M1', n: 'Movie.cd1.mkv', s: 900 },
      { fid: 'M2', n: 'Movie.cd2.mkv', s: 880 },
      { fid: 'M3', n: 'sample.mp4', s: 5000 }
    ] },
    'files/edit': { state: true },
    'rb/delete': { state: true }
  };
  doc.dvdId = ''; doc.filmTitle = '多碟影片'; doc.originalTitle = ''; doc.year = '';
  const tmov = { id: 'tmov', magnet: 'magnet:?xt=urn:btih:multi', magnetTitle: '多碟影片', steps: ctx.auto115NewSteps(), createdAt: Date.now(), fv: 2 };
  doc.tasks.unshift(tmov);
  ctx.auto115GetStep(tmov, 'mkdir').state = 'ok';
  tmov.offlineDirCid = 'DIRM'; tmov.offlineDirName = '多碟影片';
  calls.length = 0;
  await ctx.auto115StepMove(tmov);
  assert(ctx.auto115GetStep(tmov, 'move').state === 'ok', '多 part 清理 = ok');
  assert(tmov.keepFids && tmov.keepFids.length === 2, '保留 2 个视频（cd1+cd2），实际=' + (tmov.keepFids || []).length);
  assert(tmov.keepFids.indexOf('M1') >= 0 && tmov.keepFids.indexOf('M2') >= 0, '保留 M1/M2 两张碟');
  const delM = calls.find(c => c.url.indexOf('rb/delete') >= 0);
  assert(delM && delM.body.indexOf('M3') >= 0 && delM.body.indexOf('M1') < 0 && delM.body.indexOf('M2') < 0, '只删 sample(M3)，保留 cd1/cd2');
  doc.dvdId = 'IPX-486'; doc.filmTitle = '测试影片'; doc.originalTitle = ''; doc.year = '';

  /* 3. 探测 3 次后转「等待中」（直接驱动探测步，不等真实 10s 定时器） */
  script['ac=task_lists'] = () => ({ tasks: [{ info_hash: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01', percentDone: 10, status: 1 }] });
  const t2 = { id: 't2', magnet: 'magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01', magnetTitle: '慢速磁力', steps: ctx.auto115NewSteps(), infoHash: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01' };
  doc.tasks.unshift(t2);
  for (let i = 0; i < 3; i++) await ctx.auto115StepWait(t2, i === 0);
  const w2 = ctx.auto115GetStep(t2, 'wait');
  assert(w2.probes === 3, '连探 3 次 probes=' + w2.probes);
  assert(w2.state === 'waiting', '3 次后 → waiting（等待中），实际=' + w2.state);
  assert(ctx.auto115Status(t2).text === '等待中 · 已探 3/3', '徽章 = 等待中 · 已探 3/3');
  // 手动「继续探测」→ 计数重置并再探
  await ctx.auto115ContinueProbe(t2.id);
  assert(ctx.auto115GetStep(t2, 'wait').state === 'running', '继续探测后回到 running');
  assert(ctx.auto115GetStep(t2, 'wait').probes === 1, '继续探测后计数重置为 1');

  /* 4. 失败 → 可重试定位到失败步 */
  const t3 = { id: 't3', steps: ctx.auto115NewSteps(), magnetTitle: '失败任务' };
  ctx.auto115GetStep(t3, 'submit').state = 'ok';
  ctx.auto115GetStep(t3, 'wait').state = 'ok';
  ctx.auto115GetStep(t3, 'mkdir').state = 'fail';
  assert(ctx.auto115Status(t3).text === '失败 · 定位文件夹', '失败定位到「定位文件夹」');

  /* 5. 影片（无番号）→ 按「标题」改名（不再因无番号中断） */
  const t4 = { id: 't4', steps: ctx.auto115NewSteps(), videoFid: 'F9', videoName: 'x.mp4' };
  doc.dvdId = '';
  await ctx.auto115StepRename(t4);
  assert(ctx.auto115GetStep(t4, 'rename').state === 'ok', '影片（无番号）按标题改名 = ok');
  assert(ctx.auto115GetStep(t4, 'rename').msg.indexOf('测试影片.mp4') >= 0, '改名为 测试影片.mp4：' + ctx.auto115GetStep(t4, 'rename').msg);
  doc.dvdId = 'IPX-486';
  /* 5b. 影片命名规则：标题.原始标题.年份 / 原始标题空格转点 / 标题=原始标题→标题.年份 / 无年份→仅标题 */
  doc.dvdId = '';
  doc.filmTitle = '盗梦空间'; doc.originalTitle = 'Inception'; doc.year = '2010';
  const t6 = { id: 't6', steps: ctx.auto115NewSteps(), videoFid: 'F9', videoName: 'x.mkv' };
  await ctx.auto115StepRename(t6);
  assert(ctx.auto115GetStep(t6, 'rename').state === 'ok' && ctx.auto115GetStep(t6, 'rename').msg.indexOf('盗梦空间.Inception.2010.mkv') >= 0, '影片命名 = 标题.原始标题.年份：' + ctx.auto115GetStep(t6, 'rename').msg);
  doc.originalTitle = 'The Lord of the Rings';
  const t7 = { id: 't7', steps: ctx.auto115NewSteps(), videoFid: 'F9', videoName: 'x.mkv' };
  await ctx.auto115StepRename(t7);
  assert(ctx.auto115GetStep(t7, 'rename').msg.indexOf('盗梦空间.The.Lord.of.the.Rings.2010.mkv') >= 0, '原始标题空格转点：' + ctx.auto115GetStep(t7, 'rename').msg);
  doc.filmTitle = 'Inception'; doc.originalTitle = 'Inception';
  const t8 = { id: 't8', steps: ctx.auto115NewSteps(), videoFid: 'F9', videoName: 'x.mkv' };
  await ctx.auto115StepRename(t8);
  assert(ctx.auto115GetStep(t8, 'rename').msg.indexOf('Inception.2010.mkv') >= 0, '标题=原始标题 → 标题.年份：' + ctx.auto115GetStep(t8, 'rename').msg);
  doc.filmTitle = '测试影片'; doc.originalTitle = ''; doc.year = '2010';
  const t9 = { id: 't9', steps: ctx.auto115NewSteps(), videoFid: 'F9', videoName: 'x.mkv' };
  await ctx.auto115StepRename(t9);
  assert(ctx.auto115GetStep(t9, 'rename').msg.indexOf('测试影片.2010.mkv') >= 0, '无原始标题、有年份 → 标题.年份：' + ctx.auto115GetStep(t9, 'rename').msg);
  doc.filmTitle = '测试影片'; doc.originalTitle = ''; doc.year = '';
  const t10 = { id: 't10', steps: ctx.auto115NewSteps(), videoFid: 'F9', videoName: 'x.mp4' };
  await ctx.auto115StepRename(t10);
  assert(ctx.auto115GetStep(t10, 'rename').msg.indexOf('测试影片.mp4') >= 0, '无年份 → 仅标题：' + ctx.auto115GetStep(t10, 'rename').msg);
  doc.dvdId = 'IPX-486';

  /* 6. 上传 NFO/海报/剧照 链路（115 4.0 加密通道：uploadinfo → initupload(ECDH+AES) → getuploadinfo → gettoken → OSS PUT） */
  ctx.dataUrlToBytesSync = (u) => (typeof u === 'string' && u.indexOf('data:') === 0) ? new Uint8Array([1, 2, 3]) : null;
  ctx.loadFilm = () => Promise.resolve({ id: 'film1', data: { title: '测试影片', dvdId: 'IPX-486', poster: 'data:image/jpeg;base64,AA', fanart: 'data:image/jpeg;base64,AA' } });
  /* ui-ios.js:5526 是 `var sanitizeName = NfoCore.sanitizeName`，而 NfoCore 被桩成一律返回 {} 的 noop，
     不补这个桩的话 sanitizeName(标题) 会返回空对象（上传任务据此定文件夹名，会永远匹配不上）。
     此处按 core-shared.js:19 的真实实现补桩。 */
  ctx.sanitizeName = (s) => (s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim() || 'movie';
  ctx.buildNFOMovieXml = () => '<movie><title>测试影片</title></movie>';

  /* 6a. 加密层单元断言 */
  assert(ctx.c115Md5('abc') === '900150983cd24fb0d6963f7d28e17f72', 'MD5 标准向量');
  assert(ctx.c115Crc32(new TextEncoder().encode('123456789')) === 0xcbf43926, 'CRC32 标准向量');
  {
    const G = { x: ctx.C115_P224.gx, y: ctx.C115_P224.gy };
    assert(ctx.c115P224IsOnCurve(G), 'P-224 基点在曲线上（验证曲线常量）');
    const G2 = ctx.c115P224Double(G);
    assert(ctx.c115P224IsOnCurve(G2) && ctx.c115P224Add(G, G).x === G2.x && ctx.c115P224Add(G, G).y === G2.y, 'G+G = 2G 且在曲线上');
    const d1 = 0x123456789abcdef0fedcba9876543210abcdef0123456789n;
    const dG = ctx.c115P224Mul(d1, G);
    assert(ctx.c115P224Add(dG, ctx.c115P224Mul(ctx.C115_P224.n - d1, G)) === null, 'kG + (n-k)G = 无穷远点');
    const a1 = 0x11111111111111111111111111111111111111111111111111111111n;
    const b1 = 0x22222222222222222222222222222222222222222222222222222222n;
    const A1 = ctx.c115P224Mul(a1, G), B1 = ctx.c115P224Mul(b1, G);
    assert(ctx.c115P224Mul(a1, B1).x === ctx.c115P224Mul(b1, A1).x, 'ECDH 双方共享密钥一致');
  }
  {
    const orig = new TextEncoder().encode('{"status":1,"statuscode":0,"bucket":"bkt","object":"obj/123","callback":{"callback":"cfg","callback_var":"vars"}}');
    const lz = [0xF0]; let x = orig.length - 15; while (x >= 255){ lz.push(255); x -= 255; } lz.push(x);
    for (const by of orig) lz.push(by);
    assert(Buffer.from(ctx.c115Lz4Decompress(new Uint8Array(lz))).equals(Buffer.from(orig)), 'LZ4 全字面量块解压');
    const m = ctx.c115Lz4Decompress(new Uint8Array([0x74, 0x61, 0x61, 0x61, 0x61, 0x61, 0x61, 0x61, 0x01, 0x00]));
    assert(Buffer.from(m).toString() === 'a'.repeat(15), 'LZ4 匹配块解压（7 字面量 + 8 匹配）');
  }
  {
    /* 6a-2. 纯 JS AES-128 解密：S盒 + FIPS-197 块向量 + NIST CBC 向量 */
    const hexToBytes = (h) => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
    const eq = (a, b) => Buffer.from(a).equals(Buffer.from(b));
    assert(ctx.C115_AES_SBOX[0x00] === 0x63 && ctx.C115_AES_SBOX[0x01] === 0x7c && ctx.C115_AES_SBOX[0x53] === 0xed && ctx.C115_AES_SBOX[0xff] === 0x16, 'AES S盒生成正确（0x63/0x7c/0xed/0x16）');
    const rk = ctx.c115AesExpandKey(hexToBytes('000102030405060708090a0b0c0d0e0f'));
    const pt = ctx.c115AesDecryptBlock(hexToBytes('69c4e0d86a7b0430d8cdb78070b4c55a'), rk);
    assert(eq(pt, hexToBytes('00112233445566778899aabbccddeeff')), 'AES-128 块解密 = FIPS-197 向量');
    const cbc = ctx.c115CbcDecryptManual(
      hexToBytes('2b7e151628aed2a6abf7158809cf4f3c'),
      hexToBytes('000102030405060708090a0b0c0d0e0f'),
      hexToBytes('7649abac8119b246cee98e9b12e9197df76b0fe9ee288e5ece09e8854b4c26fe')
    );
    assert(eq(cbc.subarray(0, 16), hexToBytes('6bc1bee22e409f96e93d7e117393172a')), '纯 JS CBC 解密 = NIST SP 800-38A 向量');
  }
  {
    /* 6a-3. 回包截断：真实 115 回包长度非 16 倍数（实测 156），截断后应可解密 */
    const e2 = await ctx.c115EcdhGet();
    const v2 = e2.variants[e2.active];
    const respJson = new TextEncoder().encode('{"status":1,"statuscode":0,"bucket":"B","object":"O","callback":{"callback":"c"}}');
    const lz = lz4LiteralForTest(respJson);
    const payload = new Uint8Array(2 + lz.length);
    payload[0] = lz.length & 0xFF; payload[1] = (lz.length >> 8) & 0xFF; payload.set(lz, 2);
    const ct = new Uint8Array(await ctx.c115AesCbc(v2.key, v2.iv, payload, true));
    const padded = new Uint8Array(ct.length + 12); /* 尾部加 12 字节杂物，模拟非 16 倍数回包 */
    padded.set(ct);
    const decText = await ctx.c115EcdhDecrypt(padded);
    assert(JSON.parse(decText).status === 1, '回包长度非 16 倍数 → 截断后解密成功');
  }

  /* 6b. 上传任务（type=upload，2026-09-08：上传独立成任务，不再挂在离线任务上）
         准备文件夹（按影片标题在云下载目录查找 → 没有才创建）→ 逐个上传并刷新进度 */
  ctx.state.c115Open = { access: 'TEST_OPEN_TOKEN', exp: Date.now() + 3600000 }; // 有效 token，避免触发 refreshToken
  let initCalls, putCalls, legacyCalls, mkdirCalls, listCalls;
  const mkUploadScript = (dirList) => {
    initCalls = []; putCalls = []; legacyCalls = []; mkdirCalls = []; listCalls = [];
    return {
      'files?cid=': () => { listCalls.push(1); return { state: true, data: dirList }; },
      'files/add': () => { mkdirCalls.push(1); return { state: true, data: { cid: 'NEWDIR' } }; },
      'open/upload/init': (n, url, opts) => {
        initCalls.push({ url, body: opts && opts.body, xs: opts && opts.xs });
        return { state: true, code: 0, data: { status: 1, code: 0, pick_code: 'PC', bucket: 'BKT115', object: 'OBJ/123',
          callback: { callback: '{"callbackUrl":"http://uplb.115.com/3.0/completeupload.php"}', callback_var: '{"x:pick_code":"PC"}' } } };
      },
      'open/upload/get_token': { state: true, code: 0, data: {
        endpoint: 'https://oss-cn-test.aliyuncs.com', AccessKeyId: 'AKID', AccessKeySecret: 'AKSEC', SecurityToken: 'STSTOK' } },
      'oss-cn-test': (n, url, opts) => { putCalls.push({ url, method: opts.method, xs: opts.xs, body: opts.body }); return { state: true, code: 0 }; },
      '4.0/initupload': (n, url) => { legacyCalls.push(url); return { state: true }; }
    };
  };
  const mkUploadTask = (id) => ({ id, type: 'upload', steps: ctx.auto115NewSteps('upload'), createdAt: Date.now(), fv: 2 });

  // A. 云下载目录里没有同名文件夹 → 创建后上传
  script = mkUploadScript([{ cid: 'OTHERDIR', n: '别的文件夹' }]);
  const tu = mkUploadTask('tu1');
  doc.tasks.unshift(tu);
  await ctx.auto115StepUploadDir(tu);
  assert(listCalls.length === 1, '先列一次云下载目录，实际=' + listCalls.length);
  assert(mkdirCalls.length === 1, '没找到同名文件夹 → 创建 1 次，实际=' + mkdirCalls.length);
  assert(tu.uploadDirCid === 'NEWDIR', '用新建文件夹的 cid，实际=' + tu.uploadDirCid);
  assert(ctx.auto115GetStep(tu, 'dir').state === 'ok', 'dir 步 = ok');
  assert(initCalls.length === 3, '开放平台 init 3 次（nfo/poster/fanart），实际=' + initCalls.length);
  assert(initCalls[0].body.indexOf('file_name=IPX-486.nfo') >= 0, 'init 表单含 file_name=番号.nfo');
  assert(initCalls[0].body.indexOf('target=U_1_NEWDIR') >= 0, 'init 表单 target=U_1_新建目录');
  assert(initCalls[0].body.indexOf('fileid=') >= 0 && initCalls[0].body.indexOf('preid=') >= 0, 'init 表单含 fileid/preid（SHA1 秒传签名）');
  assert(initCalls[0].xs && initCalls[0].xs.Authorization === 'Bearer TEST_OPEN_TOKEN', 'init 带 Bearer access_token');
  assert(legacyCalls.length === 0, '未回退 4.0 逆向通道（实际调用 ' + legacyCalls.length + ' 次）');
  assert(putCalls.length === 3, 'OSS PUT 发出 3 次，实际=' + putCalls.length);
  const pu = putCalls[0];
  assert(pu.method === 'PUT' && pu.url.indexOf('BKT115.oss-cn-test.aliyuncs.com/OBJ/123') >= 0,
    'PUT URL = bucket.endpoint/object（OSS 子域名风格，实际=' + pu.url + '）');
  assert(pu.xs && pu.xs.Authorization && pu.xs.Authorization.indexOf('OSS AKID:') === 0, 'PUT 带 OSS V1 签名 Authorization');
  assert(pu.xs['x-oss-security-token'] === 'STSTOK' && pu.xs['x-oss-callback'] && pu.xs['x-oss-callback-var'], 'PUT 带 security-token/callback/callback-var 头');
  assert(tu.nfoUploaded > 0, '上传成功后任务标记 nfoUploaded');
  assert(ctx.auto115Status(tu).text === '已完成', '上传完成 → 大状态「已完成」，实际=' + ctx.auto115Status(tu).text);
  assert(toasts.some(m => m.indexOf('已上传 3 个文件') >= 0), 'toast 提示已上传 3 个文件');

  // B. 已有同名文件夹 → 直接复用，不再创建
  script = mkUploadScript([{ cid: 'EXISTDIR', n: '测试影片' }]);
  const tu2 = mkUploadTask('tu2');
  doc.tasks.unshift(tu2);
  await ctx.auto115StepUploadDir(tu2);
  assert(mkdirCalls.length === 0, '已有同名文件夹 → 不创建，实际=' + mkdirCalls.length);
  assert(tu2.uploadDirCid === 'EXISTDIR', '复用已有文件夹 cid，实际=' + tu2.uploadDirCid);
  assert(initCalls.length === 3 && initCalls[0].body.indexOf('target=U_1_EXISTDIR') >= 0, '复用时上传到已有目录');
  assert(putCalls.length === 3, '复用时也上传 3 个文件');

  /* 7. 并入模式：同影片第二个磁力 → 移入已有标题文件夹，改名 番号.A.ext，删除临时文件夹 */
  script = {
    'files?cid=DIR999': { state: true, data: [ { fid: 'F2', n: 'Some.Torrent.Folder-xxx.mkv', s: 800 } ] },
    'files?cid=DIR777': { state: true, data: [ { fid: 'F0', n: 'IPX-486.mp4', s: 900 } ] },
    'files/move': { state: true },
    'files/edit': { state: true },
    'rb/delete': { state: true }
  };
  const tp = { id: 'tp0', magnet: 'magnet:?xt=urn:btih:1111111111111111111111111111111111111111', magnetTitle: '第一个磁力', steps: ctx.auto115NewSteps(), createdAt: Date.now() - 86400000, offlineDirCid: 'DIR777', offlineDirName: '测试影片', fv: 2 };
  for (let i = 0; i < tp.steps.length; i++){ tp.steps[i].state = 'ok'; }
  doc.tasks.unshift(tp);
  const tm = { id: 'tm1', magnet: 'magnet:?xt=urn:btih:2222222222222222222222222222222222222222', magnetTitle: '第二个磁力', steps: ctx.auto115NewSteps(), createdAt: Date.now(), offlineDirCid: 'DIR999', offlineDirName: 'Some.Torrent.Folder-xxx', videoFid: 'F2', videoName: 'Some.Torrent.Folder-xxx.mkv', fv: 2 };
  ['submit', 'wait', 'mkdir'].forEach(k => { ctx.auto115GetStep(tm, k).state = 'ok'; });
  doc.tasks.unshift(tm);
  calls.length = 0;
  /* 方案 B：cleanup 第 4 步识别并入目标 → skip → 联动 move → rename（移入+删临时夹） */
  await ctx.auto115StepCleanup(tm);
  assert(ctx.auto115GetStep(tm, 'cleanup').state === 'skip', '并入任务 cleanup 标记 skip（不改临时夹名）');
  const mvCall = calls.find(c => c.url.indexOf('files/move') >= 0);
  assert(!!mvCall && mvCall.body.indexOf('fid=F2') >= 0 && mvCall.body.indexOf('pid=DIR777') >= 0, '视频移入已有文件夹 DIR777');
  const editCall = calls.find(c => c.url.indexOf('files/edit') >= 0);
  assert(editCall && decodeURIComponent(editCall.body).indexOf('IPX-486.A.mkv') >= 0, '第二个视频改名 番号.A.ext（番号.ext 已被占）');
  assert(tm.finalDirCid === 'DIR777' && tm.videoName === 'IPX-486.A.mkv', '任务记录 finalDirCid 与最终视频名');
  const delCall2 = calls.find(c => c.url.indexOf('rb/delete') >= 0);
  assert(delCall2 && delCall2.body.indexOf('fid=DIR999') >= 0, '已删除临时文件夹 DIR999');
  assert(ctx.auto115Status(tm).text === '已完成', '并入任务终态 = 已完成');
  /* 再来第三个 → 番号.B */
  const tn = { id: 'tn1', magnet: 'magnet:?xt=urn:btih:3333333333333333333333333333333333333333', magnetTitle: '第三个磁力', steps: ctx.auto115NewSteps(), createdAt: Date.now(), offlineDirCid: 'DIR555', offlineDirName: 'Another.Torrent', videoFid: 'F3', videoName: 'Another.Torrent.mkv', fv: 2 };
  ['submit', 'wait', 'mkdir', 'move'].forEach(k => { ctx.auto115GetStep(tn, k).state = 'ok'; });
  doc.tasks.unshift(tn);
  script['files?cid=DIR777'] = { state: true, data: [ { fid: 'F0', n: 'IPX-486.mp4', s: 900 }, { fid: 'F2', n: 'IPX-486.A.mkv', s: 800 } ] };
  calls.length = 0;
  await ctx.auto115StepRename(tn);
  const editCall2 = calls.find(c => c.url.indexOf('files/edit') >= 0);
  assert(editCall2 && decodeURIComponent(editCall2.body).indexOf('IPX-486.B.mkv') >= 0, '第三个视频改名 番号.B.ext');
  assert(tn.finalDirCid === 'DIR777', '第三个任务同样并入 DIR777');

  /* 8. 排队串行化：同时点两个 115 离线 → 第二个排队，第一个终态后自动续跑 */
  script = { 'ac=add_task_url': { state: true, info_hash: 'H2', name: '排队任务' } };
  /* 清掉前面用例遗留的 running 步骤，模拟「当前没有任务在跑」 */
  (doc.tasks || []).forEach(function(x){ (x.steps || []).forEach(function(s){ if (s.state === 'running') s.state = 'ok'; }); });
  const tq = { id: 'tq2', magnet: 'magnet:?xt=urn:btih:4444444444444444444444444444444444444444', magnetTitle: '排队任务', steps: ctx.auto115NewSteps(), createdAt: Date.now(), fv: 2 };
  const tp0 = { id: 'tp0', magnet: 'magnet:?xt=urn:btih:0000000000000000000000000000000000000000', magnetTitle: '第一个任务', steps: ctx.auto115NewSteps(), createdAt: Date.now(), fv: 2 };
  ctx.auto115GetStep(tp0, 'wait').state = 'running';   // 模拟正在跑
  doc.tasks.unshift(tp0);
  doc.tasks.unshift(tq);
  ctx.auto115RunningId = 'tp0';
  await ctx.auto115Run(tq);
  assert(tq.queued === true, '同时启动第二个任务 → 转入排队');
  assert(ctx.auto115GetStep(tq, 'submit').msg.indexOf('排队中') >= 0, '排队提示可见');
  assert(ctx.auto115GetStep(tq, 'submit').state === 'idle', '排队期间不提交离线');
  ctx.auto115GetStep(tp0, 'wait').state = 'ok';     // 终态：模拟第一个任务跑完
  ctx.auto115Finish(ctx.auto115Task('tp0'));   // 第一个任务到达终态
  assert(ctx.auto115RunningId === 'tq2', '第一个任务终态后队列推进到排队任务');
  await Promise.resolve();   // 等 ensure115Cookie 的 .then 微任务（不引入宏任务，避免唤醒桩 DOM 的启动定时器）
  assert(ctx.auto115GetStep(tq, 'submit').state === 'running', '排队任务自动开始提交离线');

  /* 9. 剧集（TV）离线分支：判定 / 中文数字解析 / 集数标记（含中文数字）/ 字幕语言取舍 / 命名 / 分发 */
  assert(ctx.auto115Doc.type === 'movie' || ctx.auto115Doc.type === 'tv', 'auto115Doc.type 字段存在（默认 movie/tv 二选一）');
  // 9a. 中文数字 → 阿拉伯
  assert(ctx.auto115CnNum('一') === 1, 'CnNum 一=1');
  assert(ctx.auto115CnNum('十') === 10, 'CnNum 十=10');
  assert(ctx.auto115CnNum('十二') === 12, 'CnNum 十二=12');
  assert(ctx.auto115CnNum('二十一') === 21, 'CnNum 二十一=21');
  assert(ctx.auto115CnNum('二十三') === 23, 'CnNum 二十三=23');
  assert(ctx.auto115CnNum('九十九') === 99, 'CnNum 九十九=99');
  assert(ctx.auto115CnNum('100') === 100, 'CnNum 阿拉伯 100=100');
  assert(ctx.auto115CnNum('abc') === null, 'CnNum 非数字=null');

  // 9b. 集数标记解析（含大陆老剧「第一集」「第一季」）
  let ep;
  ep = ctx.auto115EpisodeOf('Game.of.Thrones.S01E01.mkv'); assert(ep && ep.season === 1 && ep.episode === 1, 'Ep S01E01 → 1/1');
  ep = ctx.auto115EpisodeOf('Show.1x03.mkv'); assert(ep && ep.season === 1 && ep.episode === 3, 'Ep 1x03 → 1/3');
  ep = ctx.auto115EpisodeOf('[05] Something.mkv'); assert(ep && ep.season === 1 && ep.episode === 5, 'Ep [05] → 1/5');
  ep = ctx.auto115EpisodeOf('EP07.mkv'); assert(ep && ep.season === 1 && ep.episode === 7, 'Ep EP07 → 1/7');
  ep = ctx.auto115EpisodeOf('第一集.mp4'); assert(ep && ep.season === 1 && ep.episode === 1, 'Ep 第一集 → 1/1');
  ep = ctx.auto115EpisodeOf('第十二集.mp4'); assert(ep && ep.season === 1 && ep.episode === 12, 'Ep 第十二集 → 1/12');
  ep = ctx.auto115EpisodeOf('第二十三集.mp4'); assert(ep && ep.season === 1 && ep.episode === 23, 'Ep 第二十三集 → 1/23');
  ep = ctx.auto115EpisodeOf('权力的游戏.第一季.第三集.mkv'); assert(ep && ep.season === 1 && ep.episode === 3, 'Ep 第一季第三集 → 1/3');
  ep = ctx.auto115EpisodeOf('第2季第5集.mkv'); assert(ep && ep.season === 2 && ep.episode === 5, 'Ep 第2季第5集 → 2/5');
  ep = ctx.auto115EpisodeOf('第一季.mkv'); assert(ep && ep.season === 1 && ep.episode === null, 'Ep 仅季号 → 1/null');
  ep = ctx.auto115EpisodeOf('random.mkv'); assert(ep === null, 'Ep 无标记 → null（留给顺序兜底）');

  // 9c. 字幕语言：仅中文保留
  assert(ctx.auto115SubLang('Show.S01E01.chs.srt') === 'zh', 'Sub 简中 chs → zh');
  assert(ctx.auto115SubLang('Show.S01E01.zh.srt') === 'zh', 'Sub .zh → zh');
  assert(ctx.auto115SubLang('Show.S01E01.cht.srt') === 'zt', 'Sub 繁中 cht → zt');
  assert(ctx.auto115SubLang('Show.S01E01.zt.srt') === 'zt', 'Sub .zt → zt');
  assert(ctx.auto115SubLang('Show.S01E01.eng.srt') === null, 'Sub 英文 → null（不保留）');
  assert(ctx.auto115SubLang('Show.S01E01.jp.srt') === null, 'Sub 日文字幕 → null（不保留）');

  // 9d. 命名格式
  assert(ctx.auto115TvVideoName('权力的游戏', 1, 1, '.mkv') === '权力的游戏.S01E01.mkv', 'TV 视频名 = 标题.S01E01.ext');
  assert(ctx.auto115TvSubName('权力的游戏', 1, 3, 'zh', '.srt') === '权力的游戏.S01E03.zh.srt', 'TV 字幕名 = 标题.S01E03.zh.srt');

  // 9e. 纯函数规划：标记优先 + 简中保留/英文删除
  const planTv = ctx.auto115TvPlan('Show', [
    { fid: 'V1', name: 'Show.S01E01.mkv' },
    { fid: 'V2', name: 'Show.S01E02.mkv' },
    { fid: 'SU1', name: 'Show.S01E01.chs.srt' },
    { fid: 'SU2', name: 'Show.S01E02.eng.srt' },
    { fid: 'J1', name: 'sample.mp4' }
  ]);
  const rn = (fid) => { const r = planTv.renames.find(x => x.fid === fid); return r ? r.name : null; };
  assert(rn('V1') === 'Show.S01E01.mkv', 'TV plan V1 → Show.S01E01.mkv');
  assert(rn('V2') === 'Show.S01E02.mkv', 'TV plan V2 → Show.S01E02.mkv');
  assert(rn('SU1') === 'Show.S01E01.zh.srt', 'TV plan 简中字幕保留并重命名');
  assert(planTv.deleteFids.indexOf('SU2') >= 0, 'TV plan 英文字幕进删除列表');
  assert(planTv.deleteFids.indexOf('J1') >= 0, 'TV plan sample 进删除列表');
  assert(planTv.deleteFids.indexOf('SU1') < 0, 'TV plan 简中字幕不删除');

  // 9f. 中文数字集号 + 无标记顺序兜底
  const planCn = ctx.auto115TvPlan('老剧', [
    { fid: 'A', name: '老剧.第一集.mp4' },
    { fid: 'B', name: '老剧.第二集.mp4' },
    { fid: 'C', name: '老剧.第三集.mp4' }
  ]);
  assert(planCn.renames.find(x => x.fid === 'A').name === '老剧.S01E01.mp4', 'TV plan 第一集 → S01E01');
  assert(planCn.renames.find(x => x.fid === 'B').name === '老剧.S01E02.mp4', 'TV plan 第二集 → S01E02');
  assert(planCn.renames.find(x => x.fid === 'C').name === '老剧.S01E03.mp4', 'TV plan 第三集 → S01E03');

  // 9g. 集成：剧集离线新流程端到端（方案 B：改标题文件夹 → 清除无关文件 → 建 S01 → 改名 → 移入）
  ctx.auto115Doc.type = 'tv'; ctx.auto115Doc.filmTitle = '权力的游戏'; ctx.auto115Doc.dvdId = '';
  let listTvCalls = 0;
  script = {
    'ac=add_task_url': { state: true, name: '剧集磁力' },
    'files?cid=DIRTV': function(){
      listTvCalls++;
      if (listTvCalls === 1){
        return { state: true, data: [
          { fid: 'V1', n: 'GoT.S01E01.mkv', s: 900 },
          { fid: 'V2', n: 'GoT.S01E02.mkv', s: 900 },
          { fid: 'SU1', n: 'GoT.S01E01.chs.srt', s: 10 },
          { fid: 'SU2', n: 'GoT.S01E02.eng.srt', s: 10 },
          { fid: 'J1', n: 'sample.mp4', s: 5000 }
        ] };
      }
      return { state: true, data: [] };   // 第二次：检查 S01 是否存在，返回空
    },
    'files/add': { state: true, data: { cid: 'SEASON01' } },
    'files/move': { state: true },
    'files/edit': { state: true },
    'rb/delete': { state: true }
  };
  const ttv = { id: 'ttv', magnet: 'magnet:?xt=urn:btih:tv1111111111111111111111111111111111111', magnetTitle: '剧集磁力', steps: ctx.auto115NewSteps(), createdAt: Date.now(), offlineDirCid: 'DIRTV', offlineDirName: 'GoT', fv: 2 };
  ['submit', 'wait', 'mkdir'].forEach(k => { ctx.auto115GetStep(ttv, k).state = 'ok'; });
  calls.length = 0;
  /* 方案 B：cleanup 第 4 步先改标题文件夹，再联动后续步骤 */
  await ctx.auto115StepCleanup(ttv);
  assert(ctx.auto115GetStep(ttv, 'cleanup').state === 'ok', 'TV 修改标题文件夹 cleanup = ok（先定容器）');
  assert(ctx.auto115GetStep(ttv, 'move').state === 'ok', 'TV 清除无关文件 move = ok');
  assert(ctx.auto115GetStep(ttv, 'mkdir2').state === 'skip', 'TV 只有一季 → 不分季（mkdir2 skip）');
  assert(ctx.auto115GetStep(ttv, 'rename').state === 'ok', 'TV 修改视频名称 rename = ok（命名仍带 SxxExx）');
  assert(ctx.auto115GetStep(ttv, 'move2').state === 'skip', 'TV 不分季时文件留在剧集根文件夹（move2 skip）');
  const editBodies = calls.filter(c => c.url.indexOf('files/edit') >= 0).map(c => decodeURIComponent(c.body || ''));
  assert(editBodies.some(b => b.indexOf('权力的游戏.S01E01.mkv') >= 0), '改名含 权力的游戏.S01E01.mkv');
  assert(editBodies.some(b => b.indexOf('权力的游戏.S01E02.mkv') >= 0), '改名含 权力的游戏.S01E02.mkv');
  assert(editBodies.some(b => b.indexOf('权力的游戏.S01E01.zh.srt') >= 0), '简中字幕重命名为 权力的游戏.S01E01.zh.srt');
  assert(editBodies.some(b => b.indexOf('file_name=权力的游戏') >= 0), '标题文件夹改名为 权力的游戏');
  const moveBodies = calls.filter(c => c.url.indexOf('files/move') >= 0).map(c => decodeURIComponent(c.body || ''));
  assert(!calls.some(c => c.url.indexOf('files/add') >= 0), '只有一季时不新建季文件夹');
  assert(!moveBodies.some(b => b.indexOf('pid=SEASON01') >= 0), '只有一季时不移入季文件夹（平铺在剧集根）');
  const delBodies = calls.filter(c => c.url.indexOf('rb/delete') >= 0).map(c => decodeURIComponent(c.body || ''));
  assert(delBodies.some(b => b.indexOf('SU2') >= 0), '删除英文字幕 SU2');
  assert(delBodies.some(b => b.indexOf('J1') >= 0), '删除 sample J1');
  assert(!delBodies.some(b => b.indexOf('SU1') >= 0), '不删除简中字幕 SU1');
  ctx.auto115Doc.type = 'movie'; ctx.auto115Doc.filmTitle = '测试影片'; ctx.auto115Doc.dvdId = 'IPX-486';

  // 9h. 脏 runningId 自动清理：runningId 指向已完成/已删任务时，新任务应能启动（不死锁）
  ctx.currentDetailFilm = { id: 'filmTv2', data: { title: '权力的游戏', media_type: 'tv', tmdbMediaType: 'tv', dvdId: '', originaltitle: '', year: '2026', premiered: '2026-01-01' } };
  ctx.auto115Doc = null;
  const docTv2 = await ctx.auto115EnsureDoc();
  const oldDone = { id: 'oldDone', magnet: 'magnet:?xt=urn:btih:OLD', magnetTitle: 'old', steps: ctx.auto115NewSteps(), createdAt: Date.now(), fv: 2 };
  oldDone.steps.forEach(s => s.state = 'ok');
  docTv2.tasks = [oldDone];
  ctx.auto115RunningId = 'oldDone';
  const tNew = { id: 'tNew', magnet: 'magnet:?xt=urn:btih:tv1111111111111111111111111111111111111', magnetTitle: '剧集磁力', steps: ctx.auto115NewSteps(), createdAt: Date.now(), fv: 2 };
  docTv2.tasks.unshift(tNew);
  calls.length = 0;
  await ctx.auto115Run(tNew);
  assert(ctx.auto115GetStep(tNew, 'submit').state === 'ok', '脏 runningId（已完成任务）被自动清理，新 TV 任务提交成功');
  // ghost runningId（指向已删任务）
  ctx.auto115RunningId = 'ghost';
  const tNew2 = { id: 'tNew2', magnet: 'magnet:?xt=urn:btih:tv2222222222222222222222222222222222222', magnetTitle: '剧集磁力2', steps: ctx.auto115NewSteps(), createdAt: Date.now(), fv: 2 };
  docTv2.tasks.unshift(tNew2);
  await ctx.auto115Run(tNew2);
  assert(ctx.auto115GetStep(tNew2, 'submit').state === 'ok', '脏 runningId（不存在任务）被自动清理，新 TV 任务提交成功');
  ctx.currentDetailFilm = { id: 'film1', data: { title: '测试影片', dvdId: 'IPX-486' } };
  ctx.auto115Doc = null;

  // 9i. 「卡在待提交」兜底：① 占着锁却没在跑（超宽限期）→ 自动释放  ② 手动「开始」→ 强制抢锁立刻跑
  script = { 'ac=add_task_url': { state: true, info_hash: 'HK', name: 'KickTask' } };
  ctx.currentDetailFilm = { id: 'filmTv3', data: { title: '落魄剧集', media_type: 'tv', tmdbMediaType: 'tv', dvdId: '', year: '2025' } };
  ctx.auto115Doc = null;
  const docTv3 = await ctx.auto115EnsureDoc();
  const stuck = { id: 'stuck', magnet: 'magnet:?xt=urn:btih:stuck000000000000000000000000000000000000', magnetTitle: '卡住的任务', steps: ctx.auto115NewSteps(), createdAt: Date.now(), fv: 2 };
  docTv3.tasks = [stuck];
  ctx.auto115RunningId = 'stuck';
  ctx.auto115LockAt = Date.now() - 60000;   // 占锁已超 45s 宽限，且没有任何 running 步骤 → 脏锁
  const tKick = { id: 'tKick', magnet: 'magnet:?xt=urn:btih:tv3333333333333333333333333333333333333', magnetTitle: '待提交任务', steps: ctx.auto115NewSteps(), createdAt: Date.now(), fv: 2 };
  docTv3.tasks.unshift(tKick);
  await ctx.auto115Run(tKick);
  assert(ctx.auto115GetStep(tKick, 'submit').state === 'ok', '占着锁不跑的脏锁被释放，新任务正常提交（不再永久待提交）');
  // ② 手动「开始」：即使有别的任务在跑，也直接抢锁开始这一条
  const busy = { id: 'busy', magnet: 'magnet:?xt=urn:btih:busy0000000000000000000000000000000000000', magnetTitle: '正在跑的任务', steps: ctx.auto115NewSteps(), createdAt: Date.now(), fv: 2 };
  ctx.auto115GetStep(busy, 'wait').state = 'running';
  docTv3.tasks.unshift(busy);
  ctx.auto115RunningId = 'busy'; ctx.auto115LockAt = Date.now();
  const tForce = { id: 'tForce', magnet: 'magnet:?xt=urn:btih:tv4444444444444444444444444444444444444', magnetTitle: '手动点火任务', steps: ctx.auto115NewSteps(), createdAt: Date.now(), fv: 2 };
  docTv3.tasks.unshift(tForce);
  const pForce = ctx.auto115ForceStart('tForce');
  await Promise.resolve();   // 让 ensure115Cookie 的回调先落地（抢锁发生在那里）
  assert(ctx.auto115RunningId === 'tForce', '手动「开始」直接抢到执行锁');
  assert(ctx.auto115GetStep(tForce, 'submit').state === 'running', '手动「开始」后立刻进入提交（不再排队等待）');
  await pForce;
  // 9j. 僵尸步骤：某一步卡在 running 超过 10 分钟 → 判死，执行锁释放，队列不再被堵
  const zt = { id: 'zt', magnet: 'magnet:?xt=urn:btih:tv5555555555555555555555555555555555555', magnetTitle: '僵尸任务', steps: ctx.auto115NewSteps(), createdAt: Date.now(), fv: 2 };
  const zs = ctx.auto115GetStep(zt, 'submit');
  zs.state = 'running'; zs.at = Date.now() - 11 * 60 * 1000;
  docTv3.tasks.unshift(zt);
  ctx.auto115RunningId = 'zt'; ctx.auto115LockAt = Date.now() - 11 * 60 * 1000;
  ctx.auto115KickStuck();
  assert(ctx.auto115GetStep(zt, 'submit').state === 'fail', '卡死超 10 分钟的 running 步骤被判死（可重试）');
  assert(ctx.auto115RunningId === '', '僵尸任务占着的执行锁被释放');
  ctx.currentDetailFilm = { id: 'film1', data: { title: '测试影片', dvdId: 'IPX-486' } };
  ctx.auto115Doc = null;

  // 9k. 引用掉包回归：任务落库后 doc 被重新加载（任务换成反序列化副本），
  //     执行器手里拿旧引用跑，进度也必须落在 doc 里那条上（否则 115 已收到、界面却永远「待提交」）
  script = { 'ac=add_task_url': { state: true, info_hash: 'HR', name: 'RefTask' } };
  ctx.currentDetailFilm = { id: 'filmRef', data: { title: '引用测试', dvdId: 'IPX-999' } };
  ctx.auto115Doc = null;
  const docRef = await ctx.auto115EnsureDoc();
  const tRef = { id: 'tRef', magnet: 'magnet:?xt=urn:btih:ref11111111111111111111111111111111111111', magnetTitle: '引用任务', steps: ctx.auto115NewSteps(), createdAt: Date.now(), fv: 2 };
  docRef.tasks.unshift(tRef);
  await ctx.auto115Save();
  ctx.auto115Doc = null;
  await ctx.auto115EnsureDoc();                       // 重新加载 → doc 里的任务是新对象
  assert(ctx.auto115Task('tRef') !== tRef, '重新加载后 doc 里的任务是数据库反序列化出来的另一个对象');
  await ctx.auto115Run(tRef);                         // 执行器拿着旧引用
  const liveRef = ctx.auto115Task('tRef');
  assert(liveRef && liveRef !== tRef, '执行器已切回 doc 里的当前对象（不再是孤儿引用）');
  assert(ctx.auto115GetStep(liveRef, 'submit').state !== 'idle', '旧引用跑完后 doc 里那条的提交步骤已更新');
  assert(ctx.auto115Status(liveRef).text !== '待提交', '任务不再显示「待提交」');
  ctx.currentDetailFilm = { id: 'film1', data: { title: '测试影片', dvdId: 'IPX-486' } };
  ctx.auto115Doc = null;

  // 9m. 同名剧集夹已存在：cleanup 改名失败（该目录名称已存在）→ 并入同名夹整理，最后删临时夹
  ctx.currentDetailFilm = { id: 'filmTvMerge', data: { title: '师兄太稳健', dvdId: '' } };
  ctx.auto115Doc = null;
  const docTv = await ctx.auto115EnsureDoc();
  docTv.type = 'tv';
  const tTvM = { id: 'tTvM', magnet: 'magnet:?xt=urn:btih:tvm1111111111111111111111111111111111111', magnetTitle: '师兄太稳健26-30.2160p.HDR.60fps', steps: ctx.auto115NewSteps(), createdAt: Date.now(), offlineDirCid: 'DIRTVM', offlineDirName: '师兄太稳健26-30.2160p.HDR.60fps', fv: 2 };
  ['submit', 'wait', 'mkdir'].forEach(k => { ctx.auto115GetStep(tTvM, k).state = 'ok'; });
  docTv.tasks.unshift(tTvM);
  calls.length = 0;
  script = {
    'files?cid=3311283881428122938': { state: true, data: [ { cid: 'MERGE1', n: '师兄太稳健', t: NOW_SEC } ] },
    'files?cid=DIRTVM': { state: true, data: [ { fid: 'TV1', n: '第1集.mp4', s: 800 }, { fid: 'TV2', n: '第2集.mp4', s: 820 } ] },
    'files?cid=MERGE1': { state: true, data: [] },
    'files/add': { state: true, data: { cid: 'S01NEW' } },
    'files?cid=S01NEW': { state: true, data: [] },
    'files/move': { state: true },
    'files/edit': (n) => (n <= 1 ? { state: false, error: '该目录名称已存在' } : { state: true }),   /* 第1次=改标题夹（失败触发并入），后续=改视频名 */
    'rb/delete': { state: true }
  };
  await ctx.auto115StepCleanup(tTvM);
  assert(ctx.auto115GetStep(tTvM, 'cleanup').state === 'ok', 'TV 同名夹已存在：改标题文件夹转 ok（不失败）');
  assert(tTvM.tvMergeCid === 'MERGE1' && tTvM.finalDirCid === 'MERGE1', '并入目标为已存在的同名剧集夹');
  assert(ctx.auto115GetStep(tTvM, 'move').state === 'ok', '后续清理文件步骤继续执行');
  assert(ctx.auto115GetStep(tTvM, 'mkdir2').state === 'skip', '单季并入：不分季（mkdir2 skip）');
  assert(!calls.some(c => c.url.indexOf('files/add') >= 0), '单季并入时不新建季文件夹');
  assert(ctx.auto115GetStep(tTvM, 'rename').state === 'ok', '视频改名步骤 ok');
  assert(ctx.auto115GetStep(tTvM, 'move2').state === 'ok', '移入同名剧集夹步骤 ok');
  const mvCalls = calls.filter(c => c.url.indexOf('files/move') >= 0);
  assert(mvCalls.some(c => c.body.indexOf('pid=MERGE1') >= 0), '视频已平铺移入同名剧集夹 MERGE1');
  const editCallsM = calls.filter(c => c.url.indexOf('files/edit') >= 0).map(c => decodeURIComponent(c.body || ''));
  assert(editCallsM.some(b => b.indexOf('师兄太稳健.S01E01.mp4') >= 0), '平铺时命名仍带季集号 S01E01');
  const delTv = calls.find(c => c.url.indexOf('rb/delete') >= 0);
  assert(delTv && delTv.body.indexOf('fid=DIRTVM') >= 0, '完成后删除离线临时夹 DIRTVM');
  assert(ctx.auto115Status(tTvM).text === '已完成', '并入整理任务终态 = 已完成');
  ctx.currentDetailFilm = { id: 'film1', data: { title: '测试影片', dvdId: 'IPX-486' } };
  ctx.auto115Doc = null;

  // 9n. 分季阈值：多季但总集数不足阈值 → 平铺不分季；多季且达到阈值 → 才建季文件夹
  ctx.currentDetailFilm = { id: 'filmTvSplit', data: { title: '多季剧', media_type: 'tv', tmdbMediaType: 'tv', dvdId: '' } };
  ctx.auto115Doc = null;
  const docTvS = await ctx.auto115EnsureDoc();
  docTvS.type = 'tv';
  let listSplitCalls = 0;
  const SPLIT_FILES = [
    { fid: 'SV1', n: 'Show.S01E01.mkv', s: 900 },
    { fid: 'SV2', n: 'Show.S01E02.mkv', s: 900 },
    { fid: 'SV3', n: 'Show.S02E01.mkv', s: 910 },
    { fid: 'SV4', n: 'Show.S02E02.mkv', s: 910 }
  ];
  script = {
    'files?cid=DIRSPLIT': function(){
      listSplitCalls++;
      return { state: true, data: listSplitCalls === 1 ? SPLIT_FILES : [] };   /* 首次=扫描内容，之后=查 Sxx 是否已存在 */
    },
    'files/add': (n) => ({ state: true, data: { cid: n === 1 ? 'S01NEW' : 'S02NEW' } }),
    'files?cid=S01NEW': { state: true, data: [] },
    'files?cid=S02NEW': { state: true, data: [] },
    'files/move': { state: true },
    'files/edit': { state: true },
    'rb/delete': { state: true }
  };
  const mkSplitTask = (id) => ({ id: id, magnet: 'magnet:?xt=urn:btih:sp11111111111111111111111111111111111111', magnetTitle: '多季剧', steps: ctx.auto115NewSteps(), createdAt: Date.now(), offlineDirCid: 'DIRSPLIT', offlineDirName: '多季剧.S01-S02', fv: 2 });
  /* ① 默认阈值 100：2 季共 4 集 → 不足 100 集，平铺不分季 */
  const tSp1 = mkSplitTask('tSp1');
  docTvS.tasks.unshift(tSp1);
  calls.length = 0; listSplitCalls = 0;
  await ctx.auto115StepCleanup(tSp1);
  assert(ctx.auto115GetStep(tSp1, 'mkdir2').state === 'skip', '多季但总集数不足阈值 → 不分季（mkdir2 skip）');
  assert(!calls.some(c => c.url.indexOf('files/add') >= 0), '不足阈值时不新建季文件夹');
  const editSp1 = calls.filter(c => c.url.indexOf('files/edit') >= 0).map(c => decodeURIComponent(c.body || ''));
  assert(editSp1.some(b => b.indexOf('多季剧.S02E01.mkv') >= 0), '平铺不分季时命名仍带季集号（S02E01）');
  /* ② 阈值降到 3：2 季共 4 集 → 达到阈值，建季文件夹并移入（阈值单点真相在 Auto115Core.SPLIT_MIN_EPISODES） */
  ctx.Auto115Core.SPLIT_MIN_EPISODES = 3;
  const tSp2 = mkSplitTask('tSp2');
  docTvS.tasks.unshift(tSp2);
  calls.length = 0; listSplitCalls = 0;
  await ctx.auto115StepCleanup(tSp2);
  assert(ctx.auto115GetStep(tSp2, 'mkdir2').state === 'ok', '多季且达到阈值 → 建季文件夹（mkdir2 ok）');
  const addSp2 = calls.filter(c => c.url.indexOf('files/add') >= 0).map(c => decodeURIComponent(c.body || ''));
  assert(addSp2.length === 2 && addSp2.some(b => b.indexOf('cname=S01') >= 0) && addSp2.some(b => b.indexOf('cname=S02') >= 0), '新建 S01 与 S02 两个季文件夹');
  assert(ctx.auto115GetStep(tSp2, 'move2').state === 'ok', '达到阈值时移入对应季文件夹（move2 ok）');
  const mvSp2 = calls.filter(c => c.url.indexOf('files/move') >= 0).map(c => decodeURIComponent(c.body || ''));
  assert(mvSp2.some(b => b.indexOf('pid=S01NEW') >= 0) && mvSp2.some(b => b.indexOf('pid=S02NEW') >= 0), '视频分别移入 S01 / S02');
  ctx.Auto115Core.SPLIT_MIN_EPISODES = 100;

  /* 10. 文件整理任务（tidy）：云下载里已有文件 → 跳过离线两步，从定位文件夹开始跑改名整理 */
  script = {
    'files?cid=3311283881428122938': { state: true, data: [
      { cid: 'DIRT1', n: '整理测试片.2020.1080p.BluRay', t: Math.floor(Date.now() / 1000) }
    ] },
    'files?cid=DIRT1': { state: true, data: [
      { fid: 'V1', n: '乱七八糟的名字.1080p.mkv', s: 900 },
      { fid: 'S1', n: 'sample.mp4', s: 10 }
    ] },
    'files/edit': { state: true },
    'rb/delete': { state: true }
  };
  const docT = await ctx.auto115EnsureDoc();
  docT.dvdId = ''; docT.filmTitle = '整理测试片'; docT.originalTitle = ''; docT.year = '2020'; docT.type = 'movie';
  docT.tasks.length = 0;   // 隔离：清掉前面用例留下的任务（否则「并入已有文件夹」逻辑会介入）
  const tt = { id: 'ttidy', type: 'tidy', tidy: true, steps: ctx.auto115NewSteps(), createdAt: Date.now(), fv: 2 };
  docT.tasks.unshift(tt);
  /* 模拟点「文件整理」：在云下载里按标题命中 DIRT1 → 建任务（前两步标记跳过） */
  ctx.auto115Set(tt, 'submit', 'skip', '已有文件，跳过离线下载');
  ctx.auto115Set(tt, 'wait', 'skip', '已有文件，跳过离线下载');
  tt.offlineDirCid = 'DIRT1'; tt.offlineDirName = '整理测试片.2020.1080p.BluRay';
  await ctx.auto115Run(tt);
  assert(ctx.auto115GetStep(tt, 'submit').state === 'skip' && ctx.auto115GetStep(tt, 'wait').state === 'skip', '整理任务跳过离线两步');
  assert(ctx.auto115GetStep(tt, 'mkdir').state === 'ok', '整理任务定位文件夹 = ok');
  assert(ctx.auto115GetStep(tt, 'move').state === 'ok', '整理任务清理文件 = ok');
  assert(ctx.auto115GetStep(tt, 'cleanup').state === 'skip', '普通影片整理 → 不改夹名（播放器能自己刮削）');
  assert(ctx.auto115GetStep(tt, 'rename').state === 'ok' && ctx.auto115GetStep(tt, 'rename').msg.indexOf('整理测试片.2020.mkv') >= 0, '整理任务改视频名：' + ctx.auto115GetStep(tt, 'rename').msg);
  const mvFlat = calls.filter(c => c.url.indexOf('files/move') >= 0).map(c => decodeURIComponent(c.body || ''));
  assert(mvFlat.some(b => b.indexOf('fid=V1') >= 0 && b.indexOf('pid=3311283881428122938') >= 0), '普通影片整理 → 视频移到云下载根目录');
  assert(calls.some(c => c.url.indexOf('rb/delete') >= 0 && decodeURIComponent(c.body || '').indexOf('fid=DIRT1') >= 0), '视频移出后删掉空文件夹');
  assert(ctx.auto115Status(tt).text === '已完成', '整理任务终态 = 已完成');
  assert(ctx.auto115TaskTitle(tt).indexOf('整理：') === 0, '整理任务标题 = 整理：xxx');
  const tt2 = { id: 'ttidy2', tidy: true, steps: ctx.auto115NewSteps() };
  assert(ctx.auto115Status(tt2).text === '待整理', '未开跑的整理任务 = 待整理');
  /* 没有 cid 时（重试 / 数据丢失）→ 按标题重新匹配一次 */
  const tt3 = { id: 'ttidy3', type: 'tidy', tidy: true, steps: ctx.auto115NewSteps(), createdAt: Date.now(), fv: 2 };
  docT.tasks.unshift(tt3);
  await ctx.auto115StepTidyMkdir(tt3);
  assert(tt3.offlineDirCid === 'DIRT1', '整理任务兜底：按标题重新匹配到 DIRT1，实际=' + tt3.offlineDirCid);

  /* 10b. AV（有番号）整理 → 仍然收进文件夹：改夹名 + 视频按番号命名，不移出 */
  script = {
    'files?cid=3311283881428122938': { state: true, data: [ { cid: 'DIRT1', n: '整理测试片.2020.1080p.BluRay' } ] },
    'files?cid=DIRT1': { state: true, data: [ { fid: 'V2', n: '乱七八糟的名字.1080p.mkv', s: 900 } ] },
    'files/edit': { state: true }, 'rb/delete': { state: true }
  };
  docT.dvdId = 'ABC-123';
  calls.length = 0;
  const ttAv = { id: 'tav', type: 'tidy', tidy: true, steps: ctx.auto115NewSteps(), createdAt: Date.now(), fv: 2 };
  ttAv.offlineDirCid = 'DIRT1'; ttAv.offlineDirName = '整理测试片.2020.1080p.BluRay';
  docT.tasks.length = 0; docT.tasks.unshift(ttAv);
  await ctx.auto115Run(ttAv);
  assert(ctx.auto115GetStep(ttAv, 'cleanup').state === 'ok' && ctx.auto115GetStep(ttAv, 'cleanup').msg.indexOf('整理测试片') >= 0, 'AV 整理仍改夹名：' + ctx.auto115GetStep(ttAv, 'cleanup').msg);
  assert(ctx.auto115GetStep(ttAv, 'rename').msg.indexOf('ABC-123.mkv') >= 0, 'AV 整理视频按番号命名：' + ctx.auto115GetStep(ttAv, 'rename').msg);
  assert(!calls.some(c => c.url.indexOf('files/move') >= 0 && decodeURIComponent(c.body || '').indexOf('fid=V2') >= 0), 'AV 整理 → 视频留在文件夹里，不移出');
  docT.dvdId = '';

  /* 10c. 散装视频（直接躺在云下载、名字不规范）→ 整理只改名，不建文件夹 */
  script = {
    'files?cid=3311283881428122938': { state: true, data: [ { fid: 'V9', n: '乱七八糟的名字.mkv', s: 900 } ] },
    'files/edit': { state: true }, 'rb/delete': { state: true }
  };
  calls.length = 0;
  const ttLoose = { id: 'tloose', type: 'tidy', tidy: true, noFolder: true, steps: ctx.auto115NewSteps(), createdAt: Date.now(), fv: 2 };
  ttLoose.videoFid = 'V9'; ttLoose.videoName = '乱七八糟的名字.mkv'; ttLoose.videoSize = 900; ttLoose.keepFids = ['V9'];
  docT.tasks.length = 0; docT.tasks.unshift(ttLoose);
  await ctx.auto115Run(ttLoose);
  assert(ctx.auto115GetStep(ttLoose, 'mkdir').state === 'ok' && ctx.auto115GetStep(ttLoose, 'mkdir').msg.indexOf('已定位视频') >= 0, '散装视频整理 → 定位到视频：' + ctx.auto115GetStep(ttLoose, 'mkdir').msg);
  assert(ctx.auto115GetStep(ttLoose, 'rename').state === 'ok' && ctx.auto115GetStep(ttLoose, 'rename').msg.indexOf('整理测试片.2020.mkv') >= 0, '散装视频整理 → 改名：' + ctx.auto115GetStep(ttLoose, 'rename').msg);
  assert(!calls.some(c => c.url.indexOf('files/move') >= 0), '散装视频整理 → 不移动（本来就在根目录）');

  /* 10d. 先上传 NFO（已有同名文件夹）再整理散装视频 → 视频移进那个文件夹 */
  script = {
    'files?cid=3311283881428122938': { state: true, data: [
      { cid: 'NFODIR', n: '整理测试片' }, { fid: 'V9', n: '乱七八糟的名字.mkv', s: 900 }
    ] },
    'files?cid=NFODIR': { state: true, data: [ { fid: 'NFO1', n: '整理测试片.nfo', s: 2 } ] },
    'files/edit': { state: true }, 'rb/delete': { state: true }
  };
  calls.length = 0;
  docT.nfoUploaded = Date.now();
  const ttNfo = { id: 'tnfo', type: 'tidy', tidy: true, noFolder: true, steps: ctx.auto115NewSteps(), createdAt: Date.now(), fv: 2 };
  ttNfo.videoFid = 'V9'; ttNfo.videoName = '乱七八糟的名字.mkv'; ttNfo.videoSize = 900; ttNfo.keepFids = ['V9'];
  docT.tasks.length = 0; docT.tasks.unshift(ttNfo);
  await ctx.auto115Run(ttNfo);
  assert(ctx.auto115GetStep(ttNfo, 'cleanup').state === 'ok' && ctx.auto115GetStep(ttNfo, 'cleanup').msg.indexOf('整理测试片') >= 0, '已传 NFO → 整理时并入已有文件夹：' + ctx.auto115GetStep(ttNfo, 'cleanup').msg);
  assert(ctx.auto115GetStep(ttNfo, 'rename').state === 'ok' && ctx.auto115GetStep(ttNfo, 'rename').msg.indexOf('已移入「整理测试片」') >= 0, '散装视频移入 NFO 文件夹：' + ctx.auto115GetStep(ttNfo, 'rename').msg);
  docT.nfoUploaded = 0;

  ctx.currentDetailFilm = { id: 'film1', data: { title: '测试影片', dvdId: 'IPX-486' } };
  ctx.auto115Doc = null;

  console.log('\nTOASTS:', toasts.join(' | '));
  console.log(process.exitCode ? '\n❌ 有用例失败' : '\n✅ 全部通过');
  process.exit(process.exitCode || 0);
})();
