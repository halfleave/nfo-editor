#!/usr/bin/env node
/* 详情页「多平台评分行」客户端逻辑测试（v438）
 *
 * 被测函数从 src/ui-ios.js 里按大括号配对抽取（不复制实现，避免两份代码漂移）：
 *   detailRatingsHtml（数据 → HTML 角标串）/ detailIsTv（剧集判定）
 * 覆盖：四个角标都画、缺源不画、全缺返回空串（整行隐藏）、IMDb 一位小数格式化、
 *       番号一票否决为影片、media_type 优先、搜索框状态兜底。
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

const sandbox = { state: {}, console: console };
vm.createContext(sandbox);
vm.runInContext(['detailRatingsHtml', 'detailIsTv'].map((n) => extractFn(src, n)).join('\n\n'), sandbox);

const FULL = {
  imdb: { rating: 8.7 },
  rottenTomatoes: { critics: { score: 83 }, audience: { score: 85 } },
  metacritic: { critics: { score: 73 } }
};

// ---- 1. 四家都在 ----
const h1 = sandbox.detailRatingsHtml(FULL);
ok('四个角标都画出来', (h1.match(/class="dr-item/g) || []).length === 4, h1);
ok('IMDb 分一位小数', /dr-imdb"><em>IMDb<\/em><b>8\.7<\/b>/.test(h1), h1);
ok('番茄 83%', /🍅<\/i><b>83%/.test(h1), h1);
ok('爆米花 85%', /🍿<\/i><b>85%/.test(h1), h1);
ok('Metascore 73', /dr-mc"><em>MC<\/em><b>73<\/b>/.test(h1), h1);

// ---- 2. IMDb 整数也补 .0 ----
const h2 = sandbox.detailRatingsHtml({ imdb: { rating: 8 } });
ok('IMDb 整数补成 8.0', /<b>8\.0<\/b>/.test(h2), h2);

// ---- 3. 只有 IMDb（华语片常见：番茄/MC 都没有）----
const h3 = sandbox.detailRatingsHtml({ imdb: { rating: 7.2 }, rottenTomatoes: null, metacritic: null });
ok('缺源时只画一个', (h3.match(/class="dr-item/g) || []).length === 1, h3);
ok('只有 IMDb 时不带番茄标记', h3.indexOf('🍅') < 0 && h3.indexOf('dr-mc') < 0, h3);

// ---- 4. 番茄有影评人分但没观众分 ----
const h4 = sandbox.detailRatingsHtml({ rottenTomatoes: { critics: { score: 90 }, audience: { score: null } } });
ok('观众分缺失不画爆米花', h4.indexOf('🍿') < 0 && h4.indexOf('🍅') >= 0, h4);

// ---- 5. 全缺 → 空串（调用方据此 display:none）----
ok('全缺返回空串', sandbox.detailRatingsHtml({}) === '');
ok('传 null 也返回空串', sandbox.detailRatingsHtml(null) === '');
ok('sources 全 false 返回空串', sandbox.detailRatingsHtml({ sources: { imdb: false } }) === '');

// ---- 6. 剧集判定 ----
sandbox.state = {};
ok('番号一票否决（dvdId）', sandbox.detailIsTv({ dvdId: 'SSIS-123', tmdbMediaType: 'tv' }) === false);
ok('content_id 同样否决', sandbox.detailIsTv({ content_id: 'abc', tmdbMediaType: 'tv' }) === false);
ok('media_type=tv → 剧集', sandbox.detailIsTv({ media_type: 'tv' }) === true);
ok('tmdbMediaType=movie → 影片', sandbox.detailIsTv({ tmdbMediaType: 'movie' }) === false);
ok('自身无标记时用搜索框状态兜底', (function () { sandbox.state = { tmdbMediaType: 'tv' }; return sandbox.detailIsTv({ title: 'x' }) === true; })());
ok('全无标记 → 影片', (function () { sandbox.state = {}; return sandbox.detailIsTv({}) === false; })());

console.log('\n' + (fail ? '❌ ' : '✅ ') + 'detail-ratings: ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
