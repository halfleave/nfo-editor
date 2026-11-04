#!/usr/bin/env node
/* 简介为空时「按需补取」测试（v449 影片/剧集整体 + v450 单集）
 *
 * 被测函数从 src/ui-ios.js 按大括号配对抽取（不复制实现，避免两份代码漂移）：
 *   maybeRefetchPlot    — 详情页简介为空 → 重取一次 TMDB overview
 *   maybeRefetchEpPlot  — 点开某一集的卡片且该集简介为空 → 只补这一集
 *   patchEpCard         — 补到之后只改那张卡片，不重排列表
 * 覆盖：已有简介不请求 / 缺 id 不请求 / 6 小时内不重复 / zh 命中 / zh 空回落 en-US /
 *       两边都空也要写冷却标记 / 失败静默 / 切走后只存库 / 切季后不串集 / 弹窗就地重画。
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

/* —— 运行时桩 —— */
const db = {};                       // filmId → film 记录
const calls = { tmdb: [], saved: [], toast: [], refresh: 0, sheet: 0, reopen: [] };
const sandbox = {
  console: console,
  PLOT_REFETCH_GAP: 6 * 3600 * 1000,
  _plotRetryAt: {},
  EP_PLOT_GAP: 6 * 3600 * 1000,
  _epPlotBusy: {},
  epSheetKey: '',
  dsSelSeason: {},
  currentDetailFilmId: null,
  currentDetailFilm: null,
  showToast: function (msg) { calls.toast.push(msg); },
  refreshDetailPlot: function () { calls.refresh++; },
  openPlotSheet: function () { calls.sheet++; },
  openEpSheet: function (n, ep) { calls.reopen.push(n + ':' + ep); },
  escapeHtml: function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },
  dsOpts: function () { return Promise.resolve({ ownKey: '', workerBase: 'w', code: '' }); },
  loadFilm: function (id) { return Promise.resolve(db[id] ? JSON.parse(JSON.stringify(db[id])) : null); },
  saveFilm: function (film) { db[film.id] = JSON.parse(JSON.stringify(film)); calls.saved.push(film.id); return Promise.resolve(); },
  document: { getElementById: function () { return null; } },
  NfoCore: {
    tmdbRequest: function (p, params) {
      calls.tmdb.push(p + '|' + (params && params.language));
      const r = sandbox.__tmdbReply(p, params && params.language);
      return r === 'ERR' ? Promise.reject(new Error('boom')) : Promise.resolve(r);
    }
  },
  __tmdbReply: function () { return {}; }
};
vm.createContext(sandbox);
vm.runInContext(
  extractFn(src, 'maybeRefetchPlot') + '\n' + extractFn(src, 'maybeRefetchEpPlot') + '\n' + extractFn(src, 'patchEpCard'),
  sandbox
);

function flush() { return new Promise(function (r) { setTimeout(r, 8); }); }
function reset() {
  calls.tmdb.length = 0; calls.saved.length = 0; calls.toast.length = 0; calls.reopen.length = 0;
  calls.refresh = 0; calls.sheet = 0;
}
function fresh(id, data) {
  db[id] = { id: id, data: data };
  sandbox.currentDetailFilmId = id;
  return db[id];
}
const TV_OK = { tmdbId: '100', tmdbMediaType: 'tv' };

/* —— 假 DOM：只服务 patchEpCard / 弹窗重画 —— */
function installDom(opt) {
  opt = opt || {};
  const plotEl = { innerHTML: '__init__' };
  const card = { querySelector: function (sel) { return sel === '.ds-plot' ? plotEl : null; } };
  const box = {
    querySelector: function (sel) { return sel === '.ds-ep[data-ep="' + (opt.ep || 5) + '"]' ? card : null; }
  };
  const modal = { classList: { contains: function (c) { return c === 'on' && !!opt.modalOn; } } };
  sandbox.document = {
    getElementById: function (id) {
      if (id === 'detailSeasons') return box;
      if (id === 'epModal') return modal;
      return null;
    }
  };
  return plotEl;
}

