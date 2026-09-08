/* 隔离测试：115 自动化六步状态机（桩 DOM + 桩 115 接口） */
const fs = require('fs');
const vm = require('vm');
const path = '/Users/leavehalf/Downloads/work/NFO/nfo-editor/src/ui-ios.js';
const src = fs.readFileSync(path, 'utf8');

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
ctx.NfoCore = new Proxy({}, { get: () => noop });   // core-shared.js 的桩
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
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
  assert(ctx.auto115GetStep(t, 'cleanup').msg.indexOf('测试影片') >= 0, '文件夹改名为「测试影片」：' + ctx.auto115GetStep(t, 'cleanup').msg);
  assert(ctx.auto115Status(t).text === '已完成', '任务终态 = 已完成');

  /* 2b. 单文件磁力：无文件夹落地 → move/cleanup 自动 skip */
  script['files?cid=3311283881428122938'] = { state: true, data: [
    { fid: 'F9', n: '测试磁力', s: 123, t: NOW_SEC }
  ] };
  const t5 = { id: 't5', magnet: 'magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef02', magnetTitle: '单文件磁力', steps: ctx.auto115NewSteps(), createdAt: Date.now(), fv: 2 };
  doc.tasks.unshift(t5);
  await ctx.auto115Run(t5);
  const g5 = (k) => ctx.auto115GetStep(t5, k).state;
  assert(g5('mkdir') === 'ok' && ctx.auto115GetStep(t5, 'mkdir').msg.indexOf('单文件') >= 0, '单文件落地识别');
  assert(g5('move') === 'skip', '清理步骤自动跳过');
  assert(g5('rename') === 'ok' && ctx.auto115GetStep(t5, 'rename').msg.indexOf('IPX-486.mp4') >= 0, '单文件改名为 IPX-486.mp4');
  assert(g5('cleanup') === 'skip', '文件夹改名步骤跳过');
  assert(ctx.auto115Status(t5).text === '已完成', '单文件任务终态 = 已完成');

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

  /* 5. 番号为空 → 改名步失败提示 */
  const t4 = { id: 't4', steps: ctx.auto115NewSteps(), videoFid: 'F9', videoName: 'x.mp4' };
  doc.dvdId = '';
  await ctx.auto115StepRename(t4);
  assert(ctx.auto115GetStep(t4, 'rename').state === 'fail', '无番号 → 改名步失败');
  assert(ctx.auto115GetStep(t4, 'rename').msg.indexOf('没有番号') >= 0, '提示「没有番号」');
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
    'files?cid=DIR777': { state: true, data: [ { fid: 'F0', n: 'IPX-486.mp4', s: 900 } ] },
    'files/move': { state: true },
    'files/edit': { state: true },
    'rb/delete': { state: true }
  };
  const tp = { id: 'tp0', magnet: 'magnet:?xt=urn:btih:1111111111111111111111111111111111111111', magnetTitle: '第一个磁力', steps: ctx.auto115NewSteps(), createdAt: Date.now() - 86400000, offlineDirCid: 'DIR777', offlineDirName: '测试影片', fv: 2 };
  for (let i = 0; i < tp.steps.length; i++){ tp.steps[i].state = 'ok'; }
  doc.tasks.unshift(tp);
  const tm = { id: 'tm1', magnet: 'magnet:?xt=urn:btih:2222222222222222222222222222222222222222', magnetTitle: '第二个磁力', steps: ctx.auto115NewSteps(), createdAt: Date.now(), offlineDirCid: 'DIR999', offlineDirName: 'Some.Torrent.Folder-xxx', videoFid: 'F2', videoName: 'Some.Torrent.Folder-xxx.mkv', fv: 2 };
  ['submit', 'wait', 'mkdir', 'move'].forEach(k => { ctx.auto115GetStep(tm, k).state = 'ok'; });
  doc.tasks.unshift(tm);
  calls.length = 0;
  await ctx.auto115StepRename(tm);
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
  const tq = { id: 'tq2', magnet: 'magnet:?xt=urn:btih:4444444444444444444444444444444444444444', magnetTitle: '排队任务', steps: ctx.auto115NewSteps(), createdAt: Date.now(), fv: 2 };
  doc.tasks.unshift(tq);
  ctx.auto115RunningId = 'tp0';   // 假装第一个任务正在跑
  await ctx.auto115Run(tq);
  assert(tq.queued === true, '同时启动第二个任务 → 转入排队');
  assert(ctx.auto115GetStep(tq, 'submit').msg.indexOf('排队中') >= 0, '排队提示可见');
  assert(ctx.auto115GetStep(tq, 'submit').state === 'idle', '排队期间不提交离线');
  ctx.auto115Finish(ctx.auto115Task('tp0'));   // 第一个任务到达终态
  assert(ctx.auto115RunningId === 'tq2', '第一个任务终态后队列推进到排队任务');
  await Promise.resolve();   // 等 ensure115Cookie 的 .then 微任务（不引入宏任务，避免唤醒桩 DOM 的启动定时器）
  assert(ctx.auto115GetStep(tq, 'submit').state === 'running', '排队任务自动开始提交离线');

  console.log('\nTOASTS:', toasts.join(' | '));
  console.log(process.exitCode ? '\n❌ 有用例失败' : '\n✅ 全部通过');
  process.exit(process.exitCode || 0);
})();
