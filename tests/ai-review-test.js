#!/usr/bin/env node
/* 精彩评论状态机测试（v504）
 *
 * 被测函数从 src/ui-ios.js 按大括号配对抽取（不复制实现，避免两份代码漂移）：
 *   maybeFetchAiReview / aiReviewGet / aiReviewSet / aiReviewKey /
 *   aiReviewConfigReady / aiReviewInfoOf / cmShuffle / cmLaneHtml /
 *   paintAiReview / renderAiReview
 * 覆盖用户定的核心规则：
 *   ① 评论不足 3 条 → 区块不出现（失败静默、无「生成中」占位）
 *   ② 已有评论 → 永不重复调 AI
 *   ③ 在途不打断、5 分钟冷却（at 在发起时即落库，跨会话有效）
 * 以及：配置未就绪静默跳过、成功后局部插入、切片不串、缺片名不请求、
 *       三行随机循环滚动渲染、标题「精彩评论」、HTML 转义。
 * 全程用桩，不触真实网络（符合隔离测试约束）。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'src', 'ui-ios.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? '  → ' + extra : '')); }
}
function extractFn(code, name) {
  const start = code.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('未找到函数：' + name);
  let depth = 0, inStr = null, i = code.indexOf('{', start);
  for (; i < code.length; i++) {
    const c = code[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return code.slice(start, i + 1); }
  }
  throw new Error('括号不配对：' + name);
}
const FN = ['aiReviewKey', 'aiReviewGet', 'aiReviewSet', 'aiReviewConfigReady',
  'aiReviewInfoOf', 'cmShuffle', 'cmLaneHtml', 'paintAiReview', 'renderAiReview',
  'maybeFetchAiReview'];

/* —— 运行时桩 —— */
let NOW = 1700000000000;
const kv = {};                    // 独立 kv 键 → { list:[...], at }
const films = {};                 // filmId → film 记录
const calls = { review: [], painted: [], hidden: 0 };
const boxes = {};                 // DOM 桩：id → { innerHTML, style, onclick }
let reviewMode = 'ok';            // ok | fail | empty | few
let configReady = true;
let currentId = null;
const state = { tier: 'full', translateBaseUrl: '', translateApiKey: '', translateModel: '', magnetWorker: 'https://w.example.com' };
const aiReviewInFlight = {};
const COMMENTS = ['节奏克制，余韵悠长。', '镜头很慢但自有章法', '适合一个人安静重看'];

function makeBox(id) {
  boxes[id] = { innerHTML: '', style: { display: 'none' }, onclick: null };
  return boxes[id];
}
const sandbox = {
  console: console,
  Date: { now: function () { return NOW; } },
  Promise: Promise,
  String: String, Array: Array, Object: Object, Error: Error, JSON: JSON, Math: Math,
  AI_REVIEW_GAP: 5 * 60 * 1000,
  aiReviewInFlight: aiReviewInFlight,
  aiReviewShowing: [],
  currentDetailFilmId: null,
  state: state,
  DEFAULT_WORKER: 'https://w.example.com',
  idbGet: function (store, key) { return Promise.resolve(kv[key] ? JSON.parse(JSON.stringify(kv[key])) : null); },
  idbPut: function (store, key, val) { kv[key] = JSON.parse(JSON.stringify(val)); return Promise.resolve(); },
  loadFilm: function (id) { return Promise.resolve(films[id] ? JSON.parse(JSON.stringify(films[id])) : null); },
  getActivationCode: function () { return Promise.resolve('FULL123'); },
  translateConfigReady: function () { return configReady; },
  escapeHtml: function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },
  document: {
    getElementById: function (id) { return boxes[id] || null; }
  },
  showToast: function () { /* 失败应静默，一旦被调用即为异常 */ },
  NfoCore: {
    reviewRequest: function (info, opts) {
      calls.review.push({ info: info, opts: opts });
      if (reviewMode === 'fail') return Promise.reject(new Error('评论服务不可用'));
      if (reviewMode === 'empty') return Promise.resolve([]);
      if (reviewMode === 'few') return Promise.resolve(['只有一条']);
      return Promise.resolve(COMMENTS.slice());
    }
  }
};
vm.createContext(sandbox);
vm.runInContext(FN.map(function (n) { return extractFn(src, n); }).join('\n'), sandbox);

