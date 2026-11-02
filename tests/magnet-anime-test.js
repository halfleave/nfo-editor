#!/usr/bin/env node
/* 磁力「动漫源 + 字幕组筛选」客户端逻辑测试
 *
 * 被测函数从 src/ui-ios.js 里按大括号配对抽取（不复制实现，避免两份代码漂移）：
 *   magnetFansubBar / magnetPickFansub / magnetRowsHtml
 * 依赖的 escapeHtml / escapeAttr / decodeXmlEntities 用本地等价实现替代。
 * 覆盖：筛选条何时出现、按条数排序、12 个上限 +N、点选只重渲染不重搜、动漫行不显示做种改显示日期、
 *       字幕组标签、标题/磁力转义。
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

/* 按名字抽取函数：跳过字符串字面量后做括号配对 */
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

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const sandbox = {
  escapeHtml: esc,
  escapeAttr: esc,
  decodeXmlEntities: (s) => String(s || ''),
  console: console
};
vm.createContext(sandbox);
const fns = ['magnetFansubBar', 'magnetPickFansub', 'magnetRowsHtml'];
vm.runInContext(fns.map((n) => extractFn(src, n)).join('\n\n'), sandbox);
const bar = sandbox.magnetFansubBar;
const pick = sandbox.magnetPickFansub;
const rows = sandbox.magnetRowsHtml;

ok('三个函数都抽取成功', typeof bar === 'function' && typeof pick === 'function' && typeof rows === 'function');

/* ---------- 1. 筛选条出现条件 ---------- */
ok('无结果 → 不出筛选条', bar([]) === '');
ok('全部无字幕组（bt4g 结果）→ 不出筛选条',
  bar([{ fansub: '' }, { fansub: '' }, {}]) === '');
ok('只有 1 个字幕组 → 不出筛选条（筛了也没意义）',
  bar([{ fansub: 'LoliHouse' }, { fansub: 'LoliHouse' }]) === '');

/* ---------- 2. 聚合 / 排序 / 上限 ---------- */
const items = [
  { fansub: 'ANi' }, { fansub: 'ANi' }, { fansub: 'ANi' },
  { fansub: 'LoliHouse' }, { fansub: 'LoliHouse' },
  { fansub: 'VCB-Studio' },
  { fansub: '' }                     // 没有字幕组的条目不参与聚合，但计入「全部」
];
const b = bar(items);
ok('≥2 个字幕组才出筛选条', b !== '' && b.indexOf('magnet-fansub-bar') >= 0);
ok('「全部」按总条数计数', b.indexOf('全部 7') >= 0, b.match(/全部 \d+/));
ok('按条数降序排列', b.indexOf('ANi') < b.indexOf('LoliHouse') && b.indexOf('LoliHouse') < b.indexOf('VCB-Studio'));
ok('组内计数正确', /ANi <em>3<\/em>/.test(b) && /LoliHouse <em>2<\/em>/.test(b) && /VCB-Studio <em>1<\/em>/.test(b));
ok('默认选中「全部」', /class="mf-chip active" data-fansub=""/.test(b));
ok('其他组默认不选中', (b.match(/mf-chip active/g) || []).length === 1);

const many = [];
for (let i = 0; i < 15; i++) { for (let k = 0; k <= i; k++) many.push({ fansub: '组' + i }); }
const bm = bar(many);
ok('超过 12 个组只出 12 个 chip + 折叠计数', (bm.match(/mf-chip/g) || []).length === 13 && bm.indexOf('+3') >= 0,
  (bm.match(/mf-chip/g) || []).length + ' / ' + bm.indexOf('+3'));
ok('上限时保留条数最多的组', bm.indexOf('组14') >= 0 && bm.indexOf('组0 <em>') < 0);

/* ---------- 3. 点选只重渲染列表 ---------- */
function chip(name) {
  const set = new Set();
  return {
    _name: name,
    classList: { toggle(cls, on) { on ? set.add(cls) : set.delete(cls); }, has(cls) { return set.has(cls); } },
    getAttribute() { return name; }
  };
}
const list = { innerHTML: '' };
const chips = [chip(''), chip('ANi'), chip('LoliHouse')];
const box = { _mItems: items, _mFansub: '', querySelector(sel) { return sel === '.magnet-list' ? list : null; } };
const barEl = { parentNode: box, querySelectorAll() { return chips; } };
const clicked = chips[1];
clicked.parentNode = barEl;
pick(clicked);
ok('选中态切换到被点的 chip', clicked.classList.has('active'));
ok('其余 chip 取消选中', !chips[0].classList.has('active') && !chips[2].classList.has('active'));
ok('盒子记住当前筛选组', box._mFansub === 'ANi');
ok('只渲染该组 3 条', (list.innerHTML.match(/class="magnet-result/g) || []).length === 3,
  (list.innerHTML.match(/class="magnet-result/g) || []).length);
ok('筛选后行内仍是该组字幕组', list.innerHTML.indexOf('ANi') >= 0 && list.innerHTML.indexOf('LoliHouse') < 0);

chips[0].parentNode = barEl;
pick(chips[0]);
ok('点「全部」恢复所有条数', (list.innerHTML.match(/class="magnet-result/g) || []).length === 7);

/* ---------- 4. 行渲染：动漫源 vs bt4g ---------- */
const animeRow = rows([{ title: '进击的巨人 01', magnet: 'magnet:?xt=urn:btih:abc', size: '110.5 GB',
  source: 'anime', fansub: 'VCB-Studio', date: '2026-04-10', seeders: '', leechers: '' }]);
ok('动漫行带 is-anime 标记', animeRow.indexOf('is-anime') >= 0);
ok('动漫源显示为「动漫」而不是内部标识 anime', animeRow.indexOf('>动漫<') >= 0 && animeRow.indexOf('>anime<') < 0);
ok('动漫行显示字幕组标签', animeRow.indexOf('mr-fansub') >= 0 && animeRow.indexOf('VCB-Studio') >= 0);
ok('动漫行显示发布日期（没有做种数时）', animeRow.indexOf('2026-04-10') >= 0);
ok('动漫行不显示「做种」', animeRow.indexOf('做种') < 0);

const bt4gRow = rows([{ title: '沙丘 Dune 2021', magnet: 'magnet:?xt=urn:btih:def', size: '1.2 GB',
  source: 'bt4g', seeders: '321', leechers: '12' }]);
ok('bt4g 行保留来源徽标', bt4gRow.indexOf('>bt4g<') >= 0);
ok('bt4g 行显示做种数', bt4gRow.indexOf('做种 321') >= 0);
ok('bt4g 行没有字幕组标签', bt4gRow.indexOf('mr-fansub') < 0);
ok('bt4g 行不带 is-anime', bt4gRow.indexOf('is-anime') < 0);

/* ---------- 5. 转义 ---------- */
const danger = rows([{ title: '<script>x</script>', magnet: 'magnet:?xt=urn:btih:a&b=1',
  source: 'anime', fansub: '<b>组</b>' }]);
ok('标题被转义', danger.indexOf('<script>') < 0 && danger.indexOf('&lt;script&gt;') >= 0);
ok('字幕组被转义', danger.indexOf('<b>组</b>') < 0);
ok('磁力串属性被转义', danger.indexOf('a&amp;b=1') >= 0);

console.log('magnet-anime 完成：' + pass + ' PASS / ' + fail + ' FAIL');
if (fail) process.exit(1);
