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
let reviewRaw = null;   // v503：可切换直连 LLM 的影评返回体，测 JSON 解析各分支
const REVIEW_RAW_DEFAULT = '```json\n{"review":"## **节奏克制**，余韵悠长。[1]"}\n```';
function stubFetch(url, init) {
  calls.push({ url: String(url), init: init || {} });
  let payload;
  if (/\/chat\/completions$/.test(url)) {
    // 按 system prompt 区分功能：影评返回 {"review":...} JSON 字符串，翻译返回 {title,summary} JSON 字符串
    let sys = '';
    try { sys = JSON.parse(init.body).messages[0].content || ''; } catch (e) {}
    const isReview = /影视评论人/.test(sys);
    payload = { choices: [{ message: { content: isReview ? (reviewRaw === null ? REVIEW_RAW_DEFAULT : reviewRaw) : JSON.stringify({ title: 'T', summary: 'S' }) } }] };
  } else if (/\/translate(\?|$)/.test(url)) {
    payload = { title: 'W', summary: 'Q' };
  } else if (/\/ai\/review(\?|$)/.test(url)) {
    payload = { ok: true, review: '**节奏克制**，余韵悠长。' };
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

  /* —— v503 AI 影评 reviewRequest：三项输入 + 严格 JSON 输出 —— */
  const REVIEW_INFO = { title: '花样年华', originaltitle: 'In the Mood for Love', date: '2000-09-29' };
  const OWN = { baseUrl: 'https://llm.example.com/v1', apiKey: 'K', model: 'agnes-2.5-flash' };
  // 8. 自填 ownCfg 完整 → 直连 LLM，且用的是 review 提示词（不是 translate）
  calls = [];
  await NfoCore.reviewRequest(REVIEW_INFO, { ownCfg: OWN }).then(function (text) {
    eq('review/自填cfg: 仅 1 次请求', calls.length === 1);
    eq('review/自填cfg: endpoint 自动补 /chat/completions', calls[0].url === 'https://llm.example.com/v1/chat/completions');
    const body = JSON.parse(calls[0].init.body);
    eq('review/自填cfg: 用影评提示词', /影视评论人/.test(body.messages[0].content));
    eq('review/自填cfg: 不用翻译提示词', !/译为简体中文的翻译专家/.test(body.messages[0].content));
    eq('review/自填cfg: 提示词要求 JSON 输出', /"review"/.test(body.messages[0].content) && /JSON/.test(body.messages[0].content));
    eq('review/自填cfg: 提示词要求专业客观', /专业、客观/.test(body.messages[0].content));
    const um = body.messages[1].content;
    eq('review/自填cfg: 只发三项', /【片名】/.test(um) && /【原始名称】/.test(um) && /【上映日期】/.test(um)
      && !/【简介】/.test(um) && !/【评分】/.test(um) && !/【类型】/.test(um));
    eq('review/自填cfg: 完整日期不截断', um.indexOf('2000-09-29') > -1);
    eq('review/自填cfg: 原始名进 messages', um.indexOf('In the Mood for Love') > -1);
    eq('review/自填cfg: JSON 解析并清洗', text === '节奏克制，余韵悠长。', text);
  });

  // 9. 无 ownCfg + Worker + code → POST /ai/review?code=（高级档由 Worker 放行）
  calls = [];
  await NfoCore.reviewRequest(REVIEW_INFO, { workerBase: 'https://w.example.com', code: 'FULL123' })
    .then(function (text) {
      eq('review/Worker: 走 /ai/review?code=', calls[0].url === 'https://w.example.com/ai/review?code=FULL123');
      eq('review/Worker: POST', calls[0].init.method === 'POST');
      const body = JSON.parse(calls[0].init.body);
      eq('review/Worker: 只发三项', body.title === '花样年华' && body.originaltitle === 'In the Mood for Love'
        && body.date === '2000-09-29' && !('plot' in body) && !('genres' in body) && !('rating' in body));
      eq('review/Worker: 返回清洗后纯文本', text === '节奏克制，余韵悠长。', text);
    });

  // 10. 缺配置 → reject；缺片名 → reject（不发无谓请求）
  await expectReject('review/缺配置: 正确 reject', NfoCore.reviewRequest(REVIEW_INFO, {}), /未配置 AI 影评/);
  await expectReject('review/缺片名: 正确 reject', NfoCore.reviewRequest({ plot: 'x' }, { workerBase: 'https://w.example.com' }), /缺少片名/);

  // 11. AI_PROMPTS 表是单点真相：translate / review 两份且内容不同
  eq('AI_PROMPTS: 两份提示词', !!NfoCore.AI_PROMPTS && typeof NfoCore.AI_PROMPTS.translate === 'string' && typeof NfoCore.AI_PROMPTS.review === 'string');
  eq('AI_PROMPTS: translate 与旧常量一致', NfoCore.AI_PROMPTS.translate === NfoCore.TRANSLATE_SYSTEM_PROMPT);

  /* —— v503 JSON 解析：正常 / 围栏 / 噪音 / 去角标 / 五类失败 —— */
  eq('parse/纯 JSON', NfoCore.parseAiReviewText('{"review":"节奏舒缓。"}') === '节奏舒缓。');
  eq('parse/带噪音前后文字', NfoCore.parseAiReviewText('好的，这是影评：\n{"review":"温和而有分寸。"}\n以上。') === '温和而有分寸。');
  const linkText = NfoCore.parseAiReviewText('{"review":"参见 [资料](https://x.com/a) 的说法。"}');
  eq('parse/markdown 链接保留文字', linkText === '参见 资料 的说法。', linkText);
  const cnText = NfoCore.parseAiReviewText('{"review":"影像克制【1，2】，余韵长。"}');
  eq('parse/去中文数字角标', cnText === '影像克制，余韵长。', cnText);
  let parseFail = 0;
  ['这是一段纯文本，没有 JSON', '{"foo":"bar"}', '{"review":""}', '{"review":', ''].forEach(function (raw) {
    try { NfoCore.parseAiReviewText(raw); } catch (e) { parseFail++; }
  });
  eq('parse/五类解析失败全部抛错', parseFail === 5, '实际抛错 ' + parseFail + ' 次');
  reviewRaw = '抱歉，我无法找到该片资料。';
  await expectReject('review/模型没按 JSON 回: reject（状态机静默不显示）', NfoCore.reviewRequest(REVIEW_INFO, { ownCfg: OWN }), /影评返回非 JSON/);
  reviewRaw = null;

  /* —— 配额计数（本地按天，仅展示；权威以服务端为准）—— */
  // 桩 localStorage / window（quotaInc 会用到；Node 无原生实现）
  const store = {};
  global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  global.window = global.window || {};
  let quotaEvents = 0; global.window.dispatchEvent = () => { quotaEvents++; };

  // 8. free 档：5 个桶、上限 15、含 JAV保存
  const dFree = NfoCore.quotaData('free');
  eq('quota/free: 5 个桶', dFree.length === 5);
  eq('quota/free: 上限 15', dFree.every(x => x.limit === 15));
  eq('quota/free: 含 JAV保存', dFree.some(x => x.field === 'javSave'));
  // 9. medium 档：上限 30
  eq('quota/medium: 上限 30', NfoCore.quotaData('medium').every(x => x.limit === 30));
  // 10. full 档：无计数桶（不限次）
  eq('quota/full: 无计数桶', NfoCore.quotaData('full').length === 0);
  // 11. quotaInc 累加、remaining 递减
  NfoCore.quotaInc('tmdbSearch'); NfoCore.quotaInc('tmdbSearch');
  const qs = NfoCore.quotaData('free').find(x => x.field === 'tmdbSearch');
  eq('quota/inc: 已用 2', qs.used === 2);
  eq('quota/inc: 剩余 13', qs.remaining === 13);
  // 12. quotaInc 派发 nfo:quota-changed（供 UI 实时刷新）
  quotaEvents = 0; NfoCore.quotaInc('javSave');
  eq('quota/inc: 派发事件', quotaEvents === 1);

  console.log('core-shared-request ' + (failed ? ('有 ' + failed + ' 项失败') : '全通过'));
  if (failed) process.exitCode = 1;
})();
