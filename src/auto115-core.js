/* =====================================================================
 * nfo-editor · 115 自动化共享核心（auto115-core.js）
 * 纯逻辑层：步骤表 / 命名规则 / 季集解析 / 分季阈值 / 冲突决策 / 任务合并，
 * 零 DOM 依赖、不读全局 state，依赖一律参数传入。
 * 由两端通过 <script src="src/auto115-core.js"> 加载，暴露全局 window.Auto115Core；
 * 手机端 ui-ios.js 与 PC 端 auto115.js 均以此处为单点真相，只留 API 调用 + 渲染薄层。
 * 演进由主线 AI 全权控；改这里 = 两端同时生效，务必跑 tests/auto115-flow-test.js 回归。
 * ===================================================================== */
(function (global) {
  'use strict';
  var api = {};

  /* ---------- 常量 ---------- */
  api.PROBE_GAPS = [5000, 5000, 10000];      // 探测时刻为提交后 5s / 10s / 20s（累计 20s 内探完 3 次），间隔依次 5s→5s→10s
  api.PROBE_MAX = 3;                         // 只探 3 次后转「等待中」
  api.DIR_SLACK_MS = 10 * 60 * 1000;         // 定位文件夹的时间窗宽限（任务提交前后 10 分钟内）
  api.FLOW_VERSION = 2;                      // 流程版本：v1=建新文件夹/移动/删文件夹（已废弃，存量任务自动重置）；v2=定位文件夹/清理/改名
  api.LOCK_GRACE_MS = 45000;                 // 宽限期：刚拿到锁的头 45s 允许还没跑到 running 步骤（读 Cookie/建目录）
  api.ZOMBIE_MS = 10 * 60 * 1000;            // 步骤 running 超过 10 分钟判死（僵尸清扫）
  api.SPLIT_MIN_EPISODES = 100;              // 剧集分季阈值：多季且总集数达到该值才建季文件夹，否则平铺（命名仍带 SxxExx）

  /* ---------- 步骤表（方案 B：先定容器再整理内容） ---------- */
  api.STEP_DEFS = [   // offline：单影片 6 步
    { key: 'submit',  label: '提交离线' },
    { key: 'wait',    label: '等待离线完成' },
    { key: 'mkdir',   label: '定位文件夹' },
    { key: 'cleanup', label: '修改文件夹名称' },   // 先定容器（独立任务改名为影片标题）
    { key: 'move',    label: '清理文件' },         // 删 sample/非主视频
    { key: 'rename',  label: '修改视频名称' }
  ];
  api.STEPS_TV = [    // 剧集离线 8 步
    { key: 'submit',  label: '提交离线' },
    { key: 'wait',    label: '等待离线完成' },
    { key: 'mkdir',   label: '定位文件夹' },      // 定位离线落地的文件夹
    { key: 'cleanup', label: '修改标题文件夹' },   // 先定容器（先改为剧集标题）
    { key: 'move',    label: '清除无关文件' },    // 删 sample / 非中文字幕
    { key: 'mkdir2',  label: '新建季文件夹' },    // 在容器内建 S01/S02
    { key: 'rename',  label: '修改视频名称' },    // 视频/字幕按 SxxExx 改名
    { key: 'move2',   label: '移入对应视频' }     // 把改好名的文件移进 Sxx
  ];
  api.STEPS_UPLOAD = [ // upload：上传 NFO 两步
    { key: 'dir',    label: '准备文件夹' },
    { key: 'upload', label: '上传文件' }
  ];
  api.STEP_TABLE = { offline: api.STEP_DEFS, tv: api.STEPS_TV, upload: api.STEPS_UPLOAD };

  /* ---------- 任务模型纯函数 ---------- */
  function taskType(t){ return (t && t.type === 'upload') ? 'upload' : 'offline'; }
  api.taskType = taskType;
  /* 步骤表按任务类型取；旧任务没有 type 一律按 offline 处理（兼容存量数据） */
  api.newSteps = function (type, isTv) {
    var table = api.STEP_TABLE[type] || (isTv ? api.STEPS_TV : api.STEP_DEFS);
    return table.map(function (s) { return { key: s.key, state: 'idle', msg: '', at: 0, probes: 0 }; });
  };
  api.getStep = function (t, key) {
    var steps = t.steps || [];
    for (var i = 0; i < steps.length; i++) if (steps[i].key === key) return steps[i];
    var s = { key: key, state: 'idle', msg: '', at: 0, probes: 0 };
    steps.push(s); t.steps = steps; return s;
  };
  api.stepLabel = function (key) {
    var all = api.STEP_DEFS.concat(api.STEPS_TV).concat(api.STEPS_UPLOAD);
    for (var i = 0; i < all.length; i++) if (all[i].key === key) return all[i].label;
    return key;
  };
  /* 大状态合成。isTv 由调用方传入（引擎端读当前影片详情判定）。 */
  api.status = function (t, isTv) {
    var steps = t.steps || [];
    for (var i = 0; i < steps.length; i++){
      if (steps[i].state === 'fail') return { text: '失败 · ' + api.stepLabel(steps[i].key), cls: 'ab-fail' };
    }
    if (t.aborted) return { text: '已中止', cls: 'ab-idle' };
    if (taskType(t) === 'upload'){
      /* 上传任务只有两步；具体进度（上传中 (2/3)：xxx.jpg）写在步骤 msg 里，大状态只给粗粒度 */
      var up = api.getStep(t, 'upload');
      if (up.state === 'running') return { text: '上传中', cls: 'ab-run' };
      if (api.getStep(t, 'dir').state === 'running') return { text: '准备中…', cls: 'ab-run' };
      if (up.state === 'ok') return { text: '已完成', cls: 'ab-ok' };
      return { text: '待上传', cls: 'ab-idle' };
    }
    var wait = api.getStep(t, 'wait');
    if (wait.state === 'waiting') return { text: '等待中 · 已探 ' + (wait.probes || 0) + '/' + api.PROBE_MAX, cls: 'ab-wait' };
    if (api.getStep(t, 'submit').state === 'running') return { text: '提交中…', cls: 'ab-run' };
    if (wait.state === 'running') return { text: '离线中 (' + ((wait.probes || 0) + 1) + '/' + api.PROBE_MAX + ')', cls: 'ab-run' };
    var allDefs = (isTv ? api.STEPS_TV : api.STEP_DEFS);
    for (var j = 2; j < allDefs.length; j++){
      if (api.getStep(t, allDefs[j].key).state === 'running'){
        return { text: '整理中 · ' + allDefs[j].label, cls: 'ab-run' };
      }
    }
    var cleanup = api.getStep(t, 'cleanup');
    if (cleanup.state === 'ok' || cleanup.state === 'skip') return { text: '已完成', cls: 'ab-ok' };
    if (t.queued) return { text: '排队中', cls: 'ab-wait' };
    return { text: '待提交', cls: 'ab-idle' };
  };
  /* 任务是否真的在跑：只要有任一步骤处于 running 就算活跃（waiting/ok/idle/skip 都不算） */
  api.isActive = function (t) {
    if (!t || t.aborted) return false;
    var steps = t.steps || [];
    for (var i = 0; i < steps.length; i++) if (steps[i].state === 'running') return true;
    return false;
  };
  /* 僵尸判定：running 超过 ZOMBIE_MS 无响应 → 判死（可重试） */
  api.isZombieStep = function (s, now) {
    return s.state === 'running' && s.at && now - s.at > api.ZOMBIE_MS;
  };
  /* 合并任务列表：内存里的任务对象保持原引用（正在跑的任务绝不能被换掉），
     只把数据库里有、内存里没有的补进来（补进来的排在后面）。 */
  api.mergeTasks = function (memTasks, savedTasks) {
    var out = [], seen = {};
    for (var i = 0; i < memTasks.length; i++){
      var m = memTasks[i];
      if (!m || !m.id || seen[m.id]) continue;
      out.push(m); seen[m.id] = 1;
    }
    for (var j = 0; j < savedTasks.length; j++){
      var s = savedTasks[j];
      if (!s || !s.id || seen[s.id]) continue;
      out.push(s); seen[s.id] = 1;
    }
    return out;
  };
  /* 探测间隔：第 N 次探测前等多久（0-based） */
  api.probeDelay = function (doneProbes) {
    var i = Math.min(Math.max(doneProbes || 0, 0), api.PROBE_GAPS.length - 1);
    return api.PROBE_GAPS[i];
  };

  /* ---------- 格式化 ---------- */
  api.timeFmt = function (ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
  };
  api.btih = function (magnet) {
    var m = /btih:([0-9a-fA-F]{40}|[0-9a-zA-Z]{32})/.exec(magnet || '');
    return m ? m[1].toUpperCase() : '';
  };
  api.sizeFmt = function (n) {
    if (!n) return '0 B';
    var u = ['B','KB','MB','GB','TB'], i = 0;
    while (n >= 1024 && i < u.length - 1){ n /= 1024; i++; }
    return (i ? n.toFixed(1) : n) + ' ' + u[i];
  };
  api.errText = function (d, res, fallback) {
    var m = (d && (d.error || d.message || d.error_msg)) || (res && res.raw ? String(res.raw).slice(0, 120) : '') || fallback || '失败';
    return String(m).slice(0, 160);
  };

  /* ---------- 命名规则 ---------- */
  api.norm = function (s) { return (s || '').toLowerCase().replace(/[^a-z0-9一-龥]/g, ''); };
  api.partBase = function (name) {
    var n = (name || '').replace(/\.[a-z0-9]+$/i, '');
    n = n.replace(/\s*(cd|disc|disk|part|pt)\s*\d+\s*$/i, '');
    n = n.replace(/[-._ ]?\d+\s*$/, '');
    return api.norm(n);
  };
  /* 单影片主视频名：有番号走番号、无番号走 标题.原始标题.年份（doc 为 {filmTitle, originalTitle, year}） */
  api.movieVideoName = function (doc) {
    doc = doc || {};
    var title = (doc.filmTitle || '').trim();
    var orig = (doc.originalTitle || '').trim();
    var year = (doc.year || '').trim();
    var name;
    if (!year){ name = title; }                                          // 无年份 → 仅标题
    else if (orig && orig.toLowerCase() !== title.toLowerCase()){ name = title + '.' + orig.replace(/ /g, '.') + '.' + year; }
    else { name = title + '.' + year; }                                  // 无原始标题 或 标题=原始标题 → 标题.年份
    return name.replace(/ /g, '.').replace(/[\/\\:*?"<>|]/g, '').trim();
  };
  api.looksDvd = function (s) { return /^[A-Za-z]{2,}-?\d+[A-Za-z]?$/i.test((s || '').trim()); };
  api.cleanName = function (s) { return (s || '').replace(/ /g, '.').replace(/[\/\\:*?"<>|]/g, '').trim(); };
  /* 外部磁力任务：目标名称判定（番号 vs 标题） */
  api.externalBaseName = function (t) {
    if (!t.targetName) return '';
    return api.looksDvd(t.targetName) ? t.targetName.trim() : api.cleanName(t.targetName);
  };
  api.vidSize = function (it) { return Number(it.s != null ? it.s : it.size) || 0; };
  api.isVideoName = function (n) { return /\.(mp4|mkv|avi|rmvb|mov|ts|flv|wmv|m4v|mpg|mpeg|webm|iso)$/i.test(n || ''); };
  api.isSubtitle = function (name) { return /\.(srt|ass|ssa|sub|idx|vtt|smi|lrc|txt)$/i.test(name || ''); };
  /* 字幕语言：仅识别中文（简中 zh / 繁中 zt）；其余返回 null（不保留） */
  api.subLang = function (name) {
    var n = (name || '').toLowerCase();
    if (/(chs|简体|简中|\.zh|_zh|-zh| zh |chinese\(s\)|gb|sc\b)/.test(n)) return 'zh';
    if (/(cht|繁体|繁中|\.zt|_zt|-zt| zt |big5|tc\b)/.test(n)) return 'zt';
    if (/中文字幕/.test(n) && !/繁/.test(n)) return 'zh';
    return null;
  };

  /* ---------- 剧集（TV）命名与解析 ---------- */
  /* 中文数字 → 阿拉伯数字（支持 零~九十九；纯阿拉伯直接转） */
  api.cnNum = function (s) {
    if (s == null) return null;
    s = String(s).trim();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    var d = { '零':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9 };
    var n = 0, cur = 0, has = false;
    for (var i = 0; i < s.length; i++){
      var ch = s[i];
      if (ch === '十'){ cur = (cur === 0) ? 10 : cur * 10; n += cur; cur = 0; has = true; }
      else if (ch === '百'){ cur = (cur === 0) ? 100 : cur * 100; n += cur; cur = 0; has = true; }
      else if (d[ch] != null){ cur = d[ch]; has = true; }
      else break;
    }
    n += cur;
    return has ? n : null;
  };
  /* 从文件名解析 {season, episode}（season 默认 1）；认不到集返回 episode:null；什么都不认返回 null */
  api.episodeOf = function (name) {
    name = String(name || '');
    var low = name.toLowerCase();
    var m;
    m = low.match(/s(\d{1,2})[.\-_ ]?e(\d{1,3})/); if (m) return { season: +m[1], episode: +m[2] };
    m = low.match(/(\d{1,2})[x×](\d{1,3})/); if (m) return { season: +m[1], episode: +m[2] };
    m = low.match(/[\[\(](\d{1,3})[\]\)]/); if (m) return { season: 1, episode: +m[1] };
    m = low.match(/\b(?:ep|e)(\d{1,3})/); if (m) return { season: 1, episode: +m[1] };
    var seasonCn = name.match(/第\s*([零一二两三四五六七八九十百\d]+)\s*[季部]/);
    var epCn = name.match(/第\s*([零一二两三四五六七八九十百\d]+)\s*集/);
    var season = seasonCn ? (api.cnNum(seasonCn[1]) || 1) : 1;
    if (epCn) return { season: season, episode: api.cnNum(epCn[1]) || 1 };
    if (seasonCn) return { season: season, episode: null };
    return null;
  };
  api.ext = function (name) { var m = /\.[a-z0-9]+$/i.exec(name || ''); return m ? m[0] : ''; };
  api.pad2 = function (n) { n = Math.max(1, n | 0); return (n < 10 ? '0' : '') + n; };
  /* 剧集根文件夹名（只取标题，与用户定的 剧集标题/ 结构一致） */
  api.tvDirName = function (showTitle) { return api.cleanName(showTitle) || 'show'; };
  api.tvVideoName = function (showTitle, season, ep, ext) {
    return api.tvDirName(showTitle) + '.S' + api.pad2(season) + 'E' + api.pad2(ep) + (ext || '');
  };
  api.tvSubName = function (showTitle, season, ep, lang, ext) {
    return api.tvDirName(showTitle) + '.S' + api.pad2(season) + 'E' + api.pad2(ep) + '.' + lang + (ext || '');
  };
  /* 纯函数：把扫描到的条目规划成「重命名（含移入季文件夹）+ 待删」列表。
     items: [{fid, name}]（仅文件）。返回 {renames:[{fid,name}], deleteFids:[fid]} */
  api.tvPlan = function (showTitle, items) {
    var vids = [], subs = [], junk = [];
    items.forEach(function (it) {
      var nm = it.name || '';
      if (api.isVideoName(nm)){
        if (/sample|预告|trailer|preview|特典|extra|花絮|menu|bonus/i.test(nm)) junk.push(it);
        else vids.push(it);
      }
      else if (api.isSubtitle(nm)) subs.push(it);
      else junk.push(it);
    });
    vids.sort(function (a, b) { return a.name > b.name ? 1 : (a.name < b.name ? -1 : 0); });
    subs.sort(function (a, b) { return a.name > b.name ? 1 : (a.name < b.name ? -1 : 0); });
    function key(s, e) { return s + '-' + e; }
    var occupied = {};
    function take(s, e) { occupied[key(s, e)] = true; }
    function nextEp(s) { var e = 1; while (occupied[key(s, e)]) e++; take(s, e); return e; }
    var vidPlan = [], vidPending = [];
    vids.forEach(function (it) {
      var ep = api.episodeOf(it.name);
      if (ep && ep.episode){ var s = ep.season || 1; if (!occupied[key(s, ep.episode)]){ take(s, ep.episode); vidPlan.push({ fid: it.fid, season: s, ep: ep.episode, orig: it.name, size: it.s || 0 }); return; } }
      vidPending.push(it);
    });
    vidPending.forEach(function (it) {
      var ep = api.episodeOf(it.name);
      var s = (ep && ep.season) || 1;
      vidPlan.push({ fid: it.fid, season: s, ep: nextEp(s), orig: it.name, size: it.s || 0 });
    });
    var subPlan = [], subPending = [];
    subs.forEach(function (it) {
      var lang = api.subLang(it.name);
      if (!lang){ junk.push(it); return; }
      var ep = api.episodeOf(it.name);
      if (ep && ep.episode){ var s2 = ep.season || 1; subPlan.push({ fid: it.fid, season: s2, ep: ep.episode, lang: lang, orig: it.name, size: it.s || 0 }); return; }
      subPending.push({ it: it, lang: lang });
    });
    subPending.forEach(function (sp, idx) {
      var vp = vidPending[idx];
      var epInfo = vp ? api.episodeOf(vp.name) : null;
      var season = (epInfo && epInfo.season) || 1;
      var matchVid = null;
      for (var i = 0; i < vidPlan.length; i++){ if (vidPlan[i].orig === (vp && vp.name)){ matchVid = vidPlan[i]; break; } }
      var epNo = matchVid ? matchVid.ep : nextEp(season);
      subPlan.push({ fid: sp.it.fid, season: season, ep: epNo, lang: sp.lang, orig: sp.it.name, size: sp.it.s || 0 });
    });
    var renames = [];
    vidPlan.forEach(function (p) { renames.push({ fid: p.fid, name: api.tvVideoName(showTitle, p.season, p.ep, api.ext(p.orig)), orig: p.orig, size: p.size }); });
    subPlan.forEach(function (p) { renames.push({ fid: p.fid, name: api.tvSubName(showTitle, p.season, p.ep, p.lang, api.ext(p.orig)), orig: p.orig, size: p.size }); });
    var deleteFids = junk.map(function (it) { return it.fid; }).filter(Boolean);
    return { renames: renames, deleteFids: deleteFids };
  };
  /* 是否分季：只有一季 → 不分；多季但总集数不足 SPLIT_MIN_EPISODES → 不分；
     多季且总集数达到阈值 → 才建季文件夹。不分季时文件平铺在剧集根文件夹里，命名仍带 SxxExx。 */
  api.tvNeedSeasonSplit = function (plan) {
    var MIN = api.SPLIT_MIN_EPISODES;
    var seasons = {}, vids = 0;
    (plan.renames || []).forEach(function (r) {
      var m = /S(\d{2})E/.exec(r.name || '');
      if (m) seasons[m[1]] = true;
      if (api.isVideoName(r.name || '')) vids++;
    });
    var keys = Object.keys(seasons).sort();
    if (keys.length <= 1) return { split: false, seasons: keys, videos: vids, reason: '只有 ' + (keys.length || 1) + ' 季，无需分季' };
    if (vids < MIN){
      return { split: false, seasons: keys, videos: vids, reason: '共 ' + vids + ' 集（不足 ' + MIN + ' 集），无需分季' };
    }
    return { split: true, seasons: keys, videos: vids, reason: '共 ' + vids + ' 集，达到 ' + MIN + ' 集阈值' };
  };

  /* ---------- 移入冲突决策（纯函数，供两端 auto115MoveInto 使用） ---------- */
  /* jobs: [{fid, name, orig, size}]；list: 目标文件夹现有条目 [{n, s}]。
     同名文件大小相同 → 视为同一文件跳过；大小不同 → 目标名加 .2 避免撞名（原地改写 job.name）。
     返回 {todo: 待移入任务, skipped: 跳过数}。 */
  api.planMoveJobs = function (jobs, list) {
    var existing = {};
    (list || []).forEach(function (it) { if (it && it.n) existing[String(it.n).toLowerCase()] = it.s || 0; });
    var todo = [], skipped = 0;
    (jobs || []).forEach(function (job) {
      var exSize = existing[job.name.toLowerCase()];
      if (exSize == null){ todo.push(job); return; }
      if (job.size != null && Math.abs((job.size || 0) - exSize) < 1){ skipped++; return; } /* 同一文件，跳过 */
      var m2 = job.name.match(/^(.*)(\.[a-z0-9]+)$/i);
      job.name = (m2 ? m2[1] : job.name) + '.2' + (m2 ? m2[2] : '');
      todo.push(job);
    });
    return { todo: todo, skipped: skipped };
  };

  global.Auto115Core = api;
  /* Node 环境下支持 require 加载（供 tests/auto115-core-test.js 直接单测） */
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
