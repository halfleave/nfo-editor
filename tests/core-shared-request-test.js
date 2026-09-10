#!/usr/bin/env node
/* core-shared 请求路由测试 —— 覆盖 F1 tmdbRequest / F3 translateRequest 的混合模型：
 *   ① 自填 key / ownCfg 优先 → 直连（不占服务端配额、不受档位限流）
 *   ② 无自填 → 回退 Worker 代理，并按契约带 ?code= 供 Worker 定位档位
 *   ③ 缺配置（无 key 也无 Worker）→ 正确 reject
 * 用桩 fetch 拦截请求、断言 URL/method/body，全程不触真实接口（符合隔离测试约束）。
 * 运行：node tests/core-shared-request-test.js （已挂 tools/check.js）
 */
const NfoCore = require('../src/core-shared.js').NfoCore;

// —— 桩：拦截 fetch，记录 url/method/body，按路径返回对应 JSON 形态 ——
let calls = [];
function stubFetch(url, init) {
  calls.push({ url: String(url), init: init || {} });
  let payload;
  if (/\/chat\/completions$/.test(url)) {
    // 对齐 translateMeta 期望：choices[0].message.content 是 JSON 字符串
    payload = { choices: [{ message: { content: JSON.stringify({ title: 'T', summary: 'S' }) } }] };
  } else if (/\/translate(\?|$)/.test(url)) {
    payload = { title: 'W', summary: 'Q' };
  } else {
    payload = { title: 'T', summary: 'S' };
  }
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload), text: () => Promise.resolve('') });
}

// tmdbRequest 内部引用全局 TMDB_API_BASE；测试进程需先注入（与宿主 app 顶层 var 一致）
global.TMDB_API_BASE = 'https://api.themoviedb.org/3';
global.fetch = stubFetch;

let failed = 0;
function ok(name) { console.log('PASS ' + name); }
function bad(name, detail) { failed++; console.log('FAIL ' + name + (detail ? ' :: ' + detail : '')); }
function eq(name, cond, detail) { cond ? ok(name) : bad(name, detail); }
async function expectReject(name, p, re) {
  try { await p; bad(name, 'expected rejection'); }
  catch (e) { (re.test(e.message) ? ok : bad)(name, re.test(e.message) ? '' : 'wrong msg: ' + e.message); }
}

(async function () {
  /* —— F1 tmdbRequest 路由 —— */
  // 1. 自填 ownKey → 直连 TMDB（带 api_key，不走 /tmdb 代理、不带 code）
  calls = [];
  await NfoCore.tmdbRequest('/search/movie', { query: 'foo', language: 'zh-CN' }, { ownKey: 'OWNKEY', timeout: 500 })
    .then(function (r) {
      eq('tmdb/自填key: 仅 1 次请求', calls.length === 1);
      eq('tmdb/自填key: 直连 api.themoviedb.org', calls[0].url.indexOf('https://api.themoviedb.org/3/search/movie') === 0);
      eq('tmdb/自填key: 带 api_key', /[?&]api_key=OWNKEY/.test(calls[0].url));
      eq('tmdb/自填key: 不走 /tmdb 代理', calls[0].url.indexOf('/tmdb') === -1);
      eq('tmdb/自填key: 不带 code', calls[0].url.indexOf('code=') === -1);
      eq('tmdb/自填key: 返回 JSON', !!r && r.title === 'T');
    });

  // 2. 无 ownKey + Worker + code → 走 /tmdb 代理并带 code（Worker 侧据此套配额/鉴权）
  calls = [];
  await NfoCore.tmdbRequest('/movie/123', { append_to_response: 'videos' }, { workerBase: 'https://w.example.com', code: 'FULL123', timeout: 500 })
    .then(function (r) {
      eq('tmdb/Worker: 走 /tmdb 代理', calls[0].url.indexOf('https://w.example.com/tmdb/movie/123') === 0);
      eq('tmdb/Worker: 带 code', /[?&]code=FULL123/.test(calls[0].url));
      eq('tmdb/Worker: 不直连 TMDB', calls[0].url.indexOf('api.themoviedb.org') === -1);
      eq('tmdb/Worker: 返回 JSON', !!r && r.title === 'T');
    });

  // 3. 无 ownKey 且缺 Worker → reject（前端 UI 此时应引导填 key 或升级）
  await expectReject('tmdb/缺配置: 正确 reject', NfoCore.tmdbRequest('/x', {}, {}), /未配置 TMDB/);

  /* —— F3 translateRequest 路由 —— */
  // 4. 自填 ownCfg 完整 → 直连 LLM（translateMeta），POST 且请求体含 model
  calls = [];
  await NfoCore.translateRequest('Foo タイトル', '日本語のあらすじ', {
    ownCfg: { baseUrl: 'https://llm.example.com/v1/chat/completions', apiKey: 'K', model: 'agnes-2.5-flash' }, timeout: 500
  }).then(function (r) {
    eq('translate/自填cfg: 仅 1 次请求', calls.length === 1);
    eq('translate/自填cfg: 直连 chat/completions', calls[0].url === 'https://llm.example.com/v1/chat/completions');
    eq('translate/自填cfg: POST', calls[0].init.method === 'POST');
    const body = JSON.parse(calls[0].init.body);
    eq('translate/自填cfg: 请求体含 model', body.model === 'agnes-2.5-flash');
    eq('translate/自填cfg: 原文进 messages', body.messages[1].content.indexOf('Foo タイトル') > -1);
    eq('translate/自填cfg: 返回清洗后结果', !!r && r.title === 'T' && r.summary === 'S');
  });

  // 5. 无 ownCfg + Worker + code → POST /translate?code=（仅高级档由 Worker 放行）
  calls = [];
  await NfoCore.translateRequest('Foo', 'bar', { workerBase: 'https://w.example.com', code: 'FULL123', timeout: 500 })
    .then(function (r) {
      eq('translate/Worker: POST /translate?code=', calls[0].url === 'https://w.example.com/translate?code=FULL123');
      eq('translate/Worker: POST', calls[0].init.method === 'POST');
      const body = JSON.parse(calls[0].init.body);
      eq('translate/Worker: 体含 title/plot', body.title === 'Foo' && body.plot === 'bar');
      eq('translate/Worker: 返回清洗后结果', !!r && r.title === 'W' && r.summary === 'Q');
    });

  // 6. 翻译结果清洗：标题半角括号被 stripTitleParens 去除、简介被 cleanTranslatedText trim
  const prevFetch = global.fetch;
  global.fetch = function (url, init) {
    calls = []; calls.push({ url: String(url), init: init || {} });
    const payload = (/\/translate/.test(url)) ? { title: '(OAV)Foo 标题', summary: '  中文简介  ' } : { title: 'T' };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload), text: () => Promise.resolve('') });
  };
  await NfoCore.translateRequest('Foo', 'bar', { workerBase: 'https://w.example.com', code: 'FULL123', timeout: 500 })
    .then(function (r) {
      eq('translate/清洗: 标题括号被剥离', r.title === 'Foo 标题');
      eq('translate/清洗: 简介 trim', r.summary === '中文简介');
    });
  global.fetch = prevFetch;

  // 7. 无 ownCfg 且缺 Worker → reject（对齐 6.3 矩阵：中/免费无自填 key 不能走服务端翻译）
  await expectReject('translate/缺配置: 正确 reject', NfoCore.translateRequest('a', 'b', {}), /未配置翻译/);

  console.log('core-shared-request ' + (failed ? ('有 ' + failed + ' 项失败') : '全通过'));
  if (failed) process.exitCode = 1;
})();