// 让 currentDetailFilmId 与桩同步（sandbox 里的赋值只影响内部）
function setCurrent(id) {
  currentId = id;
  sandbox.currentDetailFilmId = id;
}
function tick(n) {
  let p = Promise.resolve();
  for (let i = 0; i < (n || 6); i++) p = p.then(function () { return Promise.resolve(); });
  return p;
}
function reset(opts) {
  opts = opts || {};
  Object.keys(kv).forEach(k => delete kv[k]);
  Object.keys(aiReviewInFlight).forEach(k => delete aiReviewInFlight[k]);
  Object.keys(boxes).forEach(k => delete boxes[k]);
  calls.review.length = 0; calls.painted.length = 0; calls.hidden = 0;
  reviewMode = opts.reviewMode || 'ok';
  configReady = opts.configReady !== false;
  state.tier = opts.tier || 'full';
  sandbox.aiReviewShowing = [];
  NOW = 1700000000000;
  makeBox('detailAiReview');
  setCurrent(opts.current || null);
  films['f1'] = { id: 'f1', title: '花样年华', data: { title: '花样年华', originaltitle: 'In the Mood for Love', premiered: '2000-09-29', genres: ['剧情', '爱情'], plot: '两个人克制地错过。', rating: '8.6' } };
}

(async function () {
  /* ① 基础：保存后首次发起，成功写库并局部插入 */
  reset();
  sandbox.maybeFetchAiReview('f1');
  await tick(14);
  ok('首次：发起 1 次 AI 请求', calls.review.length === 1, JSON.stringify(calls.review));
  ok('首次：at 在发起时已落库（跨会话有效）', kv['aiReview2:f1'] && typeof kv['aiReview2:f1'].at === 'number');
  ok('首次：成功后写入评论数组', kv['aiReview2:f1'] && Array.isArray(kv['aiReview2:f1'].list)
    && kv['aiReview2:f1'].list.length === 3 && kv['aiReview2:f1'].list[0] === COMMENTS[0]);
  ok('首次：只发片名/原始名/完整日期三项', (function () {
    const i = calls.review[0] && calls.review[0].info;
    return !!i && i.title === '花样年华' && i.originaltitle === 'In the Mood for Love' && i.date === '2000-09-29'
      && !('year' in i) && !('genres' in i) && !('plot' in i) && !('rating' in i);
  })(), JSON.stringify(calls.review[0]));
  ok('首次：Worker 兜底带激活码', calls.review[0] && calls.review[0].opts.code === 'FULL123');

  // 详情页没打开时不插入（只存库）
  ok('未打开详情页：区块保持隐藏', boxes.detailAiReview.style.display === 'none' && boxes.detailAiReview.innerHTML === '');
  // 打开详情页后由 renderAiReview 回填
  setCurrent('f1');
  sandbox.renderAiReview(films.f1);
  await tick(8);
  ok('renderAiReview：有评论才显示', boxes.detailAiReview.style.display === '' && /余韵悠长/.test(boxes.detailAiReview.innerHTML));
  ok('renderAiReview：标题为「精彩评论」', /class="cm-head">精彩评论</.test(boxes.detailAiReview.innerHTML));
  ok('renderAiReview：三行滚动轨道', (boxes.detailAiReview.innerHTML.match(/class="cm-lane"/g) || []).length === 3);
  ok('renderAiReview：每行两份序列做无缝循环', (boxes.detailAiReview.innerHTML.match(/class="cm-seq"/g) || []).length === 6);
  ok('renderAiReview：随机方向/速度/起始位置', /--cm-dur:\d+s;--cm-dir:(normal|reverse);--cm-delay:-/.test(boxes.detailAiReview.innerHTML));
  ok('renderAiReview：点击区域绑定弹窗', typeof boxes.detailAiReview.onclick === 'function');

  /* HTML 转义防注入 */
  reset();
  setCurrent('f1');
  kv['aiReview2:f1'] = { list: ['<img src=x onerror=alert(1)>', '正常评论一', '正常评论二'], at: NOW };
  sandbox.renderAiReview(films.f1);
  await tick(8);
  ok('renderAiReview：HTML 转义防注入', /&lt;img/.test(boxes.detailAiReview.innerHTML)
    && !/<img/.test(boxes.detailAiReview.innerHTML));

  /* ② 已有评论 → 永不重复调 AI */
  reset();
  kv['aiReview2:f1'] = { list: ['早就写好的评论一', '早就写好的评论二', '早就写好的评论三'], at: NOW - 1000 };
  sandbox.maybeFetchAiReview('f1');
  await tick(10);
  ok('已有评论：0 次请求', calls.review.length === 0, JSON.stringify(calls.review));
  ok('已有评论：原评论不被覆盖', kv['aiReview2:f1'].list[0] === '早就写好的评论一');

  /* ③ 在途不打断：连点两次只发一次 */
  reset();
  let resolveReview = null;
  sandbox.NfoCore.reviewRequest = function (info, opts) {
    calls.review.push({ info: info, opts: opts });
    return new Promise(function (res) { resolveReview = res; });
  };
  sandbox.maybeFetchAiReview('f1');   // 模拟「刚保存」
  sandbox.maybeFetchAiReview('f1');   // 立刻点进详情
  await tick(10);
  ok('在途：只发 1 次请求（不打断、不重入）', calls.review.length === 1, JSON.stringify(calls.review));
  setCurrent('f1');
  resolveReview(COMMENTS.slice());
  await tick(12);
  ok('在途完成后：详情页就地补显示', boxes.detailAiReview.style.display === '' && /余韵悠长/.test(boxes.detailAiReview.innerHTML));
  ok('在途完成后：in-flight 已释放', !aiReviewInFlight['f1']);
  // 恢复桩
  sandbox.NfoCore.reviewRequest = function (info, opts) {
    calls.review.push({ info: info, opts: opts });
    if (reviewMode === 'fail') return Promise.reject(new Error('评论服务不可用'));
    if (reviewMode === 'empty') return Promise.resolve([]);
    if (reviewMode === 'few') return Promise.resolve(['只有一条']);
    return Promise.resolve(COMMENTS.slice());
  };

  /* ④ 失败静默 + 5 分钟冷却 */
  reset({ reviewMode: 'fail' });
  sandbox.maybeFetchAiReview('f1');
  await tick(14);
  ok('失败：不显示（区块仍隐藏）', boxes.detailAiReview.style.display === 'none' && boxes.detailAiReview.innerHTML === '');
  ok('失败：只留 at，不留空评论', kv['aiReview2:f1'] && kv['aiReview2:f1'].list.length === 0 && kv['aiReview2:f1'].at === NOW);
  ok('失败：in-flight 已释放', !aiReviewInFlight['f1']);
  // 立刻再进详情（模拟刚保存就点进去）→ 冷却挡住
  sandbox.maybeFetchAiReview('f1');
  await tick(10);
  ok('失败后立刻重开：5 分钟内不重试', calls.review.length === 1, JSON.stringify(calls.review));
  // 差 1 秒到 5 分钟 → 仍不重试
  NOW += 5 * 60 * 1000 - 1000;
  sandbox.maybeFetchAiReview('f1');
  await tick(10);
  ok('差 1 秒满 5 分钟：仍不重试', calls.review.length === 1);
  // 满 5 分钟后重开 → 重试一次
  reviewMode = 'ok';
  NOW += 2000;
  sandbox.maybeFetchAiReview('f1');
  await tick(14);
  ok('满 5 分钟后重开：重试 1 次', calls.review.length === 2, JSON.stringify(calls.review));
  ok('重试成功：写入评论数组', kv['aiReview2:f1'] && kv['aiReview2:f1'].list.length === 3);
  // 成功后再进 → 永不再调
  sandbox.maybeFetchAiReview('f1');
  await tick(10);
  ok('重试成功后再进：仍为 2 次', calls.review.length === 2);

  /* ⑤ 配置未就绪 / 缺数据 → 静默跳过 */
  reset({ configReady: false, tier: 'free' });
  sandbox.maybeFetchAiReview('f1');
  await tick(10);
  ok('无自填 Key 且非高级档：0 次请求', calls.review.length === 0);
  ok('未就绪：不写库', !kv['aiReview2:f1']);
  reset({ configReady: true, tier: 'full' });
  films['f1'] = { id: 'f1', title: '', data: {} };
  sandbox.maybeFetchAiReview('f1');
  await tick(14);
  ok('缺片名：不发 AI 请求', calls.review.length === 0, JSON.stringify(calls.review));

  /* ⑥ 切换影片不串片 */
  reset();
  setCurrent('f1');
  kv['aiReview2:f1'] = { list: ['A 的评论一', 'A 的评论二', 'A 的评论三'], at: NOW };
  sandbox.renderAiReview(films.f1);
  await tick(8);
  ok('切走前：显示 A 的评论', /A 的评论一/.test(boxes.detailAiReview.innerHTML));
  setCurrent('f2');
  sandbox.renderAiReview({ id: 'f2' });
  await tick(8);
  ok('切到别的片：评论区清空并隐藏', boxes.detailAiReview.innerHTML === '' && boxes.detailAiReview.style.display === 'none');

  /* ⑦ 空数组 / 条数不足视为失败（不显示） */
  reset({ reviewMode: 'empty' });
  sandbox.maybeFetchAiReview('f1');
  await tick(14);
  ok('AI 返回空数组：不显示', boxes.detailAiReview.style.display === 'none' && kv['aiReview2:f1'].list.length === 0);
  reset({ reviewMode: 'few' });
  setCurrent('f1');
  sandbox.maybeFetchAiReview('f1');
  await tick(14);
  ok('AI 只回 1 条：整块不出现', boxes.detailAiReview.style.display === 'none' && boxes.detailAiReview.innerHTML === '');

  console.log('ai-review ' + (fail ? ('有 ' + fail + ' 项失败') : '全通过'));
  if (fail) process.exitCode = 1;
})();
