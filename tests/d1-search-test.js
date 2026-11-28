#!/usr/bin/env node
/* D1 兜底搜索 App 侧隔离测试（v535，不触真实网络）
 * 被测函数从 src/ui-ios.js 按大括号配对抽取：renderD1Results / applyD1Result
 * 覆盖：① 列表标题中文优先（有译名→中文主+日文小字；无译名→原始标题）
 *       ② 番号大写显示、封面代理、里模式遮罩
 *       ③ D1 item → JavBus 详情结构映射（演员/标签/片商/导演等）
 *       ④ D1 没有的字段留空（剧情/评分/磁力）
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

const fnCode = [extractFn(src, 'renderD1Results'), extractFn(src, 'applyD1Result')].join('\n');

let capturedD = null;
const sandbox = {
  lastD1Results: [],
  state: { avCoverMask: false },
  javbusImgUrl: (u) => 'PROXY(' + u + ')',
  d1NormCode: (c) => String(c || '').toLowerCase().replace(/[^a-z0-9]/g, ''),
  escapeHtml: (s) => String(s == null ? '' : s),
  escapeAttr: (s) => String(s == null ? '' : s),
  avCoverMaskHtml: () => 'MASK',
  showToast: () => {},
  populateFromJavbus: (d) => { capturedD = d; return Promise.resolve(); },
  prefetchJavbusPoster: () => Promise.resolve(),
  quickSaveAndHome: () => Promise.resolve(),
  silentRefreshCurrentFilm: () => Promise.resolve(),
};
vm.createContext(sandbox);
vm.runInContext(fnCode + '\nthis.renderD1Results = renderD1Results; this.applyD1Result = applyD1Result;', sandbox);

// ---- 1. renderD1Results 标题中文优先 ----
const box = { innerHTML: '' };
sandbox.lastD1Results = [{
  code: '53ka01885', title: '猥褻モデル 鈴木麻奈美', title_zh: '淫秽模特 鈴木麻奈美',
  date: '1998/06/19', cover: 'https://pics.dmm.co.jp/x.jpg'
}];
sandbox.renderD1Results(sandbox.lastD1Results, box);
ok('中文主标题 tr-title-zh', box.innerHTML.indexOf('class="tr-title-zh">淫秽模特 鈴木麻奈美<') >= 0, box.innerHTML.slice(0, 300));
ok('日文原名降小字 tr-title-orig', box.innerHTML.indexOf('tr-title-text tr-title-orig">猥褻モデル') >= 0);
ok('番号大写显示', box.innerHTML.indexOf('53KA01885') >= 0);
ok('封面走代理', box.innerHTML.indexOf('PROXY(https://pics.dmm.co.jp/x.jpg)') >= 0);
ok('点选进 applyD1Result', box.innerHTML.indexOf("onclick=\"applyD1Result(0)\"") >= 0);

// 无中文译名 → 用原始标题，不出现 tr-title-zh
sandbox.lastD1Results = [{ code: 'ABP-001', title: '原始标题', title_zh: '', date: '', cover: '' }];
sandbox.renderD1Results(sandbox.lastD1Results, box);
ok('无译名用原始标题', box.innerHTML.indexOf('class="tr-title-text">原始标题<') >= 0);
ok('无译名不出现 tr-title-zh', box.innerHTML.indexOf('tr-title-zh') < 0);

// ---- 2. applyD1Result 映射 ----
capturedD = null;
sandbox.lastD1Results = [{
  code: 'SSIS-845', title: '日文原名', title_zh: '中文译名', date: '2023/08/18', cover: 'https://img/x.jpg',
  duration: '120分', genres: ['中出し', '人妻'],
  actors: [{ role: 'actress', name: '女优A' }, { role: 'actress', name: '女优B' }],
  makers: ['片商X'], labels: ['厂牌Y'], series: ['系列Z'], directors: ['导演D'],
  magnets: [{ url: 'ed2k://old' }]
}];
sandbox.applyD1Result(0);
ok('详情番号=code', capturedD.id === 'SSIS-845');
ok('详情标题用日文原名（中文小字交给 patchDetailFromD1）', capturedD.title === '日文原名');
ok('详情演员映射', capturedD.stars.length === 2 && capturedD.stars[0].name === '女优A');
ok('详情标签映射', capturedD.genres.length === 2 && capturedD.genres[0].name === '中出し');
ok('详情片商/厂牌/系列/导演映射', capturedD.producer.name === '片商X' && capturedD.publisher.name === '厂牌Y'
  && capturedD.series.name === '系列Z' && capturedD.director.name === '导演D');
ok('D1 磁力不并入（留空）', capturedD.magnets.length === 0);
ok('D1 剧情/评分留空', capturedD.plot === '' && capturedD.rating === '');

console.log('\nD1 兜底搜索 App 测试：' + pass + ' 通过 / ' + fail + ' 失败');
process.exitCode = fail ? 1 : 0;
