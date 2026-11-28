/* v538 隔离测试：任务自带影片身份快照，验证多影片并发时改名不串档。
   不依赖浏览器/IndexedDB，抽取 ui-ios.js 的三个函数 + stub 全局状态。 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui-ios.js'), 'utf8');
function slice(startMark, endMark){
  const a = src.indexOf(startMark);
  const b = src.indexOf(endMark, a);
  if (a < 0 || b < 0) throw new Error('切片失败: ' + startMark);
  return src.slice(a, b);
}
// auto115DocOf → auto115FilmSnapOf → auto115TaskDoc（到 auto115GetStep 前）
const code = slice('function auto115DocOf(t){', 'function auto115GetStep(t, key)');

const ctx = {
  auto115Doc: null, auto115ExecDoc: null, auto115LibraryDoc: null,
  console,
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

let pass = 0, fail = 0;
function ok(name, cond, extra){
  if (cond){ pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? '  -> ' + extra : '')); }
}

// 影片 A / C 各自的归属文档
const docA = { filmId: 'A', filmTitle: '影片A的片名', dvdId: 'ABP-001', type: 'movie', originalTitle: '', year: '', tasks: [] };
const docC = { filmId: 'C', filmTitle: '影片C的片名', dvdId: 'CDP-009', type: 'movie', originalTitle: '', year: '', tasks: [] };
const snapA = ctx.auto115FilmSnapOf(docA);

function setGlobals(cur, exec){ ctx.auto115Doc = cur; ctx.auto115ExecDoc = exec; ctx.auto115LibraryDoc = null; }

// 场景1（核心）：任务 A 归属影片 A，但全局当前影片/执行绑定都被影片 C 占着。
// 老逻辑会兜底 docC → 串名；新逻辑用任务自带快照 → 影片 A 的片名。
setGlobals(docC, docC);
const taskA = { id: 'tA', filmId: 'A', filmSnap: snapA };
docC.tasks = [];  // A 的任务不在当前影片任务列表里（引用比对失效）
let d = ctx.auto115TaskDoc(taskA);
ok('并发串档：用任务快照片名，不抓当前影片', d.filmTitle === '影片A的片名' && d.dvdId === 'ABP-001', d.filmTitle + ' / ' + d.dvdId);
ok('并发串档：不是影片C的片名', d.filmTitle !== '影片C的片名');

// 场景2：引用命中（任务就在当前 doc.tasks 里）→ 仍返回真 doc，进度写入路径不变
docC.tasks = [taskA];
setGlobals(docC, null);
d = ctx.auto115TaskDoc(taskA);
ok('引用命中：返回归属文档本体', d === docC);

// 场景3：执行绑定文档的 filmId 对得上 → 返回执行绑定文档
docC.tasks = [];
const execA = { filmId: 'A', filmTitle: '执行文档A', dvdId: '', type: 'movie', tasks: [] };
setGlobals(docC, execA);
d = ctx.auto115TaskDoc(taskA);
ok('filmId 命中执行文档', d === execA);

// 场景4：老任务（无 filmSnap）行为不变——归属全失联时仍兜底当前影片
setGlobals(docC, docC);
const oldTask = { id: 'tOld', filmId: 'X' };
d = ctx.auto115TaskDoc(oldTask);
ok('老任务无快照：保持原兜底（当前影片）', d === docC);

// 场景5：tbm 任务仍走虚拟文档，不受影响
setGlobals(docC, docC);
const tbm = { tbm: true, targetName: '磁力库片名', tbmType: 'tv' };
d = ctx.auto115TaskDoc(tbm);
ok('tbm 任务：身份取 targetName', d.filmTitle === '磁力库片名' && d.type === 'tv', d.filmTitle + ' / ' + d.type);

// 场景6：快照字段完整（改名要用的 filmTitle/dvdId/type 都在）
ok('快照含改名所需字段', snapA.filmTitle === '影片A的片名' && snapA.dvdId === 'ABP-001' && snapA.type === 'movie' && snapA.filmId === 'A');

console.log('\n--- pass=' + pass + ' fail=' + fail);
process.exit(fail ? 1 : 0);