(async function () {
  /* ================= v449：影片 / 剧集整体简介 ================= */
  reset();
  fresh('a', Object.assign({ plot: '已经有的简介' }, TV_OK));
  sandbox.maybeRefetchPlot(db.a);
  await flush();
  ok('整体：已有简介 → 不发请求', calls.tmdb.length === 0 && calls.saved.length === 0);

  reset();
  fresh('b', {});
  sandbox.maybeRefetchPlot(db.b);
  await flush();
  ok('整体：无 tmdbId → 不发请求', calls.tmdb.length === 0);

  reset();
  fresh('c', Object.assign({}, TV_OK));
  sandbox.__tmdbReply = function (p, lang) { return lang === 'zh-CN' ? { overview: '  中文简介  ' } : {}; };
  sandbox.maybeRefetchPlot(db.c);
  await flush();
  ok('整体：剧集路径走 /tv/<id>', calls.tmdb[0] === '/tv/100|zh-CN', calls.tmdb.join(','));
  ok('整体：中文命中就不再打 en-US', calls.tmdb.length === 1);
  ok('整体：简介写库（去首尾空格）', db.c.data.plot === '中文简介', db.c.data.plot);
  ok('整体：写库时记冷却标记', typeof db.c.data.plotFetchAt === 'number');
  ok('整体：刷新详情简介 + 提示', calls.refresh === 1 && calls.toast.join() === '已补全简介');

  reset();
  fresh('d', { tmdbId: '200', tmdbMediaType: 'movie' });
  sandbox.__tmdbReply = function (p, lang) { return lang === 'en-US' ? { overview: 'An English overview' } : {}; };
  sandbox.maybeRefetchPlot(db.d);
  await flush();
  ok('整体：影片路径走 /movie/<id>', calls.tmdb[0] === '/movie/200|zh-CN', calls.tmdb.join(','));
  ok('整体：zh 空回落 en-US', calls.tmdb.length === 2 && calls.tmdb[1] === '/movie/200|en-US');
  ok('整体：英文简介写库', db.d.data.plot === 'An English overview');

  reset();
  fresh('e', Object.assign({}, TV_OK));
  sandbox.__tmdbReply = function () { return { overview: '   ' }; };
  sandbox.maybeRefetchPlot(db.e);
  await flush();
  ok('整体：两边都空 → 仍写冷却标记', typeof db.e.data.plotFetchAt === 'number');
  ok('整体：两边都空 → 不写 plot / 不提示 / 不刷新', !db.e.data.plot && !calls.toast.length && calls.refresh === 0);

  reset();
  fresh('f', Object.assign({ plotFetchAt: Date.now() - 60 * 1000 }, TV_OK));
  sandbox.maybeRefetchPlot(db.f);
  await flush();
  ok('整体：6 小时内试过 → 不再请求', calls.tmdb.length === 0 && calls.saved.length === 0);

  reset();
  fresh('g', Object.assign({ plotFetchAt: Date.now() - 7 * 3600 * 1000 }, TV_OK));
  sandbox.__tmdbReply = function (p, lang) { return lang === 'zh-CN' ? { overview: '补上了' } : {}; };
  sandbox.maybeRefetchPlot(db.g);
  await flush();
  ok('整体：超过 6 小时 → 重新补取', db.g.data.plot === '补上了');

  reset();
  fresh('h', Object.assign({}, TV_OK));
  sandbox.__tmdbReply = function () { return 'ERR'; };
  sandbox.maybeRefetchPlot(db.h);
  await flush();
  ok('整体：请求失败 → 静默（不写 plot、不刷新）', !db.h.data.plot && calls.refresh === 0);

  reset();
  fresh('i', Object.assign({}, TV_OK));
  sandbox.__tmdbReply = function (p, lang) { return lang === 'zh-CN' ? { overview: '后台补的' } : {}; };
  sandbox.maybeRefetchPlot(db.i);
  sandbox.currentDetailFilmId = 'other';
  await flush();
  ok('整体：切走后仍写库', db.i.data.plot === '后台补的');
  ok('整体：切走后不刷新界面', calls.refresh === 0 && calls.toast.length === 0);

  /* ================= v450：某一集简介 ================= */
  function epFilm(eps) {
    return { tmdbId: '100', tmdbMediaType: 'tv', tvSeasons: { '2': { n: 2, name: '第 2 季', episodes: eps } }, plot: '整剧简介' };
  }

  /* 1. 点开空简介的那一集 → 只请求这一集，卡片与弹窗就地更新 */
  reset();
  let plotEl = installDom({ ep: 5, modalOn: true });
  fresh('e1', epFilm([{ ep: 4, overview: '第四集有简介' }, { ep: 5, name: '第五集', overview: '' }]));
  sandbox.epSheetKey = 'e1:2:5';
  sandbox.dsSelSeason.e1 = 2;
  sandbox.__tmdbReply = function (p, lang) { return lang === 'zh-CN' ? { overview: '  第五集中文简介  ' } : {}; };
  sandbox.maybeRefetchEpPlot(db.e1, 2, 5);
  await flush();
  ok('单集：只打这一集的接口', calls.tmdb[0] === '/tv/100/season/2/episode/5|zh-CN', calls.tmdb.join(','));
  ok('单集：中文命中就不再打 en-US', calls.tmdb.length === 1);
  ok('单集：内存里的这一集补上了', db.e1.data.tvSeasons['2'].episodes[1].overview === '第五集中文简介');
  ok('单集：其它集不受影响', db.e1.data.tvSeasons['2'].episodes[0].overview === '第四集有简介');
  ok('单集：卡片就地上字', plotEl.innerHTML === '第五集中文简介', plotEl.innerHTML);
  ok('单集：弹窗就地重画', calls.reopen.join() === '2:5');
  ok('单集：不弹任何提示（静默补全）', calls.toast.length === 0, calls.toast.join());

  /* 2. 中文空 → 回落英文，并标「原文」 */
  reset();
  plotEl = installDom({ ep: 6, modalOn: false });
  fresh('e2', epFilm([{ ep: 6, overview: '' }]));
  sandbox.dsSelSeason.e2 = 2;
  sandbox.__tmdbReply = function (p, lang) { return lang === 'en-US' ? { overview: 'Episode six overview' } : {}; };
  sandbox.maybeRefetchEpPlot(db.e2, 2, 6);
  await flush();
  ok('单集：zh 空回落 en-US', calls.tmdb.length === 2 && calls.tmdb[1] === '/tv/100/season/2/episode/6|en-US');
  ok('单集：英文简介写库并标 en', db.e2.data.tvSeasons['2'].episodes[0].overview === 'Episode six overview' && db.e2.data.tvSeasons['2'].episodes[0].en === true);
  ok('单集：卡片带「原文」角标', plotEl.innerHTML.indexOf('<span class="ds-lang">原文</span>') === 0, plotEl.innerHTML);

  /* 3. 两边都空：写冷却标记；弹窗本来就是「本集暂无简介」，不需要重画 */
  reset();
  installDom({ ep: 7, modalOn: true });
  fresh('e3', epFilm([{ ep: 7, overview: '' }]));
  sandbox.dsSelSeason.e3 = 2;
  sandbox.epSheetKey = 'e3:2:7';
  sandbox.__tmdbReply = function () { return { overview: '  ' }; };
  sandbox.maybeRefetchEpPlot(db.e3, 2, 7);
  await flush();
  ok('单集：两边都空 → 写冷却标记', typeof db.e3.data.tvSeasons['2'].episodes[0].plotFetchAt === 'number');
  ok('单集：两边都空 → 不写简介/不提示', !db.e3.data.tvSeasons['2'].episodes[0].overview && !calls.toast.length);
  ok('单集：两边都空 → 弹窗不重画（本来就叫暂无简介）', calls.reopen.length === 0, calls.reopen.join());

  /* 4. 已有简介 / 冷却期内 / 非剧集 → 一概不请求 */
  reset();
  fresh('e4', epFilm([{ ep: 1, overview: '已有' }]));
  sandbox.maybeRefetchEpPlot(db.e4, 2, 1);
  await flush();
  ok('单集：已有简介 → 不请求', calls.tmdb.length === 0);

  reset();
  fresh('e5', epFilm([{ ep: 2, overview: '', plotFetchAt: Date.now() - 60 * 1000 }]));
  sandbox.maybeRefetchEpPlot(db.e5, 2, 2);
  await flush();
  ok('单集：6 小时内试过 → 不请求', calls.tmdb.length === 0);

  reset();
  fresh('e6', { tmdbId: '300', tmdbMediaType: 'movie', tvSeasons: { '2': { episodes: [{ ep: 1, overview: '' }] } } });
  sandbox.maybeRefetchEpPlot(db.e6, 2, 1);
  await flush();
  ok('单集：非剧集 → 不请求', calls.tmdb.length === 0);

  /* 5. 切到别的季：卡片不串写（集号同名也不能改错卡） */
  reset();
  plotEl = installDom({ ep: 3, modalOn: false });
  fresh('e7', epFilm([{ ep: 3, overview: '' }]));
  sandbox.dsSelSeason.e7 = 1;          // 当前显示第 1 季，回来的是第 2 季的集
  sandbox.__tmdbReply = function (p, lang) { return lang === 'zh-CN' ? { overview: '第二季第三集' } : {}; };
  sandbox.maybeRefetchEpPlot(db.e7, 2, 3);
  await flush();
  ok('单集：切季后不往同名集号的卡片上写', plotEl.innerHTML === '__init__', plotEl.innerHTML);
  ok('单集：但数据照样写库', db.e7.data.tvSeasons['2'].episodes[0].overview === '第二季第三集');

  /* 6. 请求失败：静默，不留脏数据 */
  reset();
  installDom({ ep: 9, modalOn: false });
  fresh('e8', epFilm([{ ep: 9, overview: '' }]));
  sandbox.dsSelSeason.e8 = 2;
  sandbox.__tmdbReply = function () { return 'ERR'; };
  sandbox.maybeRefetchEpPlot(db.e8, 2, 9);
  await flush();
  ok('单集：请求失败 → 静默不提示', !calls.toast.length && !db.e8.data.tvSeasons['2'].episodes[0].overview);

  /* 7. 已切走影片：只存库不动界面 */
  reset();
  plotEl = installDom({ ep: 4, modalOn: true });
  fresh('e9', epFilm([{ ep: 4, overview: '' }]));
  sandbox.dsSelSeason.e9 = 2;
  sandbox.epSheetKey = 'e9:2:4';
  sandbox.__tmdbReply = function (p, lang) { return lang === 'zh-CN' ? { overview: '后台补的' } : {}; };
  sandbox.maybeRefetchEpPlot(db.e9, 2, 4);
  sandbox.currentDetailFilmId = 'other';
  await flush();
  ok('单集：切走后仍写库', db.e9.data.tvSeasons['2'].episodes[0].overview === '后台补的');
  ok('单集：切走后不写卡片/不提示', plotEl.innerHTML === '__init__' && !calls.toast.length);

  console.log('\nplot-refetch：' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
