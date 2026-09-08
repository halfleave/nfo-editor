// 隔离单测：翻译触发状态机（复制核心逻辑，mock 依赖，不调真实接口）
const state = {
  translatingIds: new Set(),
  translatingInFlight: new Set(),
  pendingTranslateIds: new Set(),
};
let translateMetaCalls = 0;
let startFilmTranslationCalls = 0;
let savedPlot = null;

function translateConfigReady(){ return true; }
function renderOverview(){}
function showToast(){}
function getVal(){ return ''; }
function setFieldVal(){}
function saveFilm(f){ savedPlot = (f.data && f.data.plot) || null; return Promise.resolve(); }
function loadFilm(id){ return Promise.resolve({ id, data:{ title:'FOO-001 タイトル', plot:'日本語のあらすじ' }, title:'FOO-001 タイトル' }); }
function computeTranslateNeed(f){
  const k = /[ぁ-んァ-ヶ]/;
  var t=(f.data&&f.data.title)||f.title||'';
  var p=(f.data&&f.data.plot)||'';
  return { title:k.test(t), plot:k.test(p) };
}
function translateMeta(t,p){ translateMetaCalls++; return Promise.resolve({ title:'FOO-001 标题', summary:'中文简介' }); }

function startFilmTranslation(id){
  if (!translateConfigReady() || state.translatingInFlight.has(id)) return;
  startFilmTranslationCalls++;
  loadFilm(id).then(function(f){
    if (!f) return;
    var need = computeTranslateNeed(f);
    if (!need.title && !need.plot){ return; }
    state.translatingInFlight.add(id);
    state.translatingIds.add(id);
    renderOverview();
    var title = (f.data&&f.data.title)||f.title||'';
    var plot = (f.data&&f.data.plot)||'';
    translateMeta(title, plot).then(function(res){
      loadFilm(id).then(function(ff){
        if (!ff){ finishTranslation(id); return; }
        var newTitle = res.title||''; var newSummary = res.summary||'';
        var changed=false;
        if (need.title && newTitle && newTitle!==title){ ff.title=newTitle; if(ff.data)ff.data.title=newTitle; changed=true; }
        if (need.plot && newSummary && newSummary!==plot){ if(ff.data)ff.data.plot=newSummary; changed=true; }
        if (!changed){ finishTranslation(id); return; }
        saveFilm(ff).then(function(){ finishTranslation(id); renderOverview(); showToast('ok'); });
      }).catch(function(){ finishTranslation(id); });
    }).catch(function(){ finishTranslation(id); showToast('fail'); });
  }).catch(function(){});
}
function finishTranslation(id){
  state.translatingIds.delete(id);
  state.translatingInFlight.delete(id);
  renderOverview();
}
function markPendingTranslate(id){
  if (!translateConfigReady()) return;
  state.translatingIds.add(id);
  renderOverview();
  state.pendingTranslateIds.add(id);
  setTimeout(function(){ flushPendingTranslate(id); }, 6000);
}
function flushPendingTranslate(id){
  if (state.pendingTranslateIds.has(id)){
    state.pendingTranslateIds.delete(id);
    startFilmTranslation(id);
  }
}

(async function(){
  let pass = true;
  function check(name, cond){ if(!cond){ pass=false; console.log('FAIL: '+name); } else console.log('OK  : '+name); }

  // 1. saveToDisk 路径：mark + 立即 flush
  markPendingTranslate('A');
  check('保存时图标显示(translatingIds 含 A)', state.translatingIds.has('A'));
  check('保存时 pending 含 A', state.pendingTranslateIds.has('A'));
  flushPendingTranslate('A'); // saveToDisk 立即 flush
  check('flush 后 pending 清空', !state.pendingTranslateIds.has('A'));
  check('flush 触发 startFilmTranslation', startFilmTranslationCalls === 1);
  check('flush 时图标仍显示(inFlight)', state.translatingInFlight.has('A'));

  // 等待异步翻译完成
  await new Promise(r=>setTimeout(r, 50));
  check('翻译完成图标消失', !state.translatingIds.has('A') && !state.translatingInFlight.has('A'));
  check('翻译一次请求(translateMeta 调用 1 次)', translateMetaCalls === 1);
  check('plot 被覆盖为中文', savedPlot === '中文简介');

  // 2. quickSaveAndHome 路径：mark 后不立即 flush，等 silentRefresh
  startFilmTranslationCalls = 0; translateMetaCalls = 0;
  markPendingTranslate('B');
  check('B 保存时图标显示', state.translatingIds.has('B'));
  // 模拟 silentRefresh 后来 flush
  flushPendingTranslate('B');
  await new Promise(r=>setTimeout(r, 50));
  check('B 经 silentRefresh flush 后翻译完成', !state.translatingIds.has('B'));
  check('B 翻译一次请求', translateMetaCalls === 1);

  // 3. 防重入：silentRefresh 重复 flush 不重复翻译
  startFilmTranslationCalls = 0; translateMetaCalls = 0;
  markPendingTranslate('C');
  flushPendingTranslate('C');        // 第一次
  flushPendingTranslate('C');        // 重复（pending 已删，不应再触发）
  await new Promise(r=>setTimeout(r, 50));
  check('重复 flush 不重复翻译(translateMeta 仍 1 次)', translateMetaCalls === 1);

  console.log(pass ? '\nALL PASS' : '\nHAS FAIL');
  process.exit(pass?0:1);
})();
