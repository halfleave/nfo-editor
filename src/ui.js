
/* ===================================================================
   呈现层 —— PC 桌面交互
   依赖 core 层（存储 / 数据源 / NFO / ZIP / 编码表）
   =================================================================== */

/* ---------- 通用图标 ---------- */
var ICON = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>',
  lock:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M6 10V8a6 6 0 0 1 12 0v2"/></svg>',
  film:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 7h4M3 12h18M3 17h4M17 7h4M17 17h4"/></svg>',
  user:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
};

/* ---------- Toast ---------- */
function showToast(msg, type, duration){
  var box = document.getElementById('toasts');
  if (!box) return;
  var el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  var ic = (type === 'success') ? ICON.check : (type === 'error' ? ICON.alert : '');
  el.innerHTML = ic + '<span></span>';
  el.querySelector('span').textContent = msg || '';
  box.appendChild(el);
  var life = duration || 1900;
  setTimeout(function(){
    el.classList.add('out');
    setTimeout(function(){ if (el.parentNode) el.parentNode.removeChild(el); }, 220);
  }, life);
}

/* ---------- 复制到剪贴板 ---------- */
function copyText(text, labelOrCb){
  var cb = (typeof labelOrCb === 'function') ? labelOrCb : null;
  var label = (typeof labelOrCb === 'string' && labelOrCb) ? labelOrCb : '内容';
  function done(ok){
    showToast(ok ? ('已复制' + label) : '复制失败', ok ? 'success' : 'error');
    if (cb) cb(ok);
  }
  if (!text){ done(false); return; }
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(function(){ done(true); }, function(){ fallback(); });
  } else { fallback(); }
  function fallback(){
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      done(ok);
    } catch (e) { done(false); }
  }
}

/* ---------- 模态框 ---------- */
function openSheet(id){
  var mask = document.getElementById('sheetMask');
  if (mask) mask.classList.add('show');
  var m = document.getElementById(id);
  if (m){
    m.classList.add('show');
    var body = m.querySelector('.modal-body');
    if (body) body.scrollTop = 0;
    var f = m.querySelector('input,textarea,select');
    if (f && !m.hasAttribute('data-nofocus')) setTimeout(function(){ f.focus(); }, 60);
  }
}
function closeAllSheets(){
  var mask = document.getElementById('sheetMask');
  if (mask) mask.classList.remove('show');
  var ls = document.getElementById('listSheet');
  if (ls) ls.classList.remove('drawer-right');
  var list = document.querySelectorAll('.modal');
  for (var i = 0; i < list.length; i++) list[i].classList.remove('show');
  hideContextMenu();
}
function showAboutModal(){ openSheet('aboutModal'); }
function openApiHelp(){ openSheet('apiHelpSheet'); }

/* ---------- 通用确认对话框 ---------- */
var _confirmCb = null;
function showConfirm(opts){
  opts = opts || {};
  document.getElementById('confirmTitle').textContent = opts.title || '确认操作';
  document.getElementById('confirmDesc').textContent = opts.desc || '';
  var ok = document.getElementById('confirmOk');
  ok.textContent = opts.okText || '确定';
  ok.className = 'btn ' + (opts.danger === false ? 'btn-primary' : 'btn-danger');
  _confirmCb = opts.onOk || null;
  openSheet('confirmModal');
}
function closeConfirm(){
  _confirmCb = null;
  var m = document.getElementById('confirmModal');
  if (m) m.classList.remove('show');
  if (!document.querySelector('.modal.show')){
    var mask = document.getElementById('sheetMask');
    if (mask) mask.classList.remove('show');
  }
}
document.getElementById('confirmOk').addEventListener('click', function(){
  var cb = _confirmCb;
  closeConfirm();
  if (cb) cb();
});

/* ---------- 右键菜单 ---------- */
var _ctxOpen = false;
function showContextSheet(title, items, anchor){
  var el = document.getElementById('contextSheet');
  var titleEl = document.getElementById('contextSheetTitle');
  var inner = document.getElementById('contextSheetInner');
  if (!el || !inner) return;
  if (title){ titleEl.textContent = title; titleEl.classList.remove('hidden'); }
  else { titleEl.classList.add('hidden'); }
  inner.innerHTML = '';
  (items || []).forEach(function(it){
    if (it.sep){
      var sep = document.createElement('div');
      sep.className = 'menu-sep';
      inner.appendChild(sep);
      return;
    }
    var b = document.createElement('button');
    b.className = 'menu-item' + (it.danger ? ' danger' : '');
    if (it.disabled) b.disabled = true;
    var ic = (it.icon && CTX_ICONS[it.icon]) ? CTX_ICONS[it.icon] : (it.danger ? CTX_ICONS.trash : '');
    b.innerHTML = (ic || '') + '<span></span>';
    b.querySelector('span').textContent = it.label;
    if (!it.disabled){
      b.onclick = function(){ hideContextMenu(); if (it.onClick) it.onClick(); };
    }
    inner.appendChild(b);
  });
  el.style.left = '0px';
  el.style.top = '0px';
  el.classList.add('show');
  var w = el.offsetWidth, h = el.offsetHeight;
  var vw = window.innerWidth, vh = window.innerHeight, pad = 8;
  var x = anchor ? anchor.x : (vw / 2), y = anchor ? anchor.y : (vh / 2);
  if (x + w > vw - pad) x = Math.max(pad, x - w);
  if (y + h > vh - pad) y = Math.max(pad, vh - h - pad);
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  _ctxOpen = true;
  setTimeout(function(){ document.addEventListener('mousedown', _ctxOutside, true); }, 0);
}
function _ctxOutside(e){
  var el = document.getElementById('contextSheet');
  if (el && el.contains(e.target)) return;
  hideContextMenu();
}
function hideContextMenu(){
  var el = document.getElementById('contextSheet');
  if (el) el.classList.remove('show');
  _ctxOpen = false;
  document.removeEventListener('mousedown', _ctxOutside, true);
}

/* ---------- 路由 ---------- */
function switchPage(page){
  var pages = document.querySelectorAll('.page');
  for (var i = 0; i < pages.length; i++){
    pages[i].classList.toggle('active', pages[i].id === 'page-' + page);
  }
  var navs = document.querySelectorAll('.nav-item');
  for (var j = 0; j < navs.length; j++){
    navs[j].classList.toggle('active', navs[j].getAttribute('data-page') === page);
  }
  if (page === 'search'){
    if (!state.themeHidden){
      state.metaSource = 'tmdb';
      state.overviewTab = 'movie';
    }
    syncSearchSourceUI();
    updateSearchPlaceholder();
    renderSearchHistory();
  }
  if (page === 'settings') syncThemeHiddenSwitch();
  if (page === 'edit'){
    var navEdit = document.getElementById('navEdit');
    if (navEdit) navEdit.style.display = '';
  }
  var sc = document.querySelector('#page-' + page + ' .page-scroll');
  if (sc) sc.scrollTop = 0;
}
function goLibrary(){
  if (document.body.classList.contains('edit-modal-open')){ closeEditModal(); return; }
  switchPage('home');
}
function goBackFromDetail(){ stopDetailBgSlideshow(); trimShotsToInitial(); switchPage('home'); }
function toggleSidebar(){
  var sb = document.getElementById('sidebar');
  if (!sb) return;
  var collapsed = sb.classList.toggle('collapsed');
  try { localStorage.setItem('nfo.pc.sidebarCollapsed', collapsed ? '1' : '0'); } catch(e){}
  document.body.classList.toggle('sidebar-expanded', !collapsed);
}
function setLibraryView(view){
  state._libView = view;
  var btns = document.querySelectorAll('#libViewGroup .btn');
  for (var i = 0; i < btns.length; i++){
    btns[i].classList.toggle('active', btns[i].getAttribute('data-view') === view);
  }
  idbPut('kv', 'libView', view).catch(function(){});
  renderOverview();
}

/* ---------- 表单工具 ---------- */
function setSelectValue(id, val){
  var el = document.getElementById(id);
  if (el) el.value = (val === undefined || val === null) ? '' : String(val);
}
function setYear(y){
  setSelectValue('year', y || '');
  state.year = y ? String(y) : '';
  updateState();
}
function initNativeSelects(){
  var cur = new Date().getFullYear();
  var yearHtml = '<option value="">请选择</option>';
  for (var y = cur + 3; y >= 1900; y--){
    yearHtml += '<option value="' + y + '">' + y + '</option>';
  }
  var ySel = document.getElementById('year');
  if (ySel) ySel.innerHTML = yearHtml;
  var mSel = document.getElementById('mpaa');
  if (mSel){
    mSel.innerHTML = '<option value="">请选择</option>' +
      MPAA_LIST.map(function(v){ return '<option value="' + v + '">' + v + '</option>'; }).join('');
  }
}

/* ---------- 编辑模式（成人 / 普通） ---------- */
function applyEditMode(){
  var adult = !!state.adult;
  var dirSec = document.getElementById('directorSection');
  if (dirSec) dirSec.style.display = adult ? 'none' : '';
  var actH = document.getElementById('actorHeading');
  if (actH){
    var lbl = actH.querySelector('.section-title span');
    if (lbl) lbl.textContent = adult ? '女优' : '演员';
  }
  var av = document.getElementById('avFieldsCard');
  if (av) av.style.display = '';
}

/* ---------- 外观 ---------- */
var appearanceMQ = null;
function applyAppearance(mode){
  if (mode === 'auto'){
    if (!appearanceMQ){
      appearanceMQ = window.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function(){ if (state.appearance === 'auto') applyAppearanceValue(appearanceMQ.matches ? 'dark' : 'light'); };
      if (appearanceMQ.addEventListener) appearanceMQ.addEventListener('change', onChange);
      else if (appearanceMQ.addListener) appearanceMQ.addListener(onChange);
    }
    applyAppearanceValue(appearanceMQ.matches ? 'dark' : 'light');
  } else {
    applyAppearanceValue(mode);
  }
  reapplyThemeColor();
}
function updateAppearanceDisplay(){
  setSelectValue('appearanceSelect', state.appearance);
  syncAppearanceSeg();
}
function syncAppearanceSeg(){
  var seg = document.getElementById('appearanceSeg');
  if (!seg) return;
  var btns = seg.querySelectorAll('button');
  for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('active', btns[i].getAttribute('data-mode') === (state.appearance || 'auto'));
}
function onAppearanceSegClick(mode){ setAppearance(mode); syncAppearanceSeg(); }
function updateAutoClearDisplay(){ setSelectValue('autoClearSelect', state.autoClear); }
function onAppearanceSelect(sel){ setAppearance(sel.value); }
function onAutoClearSelect(sel){
  state.autoClear = sel.value;
  setAutoClearMode(state.autoClear);
  updateAutoClearDisplay();
}
function populateSettingSelects(){
  var ac = document.getElementById('autoClearSelect');
  if (ac) ac.innerHTML = AUTO_CLEAR_MODES.map(function(m){ return '<option value="' + m.key + '">' + m.label + '</option>'; }).join('');
  var ap = document.getElementById('appearanceSelect');
  if (ap) ap.innerHTML = APPEARANCE_MODES.map(function(m){ return '<option value="' + m.key + '">' + m.label + '</option>'; }).join('');
  setSelectValue('autoClearSelect', state.autoClear);
  setSelectValue('appearanceSelect', state.appearance);
}

/* ---------- 主题色 ---------- */
function renderThemeGrid(){
  var grid = document.getElementById('themeGrid');
  var current = (getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#007AFF').trim().toLowerCase();
  if (grid){
    grid.innerHTML = THEME_COLORS.map(function(c){
      return '<button class="swatch' + (c.toLowerCase() === current ? ' active' : '') + '" style="background:' + c + '" onclick="applyThemeColor(\'' + c + '\', true)" aria-label="主题色 ' + c + '"></button>';
    }).join('');
  }
  renderDrawerThemeGrid();
}
function openThemeSheet(){ renderThemeGrid(); }

/* ---------- 里模式 ---------- */
function toggleThemeHidden(cb){
  state.themeHidden = !!(cb && cb.checked);
  setThemeHidden(state.themeHidden);
  syncThemeHiddenSwitch();
  updateHiddenBadge();
  updateOverviewTabVisibility();
  updateSearchPlaceholder();
  syncSearchSourceUI();
  syncLibSearchUI();
  syncAdultPhraseRow();
  renderOverview();
  showToast(state.themeHidden ? '里模式已开启' : '里模式已关闭', 'success');
}
function toggleThemeHiddenDblClick(){
  state.themeHidden = !state.themeHidden;
  var sw = document.getElementById('themeHiddenSwitch');
  if (sw) sw.checked = state.themeHidden;
  setThemeHidden(state.themeHidden);
  syncThemeHiddenSwitch();
  updateHiddenBadge();
  updateOverviewTabVisibility();
  updateSearchPlaceholder();
  syncSearchSourceUI();
  syncLibSearchUI();
  syncAdultPhraseRow();
  renderOverview();
  showToast(state.themeHidden ? '里模式已开启' : '里模式已关闭', 'success');
}
function syncThemeHiddenSwitch(){
  var sw = document.getElementById('themeHiddenSwitch');
  if (sw) sw.checked = !!state.themeHidden;
  var group = document.getElementById('themeHiddenSettingsGroup');
  if (group) group.classList.toggle('hidden', !state.themeHidden);
  document.body.classList.toggle('theme-hidden', !!state.themeHidden);
  var badge = document.getElementById('hiddenBadge');
  if (badge) badge.style.display = state.themeHidden ? 'inline-flex' : 'none';
}
function syncAdultPhraseRow(){
  var row = document.getElementById('adultPhraseRow');
  if (row) row.style.display = state.themeHidden ? '' : 'none';
}
function updateHiddenBadge(){
  var badge = document.getElementById('hiddenBadge');
  if (badge) badge.style.display = state.themeHidden ? 'inline-flex' : 'none';
}
function onSettingsTitleTap(){ /* PC 版：里模式直接在设置里开关，无需连击 */ }
function closeThemeHidden(){
  if (!state.themeHidden) return;
  state.themeHidden = false;
  setThemeHidden(false);
  syncThemeHiddenSwitch();
  updateHiddenBadge();
  updateOverviewTabVisibility();
  updateSearchPlaceholder();
  syncSearchSourceUI();
  syncLibSearchUI();
  syncAdultPhraseRow();
  renderOverview();
  showToast('里模式已关闭', 'success');
}

/* ---------- 设置悬浮枢纽（替代侧栏设置页入口） ---------- */
var _menuOpen = false;
function toggleSettingsMenu(){
  var m = document.getElementById('settingsMenu');
  if (!m) return;
  _menuOpen = !_menuOpen;
  m.classList.toggle('show', _menuOpen);
  if (_menuOpen) updateSettingsMenuThemeHidden();
}
function closeSettingsMenu(){
  var m = document.getElementById('settingsMenu');
  if (m) m.classList.remove('show');
  _menuOpen = false;
}
function updateSettingsMenuThemeHidden(){
  var el = document.getElementById('smThemeHiddenState');
  if (el){ el.textContent = state.themeHidden ? '开' : '关'; el.classList.toggle('on', !!state.themeHidden); }
}
function toggleThemeHiddenFromMenu(){
  state.themeHidden = !state.themeHidden;
  setThemeHidden(state.themeHidden);
  syncThemeHiddenSwitch(); updateHiddenBadge(); updateOverviewTabVisibility();
  updateSearchPlaceholder(); syncSearchSourceUI(); syncLibSearchUI(); syncAdultPhraseRow();
  renderOverview();
  updateSettingsMenuThemeHidden();
  showToast(state.themeHidden ? '里模式已开启' : '里模式已关闭', 'success');
}
function openSettingsItem(key){
  closeSettingsMenu();
  switch (key){
    case 'add': openCustomEdit(); return;
    case 'api': openApiKeySheet(); return;
    case 'country': openCountryManage(); return;
    case 'genre': openGenreManage(); return;
    case 'theme': openSettingsMini(key); return;
    case 'cache': openCacheConfig(); return;
  }
}
function openCacheConfig(){
  closeSettingsMenu();
  var cur = state.autoClear;
  var m = /^(\d+)d$/.exec(cur || '');
  var inp = document.getElementById('cacheDaysInput');
  if (inp) inp.value = m ? parseInt(m[1], 10) : 0;
  openSheet('cacheConfigSheet');
}
function saveCacheDays(){
  var inp = document.getElementById('cacheDaysInput');
  var n = inp ? parseInt(inp.value, 10) : 0;
  if (isNaN(n) || n < 0) n = 0;
  var key = n <= 0 ? 'never' : (n + 'd');
  state.autoClear = key;
  updateAutoClearDisplay();
  setSelectValue('autoClearSelect', key);
  idbPut('kv', 'autoClear', key).catch(function(){});
  clearExpiredFilms();
  showToast(n <= 0 ? '已关闭自动清除' : ('已设置每 ' + n + ' 天自动清除'), 'success');
  closeAllSheets();
}
function clearAllFilms(){
  closeSettingsMenu();
  listFilms().then(function(films){
    var total = films.length;
    if (!total){ showToast('没有可清除的影片', 'info'); return; }
    showConfirm({
      title: '清除所有影片',
      desc: '将删除全部 ' + total + ' 部影片（已锁定影片除外），此操作不可撤销。',
      okText: '清除',
      onOk: function(){
        var dels = films.filter(function(f){ return !f.locked; }).map(function(f){ return deleteFilm(f.id); });
        Promise.all(dels).then(function(){
          renderOverview();
          showToast('已清除所有影片', 'success');
        }).catch(function(){ showToast('清除失败', 'error'); });
      }
    });
  });
}
function openSettingsMini(focus){
  populateMiniSettings(focus);
  openSheet('settingsMini');
}
function populateMiniSettings(focus){
  var ag = document.getElementById('drawerAppearanceSelect');
  if (ag) ag.innerHTML = APPEARANCE_MODES.map(function(m){ return '<option value="' + m.key + '">' + m.label + '</option>'; }).join('');
  setSelectValue('drawerAppearanceSelect', state.appearance);
  var ac = document.getElementById('drawerAutoClearSelect');
  if (ac) ac.innerHTML = AUTO_CLEAR_MODES.map(function(m){ return '<option value="' + m.key + '">' + m.label + '</option>'; }).join('');
  setSelectValue('drawerAutoClearSelect', state.autoClear);
  renderDrawerThemeGrid();
  var map = { theme: 'smSecTheme', appearance: 'smSecAppearance', autoClear: 'smSecAutoClear' };
  var titleMap = { theme: '主题色', appearance: '外观', autoClear: '自动清除缓存' };
  ['smSecTheme','smSecAppearance','smSecAutoClear'].forEach(function(id){
    var e = document.getElementById(id); if (!e) return;
    e.style.display = (focus && map[focus] && map[focus] !== id) ? 'none' : '';
  });
  var t = document.getElementById('settingsMiniTitle');
  if (t) t.textContent = (focus && titleMap[focus]) ? titleMap[focus] : '外观';
}
function renderDrawerThemeGrid(){
  var grid = document.getElementById('drawerThemeGrid');
  if (!grid) return;
  var current = (getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#007AFF').trim().toLowerCase();
  grid.innerHTML = THEME_COLORS.map(function(c){
    return '<button class="swatch' + (c.toLowerCase() === current ? ' active' : '') + '" style="background:' + c + '" onclick="applyThemeColor(\'' + c + '\', true)" aria-label="主题色 ' + c + '"></button>';
  }).join('');
}
document.addEventListener('click', function(e){
  if (!_menuOpen) return;
  var m = document.getElementById('settingsMenu');
  var h = document.getElementById('settingsFab');
  if (m && h && !m.contains(e.target) && !h.contains(e.target)) closeSettingsMenu();
});
document.addEventListener('keydown', function(e){
  if (e.key === 'Escape' && _menuOpen) closeSettingsMenu();
});

/* ---------- 顶栏切换（影片 / XV） ---------- */
function updateOverviewTabVisibility(){
  var tabs = document.getElementById('overviewTabs');
  var searchSeg = document.getElementById('searchMetaSeg');
  if (!state.themeHidden){
    if (tabs) tabs.style.display = 'none';
    if (searchSeg) searchSeg.style.display = 'none';
    state.overviewTab = 'movie';
  } else {
    if (tabs) tabs.style.display = '';
    if (searchSeg) searchSeg.style.display = '';
  }
}
function setOverviewTab(tab, btn){
  state.overviewTab = tab;
  var seg = document.getElementById('overviewTabs');
  if (seg){
    var bs = seg.querySelectorAll('button');
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('active', bs[i].getAttribute('data-tab') === tab);
  }
  idbPut('kv', 'overviewTab', tab).catch(function(){});
  renderOverview();
}
function setMetaSource(src, btn){
  state.metaSource = src;
  idbPut('kv', 'metaSource', src).catch(function(){});
  syncSearchSourceUI();
  updateSearchPlaceholder();
  var q = document.getElementById('tmdbQuery');
  if (q){ q.value = ''; }
  clearSearch();
  renderSearchHistory();
}

/* ---------- 编辑页 Tab ---------- */
function switchHomeTab(tab){
  var bs = document.querySelectorAll('#homeTabs button');
  for (var i = 0; i < bs.length; i++){
    bs[i].classList.toggle('active', bs[i].getAttribute('data-tab') === tab);
  }
  document.getElementById('tab-poster').style.display = (tab === 'poster') ? '' : 'none';
  document.getElementById('tab-basic').style.display = (tab === 'basic') ? '' : 'none';
  document.getElementById('tab-cast').style.display  = (tab === 'cast')  ? '' : 'none';
  document.getElementById('tab-media').style.display = (tab === 'media') ? '' : 'none';
}

/* ===================================================================
   库页 —— 网格 / 列表 + 右键菜单
   =================================================================== */
function posterCardHtml(f){
  var enc = escapeAttr(encodeURIComponent(f.id));
  var art = f.posterDataUrl
    ? '<img src="' + escapeAttr(f.posterDataUrl) + '" alt="" loading="lazy">'
    : '<div class="poster-ph">' + ICON.film + '</div>';
  var d = f.data || {};
  var subOn = !!d.hasSubtitle;
  var badges = (d.rating || f.rating) ? '<div class="poster-badges"><span class="poster-rating">' + escapeHtml(String(d.rating || f.rating)) + '</span></div>' : '';
  var lock = f.locked ? '<span class="poster-lock">' + ICON.lock + '</span>' : '';
  var title = (f.adult && d.dvdId) ? String(d.dvdId).toUpperCase() : (f.title || f.id);
  var subBadge = subOn ? ' <span class="sub-badge sub-badge-sub">字幕</span>' : '';
  var bits = [];
  if (d.year || f.year) bits.push(escapeHtml(String(d.year || f.year)));
  if (d.runtime || f.runtime) bits.push(escapeHtml(String(d.runtime || f.runtime)) + ' 分钟');
  var sub = bits.length ? '<div class="poster-sub">' + bits.join('<span class="dot">·</span>') + '</div>' : '';
  return '<div class="poster-card' + (subOn ? ' has-sub' : '') + '" data-id="' + enc + '">'
       +   '<div class="poster-art">' + art + badges + lock + (subOn ? '<span class="img-sub-badge">字幕</span>' : '')
       +     '<div class="poster-actions">'
       +       '<button class="pa-btn" data-act="edit" title="编辑">' + CTX_ICONS.pencil + '</button>'
       +       '<button class="pa-btn danger" data-act="del" title="删除">' + CTX_ICONS.trash + '</button>'
       +     '</div>'
       +   '</div>'
       +   '<div class="poster-meta"><div class="poster-name">' + escapeHtml(title) + subBadge + '</div>' + sub + '</div>'
       + '</div>';
}

function listRowHtml(f){
  var enc = escapeAttr(encodeURIComponent(f.id));
  var thumb = f.posterDataUrl ? '<img src="' + escapeAttr(f.posterDataUrl) + '" alt="" loading="lazy">' : '';
  var title = (f.adult && f.data && f.data.dvdId) ? String(f.data.dvdId).toUpperCase() : (f.title || f.id);
  var d = f.data || {};
  var plot = String(d.plot || f.plot || '').trim();
  var meta = [];
  var rating = d.rating || f.rating;
  if (rating) meta.push('<span class="lm-rating">★ ' + escapeHtml(String(rating)) + '</span>');
  var year = d.year || f.year;
  if (year) meta.push('<span class="lm-year">' + escapeHtml(String(year)) + '</span>');
  var region = '';
  if (Array.isArray(d.countries) && d.countries.length) region = String(d.countries[0]);
  else if (Array.isArray(f.countries) && f.countries.length) region = String(f.countries[0]);
  else if (f.country) region = String(f.country);
  if (region) meta.push('<span class="lm-region">' + escapeHtml(region) + '</span>');
  var mpaa = d.mpaa || f.mpaa;
  if (mpaa) meta.push('<span class="lm-cert">' + escapeHtml(String(mpaa)) + '</span>');
  var runtime = d.runtime || f.runtime;
  if (runtime) meta.push('<span class="lm-runtime">' + escapeHtml(String(runtime)) + ' 分钟</span>');
  var when = f.updatedAt ? new Date(f.updatedAt).toLocaleDateString('zh-CN') : '';
  return '<div class="list-row" data-id="' + enc + '">'
       +   '<div class="list-thumb">' + thumb + '</div>'
       +   '<div class="list-main">'
       +     '<div class="list-name">' + escapeHtml(title) + (f.data && f.data.hasSubtitle ? ' <span class="sub-badge sub-badge-sub">字幕</span>' : '') + '</div>'
       +     '<div class="list-desc">' + (plot ? escapeHtml(plot) : '<span class="list-empty">暂无简介</span>') + '</div>'
       +     '<div class="list-meta">' + (meta.length ? meta.join('') : '<span class="list-empty">暂无评分与年份</span>') + '</div>'
       +   '</div>'
       +   '<div class="list-col">'
       +     '<span class="list-date">' + escapeHtml(when) + '</span>'
       +     '<div class="list-ops">'
       +       '<button class="pa-btn" data-act="edit" title="编辑">' + CTX_ICONS.pencil + '</button>'
       +       '<button class="pa-btn danger" data-act="del" title="删除">' + CTX_ICONS.trash + '</button>'
       +     '</div>'
       +   '</div>'
       + '</div>';
}

function renderOverview(){
  var grid = document.getElementById('overviewGrid');
  var listWrap = document.getElementById('overviewList');
  var empty = document.getElementById('overviewEmpty');
  if (!grid) return Promise.resolve();
  setLibSearchPlaceholder();
  return listFilms().then(function(films){
    if (!state.themeHidden) films = films.filter(function(f){ return !f.adult; });
    else if (state.overviewTab === 'xv') films = films.filter(function(f){ return !!f.adult; });
    else films = films.filter(function(f){ return !f.adult; });

    var sortEl = document.getElementById('libSort');
    var sk = sortEl ? sortEl.value : 'updated';
    films.sort(function(a, b){
      if (sk === 'title') return String(a.title || a.id).localeCompare(String(b.title || b.id), 'zh');
      if (sk === 'year') return (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0);
      if (sk === 'rating') return (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0);
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });

    var cnt = document.getElementById('libCount');
    if (cnt) cnt.textContent = films.length ? (films.length + ' 部') : '';
    var cntBar = document.getElementById('libCountBar');
    if (cntBar) cntBar.classList.toggle('hidden', !films.length);
    var navCnt = document.getElementById('navCountFilms');
    if (navCnt) navCnt.textContent = String(films.length);

    if (!films.length){
      grid.innerHTML = '';
      grid.classList.add('hidden');
      if (listWrap){ listWrap.innerHTML = ''; listWrap.classList.add('hidden'); }
      if (empty){
        empty.classList.remove('hidden');
        var d = empty.querySelector('.empty-desc');
        if (d) {
          if (q) {
            d.style.display = '';
            d.textContent = '没有匹配「' + q + '」的影片';
          } else {
            d.style.display = 'none';
            d.textContent = '';
          }
        }
      }
      return;
    }
    if (empty) empty.classList.add('hidden');

    var view = state._libView || 'grid';
    if (view === 'list'){
      grid.classList.add('hidden');
      grid.innerHTML = '';
      listWrap.classList.remove('hidden');
      listWrap.innerHTML = films.map(listRowHtml).join('');
    } else {
      if (listWrap){ listWrap.classList.add('hidden'); listWrap.innerHTML = ''; }
      grid.classList.remove('hidden');
      grid.innerHTML = films.map(posterCardHtml).join('');
    }
    bindLibraryCards();
    if (_selMode) _syncSelectUI();
  }).catch(function(){
    grid.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
  });
}

function bindLibraryCards(){
  var nodes = document.querySelectorAll('#overviewGrid .poster-card, #overviewList .list-row');
  _libFocusIdx = -1;
  for (var i = 0; i < nodes.length; i++){
    (function(node){
      if (node._bound) return;
      node._bound = true;
      var encId = node.getAttribute('data-id');
      node.addEventListener('click', function(e){
        var act = e.target.closest('[data-act]');
        if (act){
          e.stopPropagation();
          var kind = act.getAttribute('data-act');
          if (kind === 'edit'){ newFilm(); openFilm(encId); }
          else if (kind === 'del'){ confirmDeleteFilm(decodeURIComponent(encId)); }
          return;
        }
        if (_selMode){ toggleSelect(decodeURIComponent(encId), node); return; }
        Array.prototype.forEach.call(document.querySelectorAll('.kb-focus'), function(n){ n.classList.remove('kb-focus'); });
        openFilmDetail(encId);
      });
      node.addEventListener('dblclick', function(){
        if (_selMode){ openFilmDetail(encId); }
        else { newFilm(); openFilm(encId); }
      });
      node.addEventListener('contextmenu', function(e){
        e.preventDefault();
        openFilmContextMenu(encId, e.clientX, e.clientY);
      });
    })(nodes[i]);
  }
}

/* ---------- 库页顶部搜索栏 ---------- */
var _libSearchActive = -1;
var _libSearchItems = [];
var _libSearchTimer = null;
var _libSearchMode = null;   /* 'tmdb' | 'jav' | 'local' */

/* 媒体库搜索栏的源/类型切换（对齐手机版：TMDB 分 电影/剧集，JAV 分 有码/无码） */
function tmdbTypeLabel(mt){ return mt === 'tv' ? '剧集' : '电影'; }
function javCensorLabel(c){ return c === 'uncensored' ? '无码' : '有码'; }
function setLibSource(src, btn){
  if (src === 'jav' && !state.themeHidden){
    showToast('开启里模式后可使用 JAV 源', 'error');
    return;
  }
  state.metaSource = src;
  var seg = document.getElementById('libSrcSeg');
  if (seg) seg.querySelectorAll('button').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-source') === src); });
  renderLibTypePill();
  setLibSearchPlaceholder();
  clearLibSearch();
}
function renderLibTypePill(){
  var typeBtn = document.getElementById('libTypePill');
  if (!typeBtn) return;
  var curEl = typeBtn.querySelector('.type-layer.is-current');
  var inEl = typeBtn.querySelector('.type-layer.is-incoming');
  var label = state.metaSource === 'jav' ? javCensorLabel(state.javCensor) : tmdbTypeLabel(state.tmdbMediaType);
  if (curEl) curEl.textContent = label;
  if (inEl) inEl.textContent = label;
  typeBtn.title = state.metaSource === 'jav' ? '切换 有码/无码' : '切换 电影/剧集';
}
function cycleLibType(){
  var typeBtn = document.getElementById('libTypePill');
  if (!typeBtn || typeBtn.classList.contains('animating')) return;
  var curEl = typeBtn.querySelector('.type-layer.is-current');
  var inEl = typeBtn.querySelector('.type-layer.is-incoming');
  if (!curEl || !inEl) return;
  var isJav = state.metaSource === 'jav';
  var cur = isJav ? state.javCensor : state.tmdbMediaType;
  var next = isJav
    ? (cur === 'uncensored' ? 'masked' : 'uncensored')
    : (cur === 'tv' ? 'movie' : 'tv');
  inEl.textContent = isJav ? javCensorLabel(next) : tmdbTypeLabel(next);
  requestAnimationFrame(function(){ typeBtn.classList.add('animating'); });
  setTimeout(function(){
    if (isJav) state.javCensor = next; else state.tmdbMediaType = next;
    typeBtn.classList.add('no-transition');
    curEl.textContent = isJav ? javCensorLabel(next) : tmdbTypeLabel(next);
    typeBtn.classList.remove('animating');
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ typeBtn.classList.remove('no-transition'); }); });
    clearLibSearch();
  }, 260);
}
function syncLibSearchUI(){
  if (!state.themeHidden && state.metaSource === 'jav') state.metaSource = 'tmdb';
  var seg = document.getElementById('libSrcSeg');
  if (seg){
    var bs = seg.querySelectorAll('button');
    for (var i = 0; i < bs.length; i++){
      var s = bs[i].getAttribute('data-source');
      if (s === 'jav') bs[i].style.display = state.themeHidden ? '' : 'none';
      bs[i].classList.toggle('active', s === state.metaSource);
    }
  }
  renderLibTypePill();
  setLibSearchPlaceholder();
}
function runLibSearch(){
  var q = document.getElementById('libSearch');
  if (!q) return;
  var val = (q.value || '').trim();
  if (!val){ showToast('请输入要搜索的内容', 'error'); if (q) q.focus(); return; }
  if (_libSearchTimer){ clearTimeout(_libSearchTimer); _libSearchTimer = null; }
  libSearchDataSource(val);
}

/* 媒体库搜索栏：仅显隐清除按钮，不实时搜索（搜索由按钮/回车触发） */
function onLibSearchInput(){
  var q = document.getElementById('libSearch');
  if (!q) return;
  var val = (q.value || '').trim();
  var cl = document.getElementById('libSearchClear');
  if (cl) cl.classList.toggle('show', !!val);
  if (_libSearchTimer){ clearTimeout(_libSearchTimer); _libSearchTimer = null; }
  if (!val){ _libSearchActive = -1; _closeLibSearchDropdown(); }
}
function _renderLibSearchLoading(){
  var dd = document.getElementById('libSearchDropdown');
  if (!dd) return;
  dd.innerHTML = '<div class="lib-search-empty"><span class="spinner" style="width:14px;height:14px"></span> 搜索数据源中…</div>';
  dd.classList.remove('hidden');
}
function libSearchDataSource(q){
  if (state.themeHidden && state.metaSource === 'jav') libSearchJAV(q);
  else libSearchTMDB(q);
}
function libSearchTMDB(q){
  var dd = document.getElementById('libSearchDropdown');
  if (!dd) return;
  getTMDBKey().then(function(key){
    if (!key){
      dd.innerHTML = '<div class="lib-search-empty">未配置 TMDB Key，请到「设置 → API 配置」<a href="javascript:void(0)" onclick="openApiKeySheet()">去配置</a></div>';
      dd.classList.remove('hidden');
      return;
    }
    var adult = state.themeHidden ? 'true' : 'false';
    var mt = (state.tmdbMediaType === 'tv') ? 'tv' : 'movie';
    var path = mt === 'tv' ? '/search/tv' : '/search/movie';
    var url = TMDB_API_BASE + path + '?api_key=' + encodeURIComponent(key) + '&language=zh-CN&include_adult=' + adult + '&query=' + encodeURIComponent(q);
    var ctrl = new AbortController();
    var t = setTimeout(function(){ ctrl.abort(); }, 15000);
    fetch(url, { signal: ctrl.signal })
      .then(function(r){
        clearTimeout(t);
        if (!r.ok){ if (r.status === 401) throw new Error('TMDB API Key 无效或已过期，请到「设置 → API 配置」重新填写'); throw new Error('HTTP ' + r.status); }
        return r.json();
      })
      .then(function(data){ renderLibSearchDropdown(data && data.results ? data.results : [], q, 'tmdb'); })
      .catch(function(err){
        var msg = (err && err.name === 'AbortError') ? '请求超时，请检查网络或稍后重试' : ((err && err.message) || '请求失败');
        dd.innerHTML = '<div class="lib-search-empty">搜索失败：' + escapeHtml(msg) + '</div>';
        dd.classList.remove('hidden');
      });
  }).catch(function(err){
    dd.innerHTML = '<div class="lib-search-empty">读取 Key 失败：' + escapeHtml((err && err.message) || '未知错误') + '</div>';
    dd.classList.remove('hidden');
  });
}
function libSearchJAV(q){
  var dd = document.getElementById('libSearchDropdown');
  if (!dd) return;
  var base = javbusApiBase();
  if (!base){
    dd.innerHTML = '<div class="lib-search-empty">未配置 Worker 代理地址，请到「设置 → API 配置」<a href="javascript:void(0)" onclick="openApiKeySheet()">去配置</a></div>';
    dd.classList.remove('hidden');
    return;
  }
  dd.innerHTML = '<div class="lib-search-empty"><span class="spinner" style="width:14px;height:14px"></span> 搜索 JavBus 中…</div>';
  dd.classList.remove('hidden');
  fetchJavbusSearch(q, dd);
}
function setLibSearchPlaceholder(){
  var q = document.getElementById('libSearch');
  if (!q) return;
  if (state.themeHidden && state.metaSource === 'jav') q.placeholder = '搜索番号 / 关键词（JavBus）';
  else q.placeholder = '搜索 TMDB 影片库（片名 / 番号）…';
}
function onLibSearchKey(e){
  var dd = document.getElementById('libSearchDropdown');
  var items = dd ? dd.querySelectorAll('.lib-search-item') : [];
  if (e.key === 'ArrowDown'){
    e.preventDefault();
    _libSearchActive = Math.min(_libSearchActive + 1, items.length - 1);
    _syncLibSearchActive(items);
  } else if (e.key === 'ArrowUp'){
    e.preventDefault();
    _libSearchActive = Math.max(_libSearchActive - 1, -1);
    _syncLibSearchActive(items);
  } else if (e.key === 'Enter'){
    if (e.isComposing || e.keyCode === 229) return; /* 输入法组合中（如拼音选词回车），忽略，交给输入法处理 */
    e.preventDefault();
    if (_libSearchActive >= 0 && items[_libSearchActive]){
      var sel = items[_libSearchActive];
      if (_libSearchMode === 'tmdb'){
        var tid = sel.getAttribute('data-tmdb-id');
        if (tid){ selectTMDB(parseInt(tid, 10)); _closeLibSearchDropdown(); }
      } else {
        var sid = sel.getAttribute('data-id');
        if (sid){ _openLibSearchResult(sid); _closeLibSearchDropdown(); }
      }
      return;
    }
    /* 没有高亮项 → 按回车发起搜索 */
    runLibSearch();
  } else if (e.key === 'Escape'){
    _closeLibSearchDropdown();
  }
}
function _syncLibSearchActive(items){
  for (var i = 0; i < items.length; i++) items[i].classList.toggle('active', i === _libSearchActive);
  if (_libSearchActive >= 0 && items[_libSearchActive]) items[_libSearchActive].scrollIntoView({ block: 'nearest' });
}
function onLibSearchFocus(){
  var q = document.getElementById('libSearch');
  var cl = document.getElementById('libSearchClear');
  if (q && cl) cl.classList.toggle('show', !!(q.value || '').trim());
}
function onLibSearchBlur(){
  setTimeout(function(){ _closeLibSearchDropdown(); }, 150);
}
function clearLibSearch(){
  var q = document.getElementById('libSearch');
  if (q) q.value = '';
  var cl = document.getElementById('libSearchClear');
  if (cl) cl.classList.remove('show');
  _closeLibSearchDropdown();
}
function _closeLibSearchDropdown(){
  var dd = document.getElementById('libSearchDropdown');
  if (dd){ dd.classList.add('hidden'); dd.innerHTML = ''; }
  _libSearchActive = -1; _libSearchItems = []; _libSearchMode = null;
}
function _openLibSearchResult(encId){
  _closeLibSearchDropdown();
  var q = document.getElementById('libSearch');
  if (q) q.blur();
  openFilmDetail(encId);
}
function renderLibSearchDropdown(films, q, mode){
  var dd = document.getElementById('libSearchDropdown');
  if (!dd) return;
  /* 在线数据源（TMDB）结果 */
  if (mode === 'tmdb'){
    _libSearchMode = 'tmdb';
    _libSearchItems = films;
    if (!films.length){
      dd.innerHTML = '<div class="lib-search-empty">未找到匹配「' + escapeHtml(q) + '」的结果</div>';
      dd.classList.remove('hidden');
      _libSearchActive = -1;
      return;
    }
    dd.innerHTML = films.map(function(item, i){
      var id = item.id;
      var name = item.title || item.name || item.original_title || item.original_name || '';
      var date = item.release_date || item.first_air_date || '';
      var poster = item.poster_path ? tmdbImgUrl(item.poster_path, 'w185') : '';
      var bits = [];
      if (date) bits.push(String(date).slice(0, 4));
      if (item.media_type === 'tv') bits.push('剧集');
      var sub = bits.join(' · ');
      var thumb = poster ? '<img src="' + escapeAttr(poster) + '" alt="" loading="lazy">' : '<div style="width:34px;height:51px"></div>';
      return '<div class="lib-search-item' + (i === 0 ? ' active' : '') + '" data-tmdb-id="' + id + '" onmousedown="selectTMDB(' + id + ');_closeLibSearchDropdown();var _q=document.getElementById(\'libSearch\');if(_q)_q.blur();">'
           +   thumb
           +   '<div class="ls-body"><div class="ls-title">' + escapeHtml(name) + (item.adult ? ' <span class="badge badge-danger">18+</span>' : '') + '</div>' + (sub ? '<div class="ls-sub">' + escapeHtml(sub) + '</div>' : '') + '</div>'
           + '</div>';
    }).join('');
    _libSearchActive = 0;
    dd.classList.remove('hidden');
    fetchTrailersForResults(films, state.tmdbMediaType);
    return;
  }
  /* 本地结果（保留兼容，当前库页搜索不再使用） */
  _libSearchMode = 'local';
  _libSearchItems = films;
  if (!films.length){
    dd.innerHTML = '<div class="lib-search-empty">未找到匹配「' + escapeHtml(q) + '」的影片</div>';
    dd.classList.remove('hidden');
    return;
  }
  dd.innerHTML = films.map(function(f, i){
    var enc = escapeAttr(encodeURIComponent(f.id));
    var thumb = f.posterDataUrl ? '<img src="' + escapeAttr(f.posterDataUrl) + '" alt="" loading="lazy">' : '<div style="width:34px;height:51px"></div>';
    var title = (f.adult && f.data && f.data.dvdId) ? String(f.data.dvdId).toUpperCase() : (f.title || f.id);
    var bits = [];
    if (f.year) bits.push(String(f.year));
    if (f.runtime) bits.push(String(f.runtime) + ' 分钟');
    if (f.rating) bits.push('★ ' + String(f.rating));
    var sub = bits.join(' · ');
    return '<div class="lib-search-item' + (i === 0 ? ' active' : '') + '" data-id="' + enc + '" onmousedown="_openLibSearchResult(\'' + enc + '\')">'
         +   thumb
         +   '<div class="ls-body"><div class="ls-title">' + escapeHtml(title) + '</div>' + (sub ? '<div class="ls-sub">' + escapeHtml(sub) + '</div>' : '') + '</div>'
         + '</div>';
  }).join('');
  _libSearchActive = 0;
  dd.classList.remove('hidden');
}

/* ---------- 搜索结果预告片角标（参考手机版） ---------- */
var TR_FILM_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 14h4M17 9h4M17 14h4M7 12h10"/></svg>';
function runPool(items, limit, worker){
  var results = new Array(items.length), idx = 0;
  function runOne(){
    if (idx >= items.length) return Promise.resolve();
    var cur = idx++;
    return Promise.resolve(worker(items[cur], cur)).catch(function(){ /* 单个失败不影响其余 */ }).then(runOne);
  }
  var runners = [], n = Math.min(limit, items.length);
  for (var k = 0; k < n; k++) runners.push(runOne());
  return Promise.all(runners).then(function(){ return results; });
}
function trailerCacheKey(id, mediaType){ return 'trailer:' + ((mediaType === 'tv') ? 'tv:' : 'mv:') + id; }
function ensureTrailerHas(id, mediaType){
  var type = mediaType || 'movie';
  return idbGet('kv', trailerCacheKey(id, type)).then(function(cached){
    if (cached && typeof cached.has === 'boolean') return cached.has;
    return getTMDBKey().then(function(key){
      if (!key) return false;
      // 不带 language 参数：返回全部语言 videos，覆盖中文/英文预告
      var url = TMDB_API_BASE + '/' + (type === 'tv' ? 'tv' : 'movie') + '/' + id + '/videos?api_key=' + encodeURIComponent(key);
      return fetch(url).then(function(r){ return r.ok ? r.json() : null; })
        .then(function(j){
          var has = !!(j && j.results && j.results.some(function(v){ return v.site === 'YouTube' && v.key; }));
          idbPut('kv', trailerCacheKey(id, type), { has: has }).catch(function(){});
          return has;
        }).catch(function(){ return false; });
    });
  });
}
function fetchTrailersForResults(results, mediaType){
  var items = (results || []).slice(0, 20);
  runPool(items, 4, function(item){
    return ensureTrailerHas(item.id, mediaType).then(function(has){
      if (!has) return;
      var titleEl = document.querySelector('.lib-search-item[data-tmdb-id="' + item.id + '"] .ls-title');
      if (!titleEl || titleEl.querySelector('.ls-trailer-tag')) return;
      var tag = document.createElement('span');
      tag.className = 'ls-trailer-tag';
      tag.innerHTML = TR_FILM_ICON;
      titleEl.appendChild(tag);
      void tag.offsetWidth;          // 强制重排，触发过渡动画
      tag.classList.add('show');
    });
  });
}

function openFilmContextMenu(encId, x, y){
  var id = decodeURIComponent(encId);
  loadFilm(id).then(function(film){
    var locked = film && film.locked;
    var isCustom = film && film.source === 'custom';
    showContextSheet('影片操作', [
      { label: '打开详情', onClick: function(){ openFilmDetail(encId); } },
      { label: '编辑元数据', icon: 'pencil', onClick: function(){ newFilm(); openFilm(encId); } },
      { sep: true },
      { label: '刷新元数据', icon: 'refresh', onClick: function(){ refreshFilm(id); }, disabled: isCustom },
      { label: '下载元数据', icon: 'download', onClick: function(){ downloadMetadata(id); } },
      { label: locked ? '解锁' : '锁定', icon: locked ? 'unlock' : 'lock', onClick: function(){ toggleLock(id); } },
      { sep: true },
      { label: '删除', icon: 'trash', danger: true, onClick: function(){ confirmDeleteFilm(id); } }
    ], { x: x, y: y });
  }).catch(function(){
    showContextSheet('影片操作', [
      { label: '打开详情', onClick: function(){ openFilmDetail(encId); } },
      { label: '编辑元数据', icon: 'pencil', onClick: function(){ newFilm(); openFilm(encId); } },
      { sep: true },
      { label: '删除', icon: 'trash', danger: true, onClick: function(){ confirmDeleteFilm(id); } }
    ], { x: x, y: y });
  });
}

function confirmDeleteFilm(id){
  showConfirm({
    title: '删除影片',
    desc: '将从本地库中移除该影片及其元数据、图片，此操作不可撤销。',
    okText: '删除',
    onOk: function(){
      deleteFilm(id).then(function(){
        showToast('已删除', 'success');
        renderOverview();
      }).catch(function(){ showToast('删除失败', 'error'); });
    }
  });
}

/* ===================================================================
   搜索页
   =================================================================== */
function tmdbLoadingHtml(){
  return '<div class="loading-bar"><span class="spinner"></span><span>' +
    (state.themeHidden && currentAdultPhrases.length ? randomAdultLoadingPhrase() : '搜索中…') + '</span></div>';
}
var _loadingRotTimer = null;
function startLoadingRotator(el, render){
  stopLoadingRotator();
  if (!el) return;
  _loadingRotTimer = setInterval(function(){
    if (!el.isConnected){ stopLoadingRotator(); return; }
    el.innerHTML = render();
  }, 2600);
}
function stopLoadingRotator(){
  if (_loadingRotTimer){ clearInterval(_loadingRotTimer); _loadingRotTimer = null; }
}

function searchMeta(){
  if (!state.themeHidden) state.metaSource = 'tmdb';
  if (state.metaSource === 'jav') searchJAV();
  else searchTMDB();
}
function searchJAV(){
  var qEl = document.getElementById('tmdbQuery');
  if (!qEl) return;   // 独立搜索页已移除，JAV 搜索走媒体库搜索栏（里模式）
  var q = qEl.value.trim();
  if (!q){ showToast('请输入番号或关键词', 'error'); return; }
  addSearchHistory(q);
  var box = document.getElementById('tmdbResults');
  var base = javbusApiBase();
  if (!base){
    box.innerHTML = '<div class="loading-bar">未配置 Worker 代理地址，请到「设置 → API 配置」<a href="javascript:void(0)" onclick="openApiKeySheet()">去配置</a></div>';
    showToast('请先配置 Worker 代理地址', 'error');
    return;
  }
  box.innerHTML = tmdbLoadingHtml();
  startLoadingRotator(box, tmdbLoadingHtml);
  fetchJavbusSearch(q, box);
}

function renderTMDBResults(results){
  stopLoadingRotator();
  var box = document.getElementById('tmdbResults');
  if (!box) return;
  if (!results || !results.length){
    box.innerHTML = '<div class="empty"><div class="empty-title">未找到匹配结果</div><div class="empty-desc">换个关键词试试</div></div>';
    return;
  }
  var mt = state.tmdbMediaType;
  box.innerHTML = results.slice(0, 20).map(function(item){
    var name = item.title || item.name || item.original_title || item.original_name || '';
    var orig = item.original_title || item.original_name || '';
    var date = item.release_date || item.first_air_date || '';
    var poster = item.poster_path ? tmdbImgUrl(item.poster_path, 'w185') : '';
    var bits = [];
    if (date) bits.push(String(date).slice(0, 4));
    if (orig && orig !== name) bits.push(orig);
    return '<div class="result-item" data-tmdb-id="' + item.id + '" data-tmdb-type="' + mt + '"'
         + ' data-poster-path="' + escapeAttr(item.poster_path || '') + '" onclick="selectTMDB(' + item.id + ')">'
         +   '<div class="result-poster">' + (poster ? '<img src="' + escapeAttr(poster) + '" loading="lazy" alt="">' : '') + '</div>'
         +   '<div class="result-body">'
         +     '<div class="result-title">' + escapeHtml(name) + (item.adult ? '<span class="badge badge-danger">18+</span>' : '') + '</div>'
         +     (bits.length ? '<div class="result-meta">' + escapeHtml(bits.join(' · ')) + '</div>' : '')
         +     (item.overview ? '<div class="result-overview">' + escapeHtml(item.overview) + '</div>' : '')
         +   '</div>'
         + '</div>';
  }).join('');
}

function renderJavbusResults(items, box){
  stopLoadingRotator();
  lastJavbusResults = items || [];
  if (!box) return;
  if (!lastJavbusResults.length){
    box.innerHTML = '<div class="empty"><div class="empty-title">未找到结果</div><div class="empty-desc">试试其他番号或关键词</div></div>';
    return;
  }
  box.innerHTML = lastJavbusResults.slice(0, 20).map(function(it, i){
    var title = it.title || it.id || '未命名';
    var cover = javbusImgUrl(it.img);
    var bits = [];
    if (it.date) bits.push(it.date);
    if (it.id) bits.push(it.id);
    // 搜索接口 tags 数组含「高清/字幕/新种」三类，标题后缀全量显示为胶囊
    var tags = (it.tags && it.tags.indexOf) ? it.tags.slice() : [];
    var subTag = tags.indexOf('字幕') >= 0;
    var tagBadges = tags.length ? ' ' + tags.map(function(t){
      var cls = t === '字幕' ? 'sub-badge-sub' : (t === '高清' ? 'sub-badge-hd' : (t === '新种' ? 'sub-badge-new' : 'sub-badge-other'));
      return '<span class="sub-badge ' + cls + '">' + escapeHtml(t) + '</span>';
    }).join('') : '';
    return '<div class="result-item' + (subTag ? ' has-sub' : '') + '" onclick="applyJavbusResult(' + i + ')">'
         +   '<div class="result-poster">' + (cover ? '<img src="' + escapeAttr(cover) + '" loading="lazy" alt="">' + (subTag ? '<span class="img-sub-badge">字幕</span>' : '') : '') + '</div>'
         +   '<div class="result-body">'
         +     '<div class="result-title">' + escapeHtml(title) + '<span class="badge badge-danger">18+</span>' + tagBadges + '</div>'
         +     (bits.length ? '<div class="result-meta">' + escapeHtml(bits.join(' · ')) + '</div>' : '')
         +   '</div>'
         + '</div>';
  }).join('');
}

function selectTMDB(id){
  var pp = null, mt = 'movie';
  var el = document.querySelector('.result-item[data-tmdb-id="' + id + '"]');
  if (el){
    pp = el.getAttribute('data-poster-path') || null;
    mt = el.getAttribute('data-tmdb-type') || 'movie';
  }
  applyTMDBById(id, function(){ quickSaveAndHome(); }, true, pp, mt);
}

function applyJavbusResult(i){
  var it = lastJavbusResults[i];
  if (!it) return;
  if (!it.id){
    var imgP0 = populateFromJavbus(it);
    quickSaveAndHome().then(function(){ return imgP0; }).then(silentRefreshCurrentFilm).catch(function(){});
    return;
  }
  var base = javbusApiBase();
  showToast('加载详情中…');
  fetch(base + '/api/meta?dvd_id=' + encodeURIComponent(it.id))
    .then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function(d){
      if (!d || !d.id) throw new Error('无详情数据');
      var imgP = populateFromJavbus(d);
      quickSaveAndHome().then(function(){ return imgP; }).then(silentRefreshCurrentFilm).catch(function(){});
    })
    .catch(function(e){ showToast('加载详情失败：' + ((e && e.message) || '未知'), 'error'); });
}

/* ---------- 搜索框交互 ---------- */
function onSearchInput(){
  var q = document.getElementById('tmdbQuery');
  var cl = document.getElementById('searchClear');
  if (cl) cl.classList.toggle('show', !!(q && q.value));
  renderSearchHistory();
}
function clearSearch(){
  var q = document.getElementById('tmdbQuery');
  if (q) q.value = '';
  onSearchInput();
  var box = document.getElementById('tmdbResults');
  if (box) box.innerHTML = '';
  stopLoadingRotator();
}
function onTmdbTypeChange(sel){ state.tmdbMediaType = sel.value; }
function cycleJavCensor(){
  state.javCensor = (state.javCensor === 'uncensored') ? 'masked' : 'uncensored';
  syncSearchSourceUI();
}
function onSubSrcChange(sel){ subCurrentSrc = sel.value; }

function updateSearchPlaceholder(){
  var q = document.getElementById('tmdbQuery');
  if (!q) return;
  q.placeholder = (state.metaSource === 'jav') ? '输入番号，如 ABC-123' : '输入影片名，回车搜索';
}
function syncSearchSourceUI(){
  var seg = document.getElementById('searchMetaSeg');
  if (seg){
    if (state.themeHidden){
      seg.style.display = '';
      var bs = seg.querySelectorAll('button');
      for (var i = 0; i < bs.length; i++){
        var s = bs[i].getAttribute('data-source');
        bs[i].classList.toggle('active', s === state.metaSource);
      }
    } else {
      seg.style.display = 'none';
    }
  }
  var typeSel = document.getElementById('tmdbTypeBtn');
  if (typeSel){
    typeSel.style.display = (state.metaSource === 'tmdb') ? '' : 'none';
    typeSel.value = state.tmdbMediaType;
  }
  var censor = document.getElementById('javCensorBtn');
  if (censor){
    censor.style.display = (state.metaSource === 'jav') ? '' : 'none';
    censor.textContent = (state.javCensor === 'uncensored') ? '无码' : '有码';
  }
}

/* ---------- 搜索历史 ---------- */
function renderSearchHistory(){
  var panel = document.getElementById('searchHistory');
  var list = document.getElementById('searchHistoryList');
  if (!panel || !list) return;
  var q = document.getElementById('tmdbQuery');
  if (q && (q.value || '').trim()){ panel.classList.add('hidden'); return; }
  var obj = loadSearchHistory();
  var items = obj[currentHistoryKey()] || [];
  if (!items.length){ panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  list.innerHTML = items.map(function(t){
    return '<span class="hist-chip" data-term="' + escapeAttr(t) + '">'
         +   '<span style="cursor:pointer" onclick="applyHistoryFromChip(this)">' + escapeHtml(t) + '</span>'
         +   '<button class="hc-x" onclick="deleteHistoryItem(event, this)" aria-label="删除">'
         +     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
         +   '</button>'
         + '</span>';
  }).join('');
}
function applyHistoryFromChip(el){
  var chip = el.closest ? el.closest('.hist-chip') : el.parentNode;
  if (!chip) return;
  var term = chip.getAttribute('data-term') || '';
  var q = document.getElementById('tmdbQuery');
  if (q) q.value = term;
  onSearchInput();
  searchMeta();
}
function clearHistory(){
  var obj = loadSearchHistory();
  obj[currentHistoryKey()] = [];
  saveSearchHistory(obj);
  renderSearchHistory();
  showToast('已清空搜索历史', 'success');
}

/* ===================================================================
   编辑页 —— 新建 / 打开 / 保存
   =================================================================== */
function newFilm(adult){
  currentFilmId = null;
  currentFilmLocked = false;
  var film = { id: '', data: {} };
  if (adult) film.adult = true;
  applyFilmData(film);
  state.gallery = [];
  ['title','originaltitle','premiered','year','runtime','plot','rating','filename','mpaa','dvdid','studio','label','series','trailer'].forEach(function(id){
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  state.mpaa = '';
  state.dvdId = ''; state.studio = ''; state.label = ''; state.series = '';
  state.trailer = null; state.tmdbId = null;
  var th = document.getElementById('trailerHint');
  if (th){ th.textContent = ''; th.className = 'field-hint'; }
  var crumb = document.getElementById('editCrumb');
  if (crumb) crumb.textContent = '新建影片';
  updateState();
  renderCast();
  markDirty(false);
}
function openCustomEdit(){
  newFilm(false);
  state.source = 'custom';
  var bd = document.getElementById('editModalBackdrop');
  if (bd) bd.classList.add('show');
  document.body.classList.add('edit-modal-open');
  var card = document.querySelector('#page-edit .edit-modal-card');
  if (card){
    card.classList.remove('show');
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){ card.classList.add('show'); });
    });
  }
  switchHomeTab('basic');
  setTimeout(function(){ var t = document.getElementById('title'); if (t) t.focus(); }, 60);
}
function closeEditModal(){
  if (document.body.classList.contains('edit-modal-open')){
    var card = document.querySelector('#page-edit .edit-modal-card');
    if (card) card.classList.remove('show');
    var bd = document.getElementById('editModalBackdrop');
    if (bd) bd.classList.remove('show');
    setTimeout(function(){
      document.body.classList.remove('edit-modal-open');
    }, 180);
  } else {
    switchPage('home');
  }
  markDirty(false);
}
function openFilm(encId){
  var id = decodeURIComponent(encId);
  loadFilm(id).then(function(film){
    if (!film){ showToast('未找到影片', 'error'); return; }
    currentFilmId = film.id;
    currentFilmLocked = !!film.locked;
    resetSourceState();
    applyFilmData(film);
    var crumb = document.getElementById('editCrumb');
    if (crumb) crumb.textContent = (film.data && (film.data.title || film.data.dvdId)) || film.title || film.id;
    switchPage('edit');
    switchHomeTab('basic');
    markDirty(false);
  }).catch(function(){ showToast('读取影片失败', 'error'); });
}
function openFilmDetail(encId){
  var id = decodeURIComponent(encId);
  loadFilm(id).then(function(film){
    if (!film){ showToast('未找到影片', 'error'); return; }
    currentDetailFilmId = film.id;
    currentDetailFilm = film;
    renderFilmDetail(film);
    switchPage('detail');
    var sc = document.getElementById('detailScroll');
    if (sc) sc.scrollTop = 0;
    updateDetailScrollEffect();
  }).catch(function(){ showToast('读取影片失败', 'error'); });
}
function saveToDisk(){
  var title = getVal('title');
  var filename = getVal('filename');
  if (!filename && !title){ showToast('请先填写影片名或文件名', 'error'); return; }
  var film = buildFilmFromCurrent();
  saveFilm(film).then(function(){
    currentFilmId = film.id;
    state.overviewTab = film.adult ? 'xv' : 'movie';
    if (document.body.classList.contains('edit-modal-open')) closeEditModal(); else switchPage('home');
    renderOverview();
    clearExpiredFilms();
    showToast('已保存', 'success');
    markDirty(false);
    checkFilmCap(1500);
  }).catch(function(err){
    showToast('保存失败：' + ((err && err.message) || '存储不可用'), 'error');
  });
}
function quickSaveAndHome(){
  var title = getVal('title');
  var filename = getVal('filename');
  if (!filename && !title){ showToast('缺少影片名，无法保存', 'error'); return Promise.resolve(); }
  var film = buildFilmFromCurrent();
  return saveFilmWithMerge(film).then(function(result){
    var saved = result.film;
    currentFilmId = saved.id;
    state.overviewTab = saved.adult ? 'xv' : 'movie';
    renderOverview();
    clearExpiredFilms();
    if (document.body.classList.contains('edit-modal-open')) closeEditModal(); else switchPage('home');
    showToast(result.merged ? '已合并更新并保存' : '已保存', 'success');
    checkFilmCap(1500);
  }).catch(function(err){
    showToast('保存失败：' + ((err && err.message) || '存储不可用'), 'error');
  });
}

/* 未保存标记 */
function markDirty(on){
  var el = document.getElementById('editDirty');
  if (el) el.classList.toggle('hidden', !on);
}

/* ===================================================================
   编辑页 —— 演职员 / 标签 / 媒体
   =================================================================== */
function renderCast(){
  renderCastGroup('directorCard', state.directors, 'director');
  renderCastGroup('actorCards', state.actors, 'actor');
}
function renderCastGroup(containerId, items, mode){
  var box = document.getElementById(containerId);
  if (!box) return;
  var X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  box.innerHTML = (items || []).map(function(p, i){
    var ava = p.photo ? '<img src="' + escapeAttr(p.photo) + '" alt="">' : ICON.user;
    return '<div class="person-card" onclick="openPersonSheet(\'' + mode + '\',' + i + ')">'
         +   '<div class="person-ava">' + ava + '</div>'
         +   '<div class="person-name">' + escapeHtml(p.name || '') + '</div>'
         +   '<div class="person-role">' + escapeHtml(p.role || '') + '</div>'
         +   '<button class="person-x" onclick="event.stopPropagation();deleteCastItem(\'' + mode + '\',' + i + ')" aria-label="删除">' + X + '</button>'
         + '</div>';
  }).join('');
}
function deleteCastItem(mode, i){
  var list = (mode === 'director') ? state.directors : state.actors;
  if (i >= 0 && i < list.length) list.splice(i, 1);
  renderCast();
  updateState();
  markDirty(true);
}
function editCastAvatar(mode, i){ openPersonSheet(mode, i); }

function openPersonSheet(mode, index){
  personState.mode = mode || 'actor';
  personState.index = (typeof index === 'number') ? index : -1;
  var isEdit = personState.index >= 0;
  var list = (personState.mode === 'director') ? state.directors : state.actors;
  var p = isEdit ? (list[index] || {}) : {};
  var title = document.getElementById('personSheetTitle');
  if (title) title.textContent = isEdit ? '编辑人员' : '添加' + (personState.mode === 'director' ? '职员' : '演员');
  var nameEl = document.getElementById('personName');
  if (nameEl) nameEl.value = p.name || '';
  var roleEl = document.getElementById('personRole');
  if (roleEl) roleEl.value = p.role || '';
  var deptEl = document.getElementById('personDept');
  if (deptEl) deptEl.value = (personState.mode === 'director') ? (p.role || '导演') : '演员';
  var deptRow = document.getElementById('personDeptRow');
  if (deptRow) deptRow.style.display = (personState.mode === 'director') ? '' : 'none';
  var roleRow = document.getElementById('personRoleRow');
  if (roleRow) roleRow.style.display = (personState.mode === 'director') ? 'none' : '';
  var prev = document.getElementById('personAvatarPreview');
  if (prev){
    if (p.photo){
      prev.style.backgroundImage = 'url(' + escapeAttr(p.photo) + ')';
      prev.innerHTML = '';
    } else {
      prev.style.backgroundImage = '';
      prev.innerHTML = ICON.user;
    }
  }
  state.personPhoto = p.photo || null;
  var del = document.getElementById('personDelBtn');
  if (del) del.classList.toggle('hidden', !isEdit);
  openSheet('personSheet');
}
function onPersonDeptChange(sel){
  var el = document.getElementById('personDeptVal');
  if (el) el.textContent = sel.value;
}
function savePerson(){
  var nameEl = document.getElementById('personName');
  var name = nameEl ? (nameEl.value || '').trim() : '';
  if (!name){ showToast('请输入姓名', 'error'); return; }
  var roleEl = document.getElementById('personRole');
  var deptEl = document.getElementById('personDept');
  var role = (personState.mode === 'director')
    ? (deptEl ? deptEl.value : '导演')
    : (roleEl ? (roleEl.value || '').trim() : '');
  var p = { name: name, role: role, photo: state.personPhoto || null };
  var list = (personState.mode === 'director') ? state.directors : state.actors;
  if (personState.index >= 0 && personState.index < list.length) list[personState.index] = p;
  else list.push(p);
  renderCast();
  updateState();
  markDirty(true);
  closeAllSheets();
  showToast('已保存', 'success');
}
function deletePerson(){
  var list = (personState.mode === 'director') ? state.directors : state.actors;
  if (personState.index >= 0 && personState.index < list.length) list.splice(personState.index, 1);
  renderCast();
  updateState();
  markDirty(true);
  closeAllSheets();
  showToast('已删除', 'success');
}

/* ---------- 国家 / 类型标签 ---------- */
var X_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
function renderCountryChips(){
  var area = document.getElementById('countryTags');
  if (!area) return;
  area.innerHTML = (state.countries || []).map(function(c, i){
    return '<span class="chip">' + escapeHtml(c)
         + '<button class="chip-x" onclick="removeCountry(' + i + ')" aria-label="移除">' + X_SVG + '</button></span>';
  }).join('');
}
function removeCountry(i){ state.countries.splice(i, 1); renderCountryChips(); updateState(); markDirty(true); }
function renderGenreChips(){
  var area = document.getElementById('genreTags');
  if (!area) return;
  area.innerHTML = (state.genres || []).map(function(g, i){
    return '<span class="chip">' + escapeHtml(g)
         + '<button class="chip-x" onclick="removeGenre(' + i + ')" aria-label="移除">' + X_SVG + '</button></span>';
  }).join('');
}
function removeGenre(i){ state.genres.splice(i, 1); renderGenreChips(); updateState(); markDirty(true); }

function openCountrySheet(){
  var seg = document.getElementById('listGenreSeg');
  if (seg) seg.style.display = 'none';
  openMultiSheet({
    title: '选择国家/地区', kind: 'country',
    items: filterEnabled(state.countryPresets, state.countryDisabled),
    selected: state.countries,
    onConfirm: function(sel){ state.countries = sel; renderCountryChips(); updateState(); markDirty(true); }
  });
}
function openGenreSheet(){
  var seg = document.getElementById('listGenreSeg');
  if (seg) seg.style.display = state.themeHidden ? '' : 'none';
  var items = filterEnabled(currentGenreTab === 'adult' ? state.genreAdult : state.genreNormal,
                            currentGenreTab === 'adult' ? state.genreAdultDisabled : state.genreNormalDisabled);
  openMultiSheet({
    title: '选择类型', kind: 'genre', items: items,
    selected: state.genres,
    onConfirm: function(sel){ state.genres = sel; renderGenreChips(); updateState(); markDirty(true); }
  });
}
function switchGenreTab(tab){
  currentGenreTab = tab;
  var n = document.getElementById('genreSegNormal');
  var a = document.getElementById('genreSegAdult');
  if (n) n.classList.toggle('active', tab === 'normal');
  if (a) a.classList.toggle('active', tab === 'adult');
  if (listState.mode === 'manage') renderManageList();
  else openGenreSheet();
}

/* ---------- 通用列表弹窗 ---------- */
function setListSheetHeader(mode){
  var left = document.getElementById('listLeftSlot');
  var ok = document.getElementById('listSheetOk');
  var restore = document.getElementById('listRestoreBtn');
  if (mode === 'manage'){
    if (left) left.innerHTML = '';
    if (ok) ok.style.display = 'none';
    if (restore) restore.style.display = '';
  } else {
    if (left) left.innerHTML = '';
    if (ok) ok.style.display = '';
    if (restore) restore.style.display = 'none';
  }
}
function resetPresetList(){
  if (listState.kind === 'country') resetCountriesToDefault();
  else resetGenresToDefault();
  renderManageList();
  showToast('已恢复默认', 'success');
}
function openMultiSheet(opts){
  listState.mode = 'multi';
  listState.kind = opts.kind || '';
  listState.items = opts.items || [];
  listState.tempSel = (opts.selected || []).slice();
  listState.extra = [];
  listState.onConfirm = opts.onConfirm;
  var t = document.getElementById('listTitle');
  if (t) t.textContent = opts.title || '选择';
  var add = document.getElementById('listAddWrap');
  if (add) add.style.display = 'none';
  setListSheetHeader('multi');
  renderMultiList();
  openSheet('listSheet');
}
function renderMultiList(){
  var body = document.getElementById('listBody');
  if (!body) return;
  body.className = 'tag-cloud';
  var items = (listState.items || []).concat(listState.extra || []);
  body.innerHTML = items.map(function(it){
    var on = listState.tempSel.indexOf(it) >= 0;
    return '<button class="bubble-chip' + (on ? ' on' : '') + '" onclick="toggleMulti(this)">'
         + '<span>' + escapeHtml(it) + '</span></button>';
  }).join('') + '<button class="chip-add" onclick="addCustomMultiTag()">'
         + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" style="width:11px;height:11px"><path d="M12 5v14M5 12h14"/></svg>自定义</button>';
}
function toggleMulti(el){
  var val = (el.textContent || '').trim();
  var i = listState.tempSel.indexOf(val);
  if (i >= 0) listState.tempSel.splice(i, 1); else listState.tempSel.push(val);
  renderMultiList();
}
function addCustomMultiTag(){
  var label = listState.kind === 'country' ? '国家/地区' : '类型';
  var v = window.prompt('请输入自定义' + label, '');
  if (v == null) return;
  v = String(v).trim();
  if (!v) return;
  if (!listState.extra) listState.extra = [];
  if (listState.items.indexOf(v) < 0 && listState.extra.indexOf(v) < 0) listState.extra.push(v);
  if (listState.tempSel.indexOf(v) < 0) listState.tempSel.push(v);
  renderMultiList();
}
function listSheetConfirm(){
  if (listState.mode === 'multi' && listState.onConfirm) listState.onConfirm(listState.tempSel.slice());
  savePresets().catch(function(){});
  closeAllSheets();
}
function listSheetAdd(){
  var inp = document.getElementById('listAddInput');
  var v = inp ? (inp.value || '').trim() : '';
  if (!v) return;
  var list = (listState.kind === 'country') ? state.countryPresets
           : (currentGenreTab === 'adult' ? state.genreAdult : state.genreNormal);
  if (list.indexOf(v) < 0) list.push(v);
  if (inp) inp.value = '';
  savePresets();
  renderManageList();
}
function openCountryManage(){
  listState.mode = 'manage';
  listState.kind = 'country';
  var seg = document.getElementById('listGenreSeg');
  if (seg) seg.style.display = 'none';
  setListSheetHeader('manage');
  var t = document.getElementById('listTitle');
  if (t) t.textContent = '国家/地区配置';
  var add = document.getElementById('listAddWrap');
  if (add) add.style.display = 'flex';
  renderManageList();
  openSheet('listSheet');
}
function openGenreManage(){
  listState.mode = 'manage';
  listState.kind = 'genre';
  var seg = document.getElementById('listGenreSeg');
  if (seg) seg.style.display = state.themeHidden ? '' : 'none';
  if (!state.themeHidden) currentGenreTab = 'normal';
  setListSheetHeader('manage');
  var t = document.getElementById('listTitle');
  if (t) t.textContent = '类型配置';
  var add = document.getElementById('listAddWrap');
  if (add) add.style.display = 'flex';
  switchGenreTab(currentGenreTab);
  renderManageList();
  openSheet('listSheet');
}
function renderManageList(){
  var body = document.getElementById('listBody');
  if (!body) return;
  body.className = '';
  var items, disabled;
  if (listState.kind === 'country'){ items = state.countryPresets; disabled = state.countryDisabled; }
  else if (currentGenreTab === 'adult'){ items = state.genreAdult; disabled = state.genreAdultDisabled; }
  else { items = state.genreNormal; disabled = state.genreNormalDisabled; }
  if (!items.length){
    body.innerHTML = '<div class="empty"><div class="empty-desc">暂无条目，可在上方添加</div></div>';
    return;
  }
  body.innerHTML = items.map(function(v, i){
    var on = !disabled.has(v);
    return '<div class="srow" data-val="' + escapeAttr(v) + '" style="border-bottom:1px solid var(--border);">'
         +   '<span class="sr-body"><span class="sr-label' + (on ? '' : ' text-3') + '">' + escapeHtml(v) + '</span></span>'
         +   '<span class="sr-ctrl">'
         +     '<label class="switch"><input type="checkbox"' + (on ? ' checked' : '') + ' onchange="toggleManageEnabled(this)"><span class="track"><span class="thumb"></span></span></label>'
         +     '<button class="btn btn-ghost btn-sm btn-icon" onclick="manageDelete(' + i + ')" title="删除">' + CTX_ICONS.trash + '</button>'
         +   '</span>'
         + '</div>';
  }).join('');
}
function manageDelete(i){
  var list = (listState.kind === 'country') ? state.countryPresets
           : (currentGenreTab === 'adult' ? state.genreAdult : state.genreNormal);
  var v = list[i];
  if (v == null) return;
  showConfirm({
    title: '删除「' + v + '」',
    desc: '将从预设列表中移除，不影响已使用该标签的影片。',
    okText: '删除',
    onOk: function(){
      list.splice(i, 1);
      savePresets();
      renderManageList();
      showToast('已删除', 'success');
    }
  });
}

/* ---------- 媒体上传 ---------- */
var MEDIA_PH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
function renderMediaThumb(type, url){
  var col = document.getElementById(type + 'Upload');
  if (!col) return;
  var bar = document.getElementById(type + 'Bar');
  var img = col.querySelector('img');
  var ph = col.querySelector('.md-ph');
  if (url){
    if (ph) col.removeChild(ph);
    if (!img){
      img = document.createElement('img');
      col.insertBefore(img, col.firstChild);
    }
    img.src = url;
    if (bar) bar.style.display = '';
  } else {
    if (img) col.removeChild(img);
    if (!ph){
      ph = document.createElement('div');
      ph.className = 'md-ph';
      ph.innerHTML = MEDIA_PH + '<span>点击或拖入</span>';
      col.insertBefore(ph, col.firstChild);
    }
    if (bar) bar.style.display = 'none';
  }
  refreshSubtitleBadges();   // 渲染图片后按 hasSubtitle 叠加/移除角标
}
function triggerUpload(type){
  var map = { poster: 'posterInput', fanart: 'fanartInput', logo: 'logoInput', person: 'personInput' };
  var id = map[type];
  if (id) document.getElementById(id).click();
}
function replaceMedia(type){ triggerUpload(type); }
function onMediaColClick(type){
  if (state[type]) openImagePreview(type);
  else triggerUpload(type);
}
function deleteMedia(type){
  state[type] = null;
  clearMediaThumb(type);
  updateState();
  markDirty(true);
}
function handleImageUpload(ev, type){
  var input = ev.target;
  var f = input && input.files && input.files[0];
  if (!f) return;
  var r = new FileReader();
  r.onload = function(){
    var url = String(r.result);
    cropOriginals[type] = url;
    if (type === 'person'){
      state.personPhoto = url;
      openCrop(type);
    } else {
      state[type] = url;
      renderMediaThumb(type, url);
      updateState();
      markDirty(true);
    }
  };
  r.readAsDataURL(f);
  input.value = '';
}
function handleNfoImport(ev){
  var input = ev.target;
  var f = input && input.files && input.files[0];
  if (!f) return;
  var r = new FileReader();
  r.onload = function(){
    try {
      var txt = String(r.result);
      var doc = new DOMParser().parseFromString(txt, 'text/xml');
      var err = doc.getElementsByTagName('parsererror');
      if (err && err.length) throw new Error('XML 解析失败');
      var root = doc.documentElement;
      var film = { id: '', data: {} };
      var pick = function(tag){
        var n = root.getElementsByTagName(tag);
        return (n && n[0] && n[0].textContent) ? n[0].textContent.trim() : '';
      };
      var title = pick('title');
      if (!title) throw new Error('缺少 title 字段');
      film.data.title = title;
      film.data.originaltitle = pick('originaltitle');
      film.data.plot = pick('plot');
      film.data.premiered = pick('premiered');
      film.data.year = pick('year');
      film.data.runtime = pick('runtime');
      film.data.rating = pick('rating');
      film.data.mpaa = pick('mpaa');
      film.data.studio = pick('studio');
      film.data.trailer = pick('trailer');
      var gs = root.getElementsByTagName('genre');
      film.data.genres = [];
      for (var i = 0; i < gs.length; i++){
        var g = (gs[i].textContent || '').trim();
        if (g) film.data.genres.push(g);
      }
      var cs = root.getElementsByTagName('country');
      film.data.countries = [];
      for (var j = 0; j < cs.length; j++){
        var c = (cs[j].textContent || '').trim();
        if (c) film.data.countries.push(c);
      }
      var acts = root.getElementsByTagName('actor');
      film.data.actors = [];
      for (var k = 0; k < acts.length; k++){
        var nm = acts[k].getElementsByTagName('name');
        var rl = acts[k].getElementsByTagName('role');
        film.data.actors.push({
          name: (nm && nm[0] && nm[0].textContent) ? nm[0].textContent.trim() : '',
          role: (rl && rl[0] && rl[0].textContent) ? rl[0].textContent.trim() : ''
        });
      }
      var drs = root.getElementsByTagName('director');
      film.data.directors = [];
      for (var d = 0; d < drs.length; d++){
        var dn = (drs[d].textContent || '').trim();
        if (dn) film.data.directors.push({ name: dn, role: '导演' });
      }
      film.source = 'nfo';
      newFilm(false);
      applyFilmData(film);
      state.source = 'nfo';
      switchPage('edit');
      switchHomeTab('basic');
      showToast('已导入 NFO', 'success');
    } catch (e){
      showToast('NFO 解析失败：' + ((e && e.message) || '格式不正确'), 'error');
    }
  };
  r.readAsText(f, 'utf-8');
  input.value = '';
}

/* ---------- 其它同步 ---------- */
function updateSubtitleBtn(){
  var b = document.getElementById('dtActSub');
  if (b) b.style.display = state.activationCode ? '' : 'none';
}
function updateAdultPhraseCount(){
  var ta = document.getElementById('adultPhraseInput');
  var el = document.getElementById('adultPhraseCount');
  if (!ta || !el) return;
  var n = ta.value.split('\n').filter(function(s){ return s.trim(); }).length;
  el.textContent = '共 ' + n + ' 条';
}
function openAdultPhraseSheet(){
  var ta = document.getElementById('adultPhraseInput');
  if (ta) ta.value = currentAdultPhrases.join('\n');
  updateAdultPhraseCount();
  openSheet('adultPhraseSheet');
}
function onAdultPhraseFile(inp){
  var f = inp && inp.files && inp.files[0];
  if (!f) return;
  var r = new FileReader();
  r.onload = function(){
    var txt = String(r.result || '');
    var list = [];
    try {
      var j = JSON.parse(txt);
      if (Array.isArray(j)) list = j;
      else if (j && Array.isArray(j.list)) list = j.list;
      else list = txt.split('\n');
    } catch (e){ list = txt.split('\n'); }
    list = list.map(function(s){ return String(s || '').trim(); }).filter(Boolean);
    var ta = document.getElementById('adultPhraseInput');
    if (ta) ta.value = list.join('\n');
    updateAdultPhraseCount();
    showToast('已导入 ' + list.length + ' 条', 'success');
  };
  r.readAsText(f, 'utf-8');
  inp.value = '';
}
function saveAdultPhrases(){
  var ta = document.getElementById('adultPhraseInput');
  if (!ta) return;
  var list = ta.value.split('\n').map(function(s){ return s.trim(); }).filter(Boolean);
  setAdultLoadingPhrases(list).then(function(){
    currentAdultPhrases = list;
    closeAllSheets();
    showToast('已保存 ' + list.length + ' 条', 'success');
  }).catch(function(){ showToast('保存失败', 'error'); });
}

/* ===================================================================
   详情页（沉浸式，宽屏限宽居中）
   =================================================================== */
function renderFilmDetail(film){
  stopDetailBgSlideshow();
  currentDetailFilm = film || null;
  var d = film.data || {};
  var adult = !!film.adult;
  // 底图优先用剧照（宽图 fanart），没有剧照时再回退到海报
  var bgUrl = d.fanart || (d.fanartCandidates && d.fanartCandidates[0]) || d.detailPoster || film.posterDataUrl || d.poster || '';
  var bgEl = document.getElementById('detailBg');
  var pe = document.getElementById('detailPoster');
  if (pe) pe.style.backgroundImage = bgUrl ? 'url(' + escapeAttr(bgUrl) + ')' : '';
  if (bgEl){
    bgEl.style.setProperty('--dt-alpha', '0');
    bgEl.style.setProperty('--dt-glass', '0px');
    bgEl.style.removeProperty('--dt-par');
    bgEl.style.removeProperty('--dt-r');
    bgEl.style.removeProperty('--dt-g');
    bgEl.style.removeProperty('--dt-b');
  }
  // 同步清理详情页根的同色变量，避免上一部影片的色值残留到下方纯色区
  var pd = document.getElementById('page-detail');
  if (pd){ pd.style.removeProperty('--dt-r'); pd.style.removeProperty('--dt-g'); pd.style.removeProperty('--dt-b'); }
  applyDetailTint(bgUrl, bgEl);
  detailBgCurrentUrl = bgUrl; /* 记录初始底图，轮播时避免立刻重复选它 */

  /* 标题：Logo → 番号 → 片名 */
  var titleEl = document.getElementById('detailTitle');
  if (d.logo){
    titleEl.className = 'detail-title';
    titleEl.innerHTML = '<img class="detail-logo-img" src="' + escapeAttr(d.logo) + '" alt="' + escapeAttr(d.title || film.id) + '">';
  } else if (d.dvdId){
    titleEl.className = 'detail-title detail-title-av';
    titleEl.textContent = String(d.dvdId).toUpperCase();
  } else {
    titleEl.className = 'detail-title';
    titleEl.textContent = d.title || film.id;
  }
  currentDetailTitle = d.logo ? (d.title || film.id)
    : (d.dvdId ? String(d.dvdId).toUpperCase() : (d.title || film.id));
  titleEl.onclick = function(){ copyText(currentDetailTitle, '标题'); };

  /* 元信息行 */
  var info1 = [];
  if (d.rating) info1.push('<span class="dt-star">★</span> ' + escapeHtml(String(d.rating)));
  var rtMin = parseInt(d.runtime, 10);
  if (rtMin > 0) info1.push(rtMin + ' 分钟');
  if (d.premiered) info1.push(escapeHtml(String(d.premiered)));
  if (d.countries && d.countries.length) info1.push(escapeHtml(d.countries.join(' / ')));
  if (d.mpaa) info1.push(escapeHtml(String(d.mpaa)));
  var el1 = document.getElementById('detailInfo1');
  el1.innerHTML = info1.join(' ｜ ');
  el1.style.display = info1.length ? '' : 'none';

  var avParts = [d.studio, d.label, d.series].map(normalizeTextField).filter(function(x){ return x; });
  var elAv = document.getElementById('detailInfoAv');
  if (elAv){
    elAv.innerHTML = avParts.map(escapeHtml).join(' ｜ ');
    elAv.style.display = avParts.length ? '' : 'none';
  }

  var tags = (d.genres && d.genres.length) ? d.genres.slice(0, 8) : [];
  var el2 = document.getElementById('detailInfo2');
  el2.textContent = tags.length ? tags.join(' · ') : '';
  el2.style.display = tags.length ? '' : 'none';

  /* 预告片 */
  currentDetailTrailer = (adult && d.dvdId) ? buildDmmTrailerUrl(d.dvdId) : (d.trailer || '');
  var isAvTrailer = adult && d.dvdId;
  var extBtn = document.getElementById('trailerExtBtn');
  if (extBtn) extBtn.style.display = (currentDetailTrailer && isDirectVideoUrl(currentDetailTrailer)) ? '' : 'none';
  var tb = document.getElementById('detailTrailer');
  var tbt = document.getElementById('detailTrailerText');
  if (tb){
    if (currentDetailTrailer){ tb.removeAttribute('disabled'); if (tbt) tbt.textContent = '播放预告片'; }
    else { tb.setAttribute('disabled', 'disabled'); if (tbt) tbt.textContent = '暂无预告片'; }
  }
  var mb = document.getElementById('dtActMagnet');
  if (mb) mb.style.display = (state.activationCode && (state.magnetWorker || DEFAULT_WORKER)) ? '' : 'none';
  updateSubtitleBtn();

  /* 剧情 */
  var plotText = '[' + (d.title || film.id) + ']' + (d.plot ? ' ' + d.plot : '');
  var plotEl = document.getElementById('detailPlot');
  plotEl.textContent = plotText;
  plotEl.onclick = function(){ copyText(plotText, '简介'); };

  /* 演职员：演员在前（最多 11 位），导演在后 */
  var people = [];
  var actors = (d.actors || []).slice(0, 11);
  actors.forEach(function(p){ people.push({ name: p.name || '', role: p.role || '', photo: p.photo }); });
  (d.directors || []).forEach(function(p){ people.push({ name: p.name || '', role: '导演', photo: p.photo }); });
  var castEl = document.getElementById('detailCast');
  if (people.length){
    var ch = '<div class="detail-cast-title">演职人员</div><div class="detail-cast-row">';
    people.forEach(function(p){
      var nm = p.name || '?';
      var ini = escapeHtml(nm.charAt(0) || '?');
      var photoUrl = p.photo ? javbusImgUrl(p.photo) : null;
      var avaAttr = photoUrl ? ' style="background-image:url(' + escapeAttr(photoUrl) + ')"' : '';
      var roleLabel = (p.role === '导演') ? '导演名' : '演员名';
      var copyAttr = ' data-name="' + escapeAttr(nm) + '" onclick="copyText(this.dataset.name, \'' + roleLabel + '\');event.stopPropagation();"';
      ch += '<div class="detail-person">'
          +   '<div class="dp-ava"' + avaAttr + copyAttr + '>' + (photoUrl ? '' : ini) + '</div>'
          +   '<div class="dp-name"' + copyAttr + '>' + escapeHtml(nm) + '</div>'
          +   (p.role ? '<div class="dp-role">' + escapeHtml(p.role) + '</div>' : '')
          + '</div>';
    });
    ch += '</div>';
    castEl.innerHTML = ch;
  } else {
    castEl.innerHTML = '';
  }

  /* 磁力 */
  var magEl = document.getElementById('detailMagnets');
  if (magEl){
    detailMagnetItems = (d.javbusMagnets || []).filter(function(m){ return m && m.link; });
    detailMagnetItems.sort(function(a, b){
      function tier(m){ var s = 0; if (m.hasSubtitle) s += 1; if (m.isHD) s += 2; return s; }
      var order = { 3: 0, 1: 1, 2: 2, 0: 3 };
      return order[tier(a)] - order[tier(b)];
    });
    if (detailMagnetItems.length){
      detailMagnetVisibleCount = Math.min(MAGNET_INITIAL, detailMagnetItems.length);
      var itemsHtml = detailMagnetItems.map(function(m, i){
        return '<div class="detail-magnet" data-idx="' + i + '" style="display:' + (i < detailMagnetVisibleCount ? '' : 'none') + '"'
             + ' data-link="' + escapeAttr(m.link) + '" onclick="copyText(this.dataset.link, \'磁链\')">'
             + renderMagnetItemInner(m) + '</div>';
      }).join('');
      magEl.innerHTML = '<div class="detail-cast-title">磁力链接</div><div class="detail-magnet-list">' + itemsHtml + renderMagnetToggleHtml() + '</div>';
      magEl.style.display = '';
    } else {
      magEl.innerHTML = '';
      magEl.style.display = 'none';
    }
  }

  /* 剧照：逐张加载，按三列逻辑高度插入最矮列（加载更多零重排、不整体重排） */
  var shotEl = document.getElementById('detailShots');
  if (shotEl){
    var shots = [];
    if (d.originalPoster) shots.push(d.originalPoster);
    else if (d.poster) shots.push(d.poster);
    var galleryArr = Array.isArray(d.gallery) ? d.gallery : (d.gallery ? [d.gallery] : []);
    var links = Array.isArray(d.galleryLinks) ? d.galleryLinks : [];
    // 剧照以「全量链接」为准展示所有张数；能命中已缓存 dataURL（前 6 张）则优先用缓存（离线可见），其余走远程链接
    var stillSrc = (links.length ? links : galleryArr).slice();
    var stills = stillSrc.map(function(url, i){ return (galleryArr[i] && String(galleryArr[i]).indexOf('data:') === 0) ? galleryArr[i] : url; });
    if (!stills.length){
      if (d.fanart) stills.push(d.fanart);
      if (d.fanartCandidates && d.fanartCandidates.length) stills = stills.concat(d.fanartCandidates);
    }
    shots = shots.concat(stills);
    var seen = {};
    var fullShots = shots.filter(function(s){ if (!s || seen[s]) return false; seen[s] = 1; return true; });
    detailFullShots = fullShots;
    currentDetailShots = fullShots.slice();
    if (fullShots.length){
      detailShotQueueIndex = 0;
      detailShotColH = [0, 0, 0];
      detailShotRevealQueue = [];
      detailShotRevealing = false;
      detailVisibleShots = [];
      var html = '<div class="detail-shots-title">剧照</div><div class="detail-shots-cols"><div class="detail-shot-col"></div><div class="detail-shot-col"></div><div class="detail-shot-col"></div></div>';
      if (fullShots.length > getShotCap()){
        html += '<button class="detail-shots-more" onclick="loadMoreShots()">加载更多</button>';
      }
      shotEl.innerHTML = html;
      shotEl.style.display = '';
      // 列容器先同步就绪（onload 可能早于 rAF，先赋值避免丢图）；列宽等布局算好后入队
      detailShotCols = [].slice.call(shotEl.querySelectorAll('.detail-shot-col'));
      requestAnimationFrame(function(){
        var colsWrap = shotEl.querySelector('.detail-shots-cols');
        detailShotColW = colsWrap ? Math.max(1, (colsWrap.clientWidth - 24) / 3) : 200;
        var initN = Math.min(getShotCap(), fullShots.length);
        for (var q = 0; q < initN; q++) queueShot(q, stillDisplayUrl(fullShots[q]));
      });
    } else {
      shotEl.innerHTML = '';
      shotEl.style.display = 'none';
    }
  }
  updateDetailScrollEffect();
  refreshDetailBgPool();
}

function openShotPreview(i){
  previewType = 'shot';
  // 灯箱只跟随当前已创建的剧照 DOM（不会全量网络加载），计数与翻页都在已显示池内
  previewList = detailVisibleShots.map(function(it){ return it.url; });
  previewIndex = i;
  openImagePreview('shot');
}
var detailShotCols = [];
var detailShotColH = [0, 0, 0];
var detailShotColW = 200;
var detailShotQueueIndex = 0;
var detailShotRevealQueue = [];
var detailShotRevealing = false;
var detailVisibleShots = []; /* 当前已显示的剧照（含真实尺寸），作为底图轮播的宽图候选池 */
var SHOT_REVEAL_MS = 150;
function loadMoreShots(){
  if (!detailShotCols.length) return;
  // 续入队下一批，走同一 queueShot/placeShot，前面已放置的图零重排
  var end = Math.min(detailShotQueueIndex + SHOTS_BATCH, detailFullShots.length, getShotCap());
  for (; detailShotQueueIndex < end; detailShotQueueIndex++){
    queueShot(detailShotQueueIndex, stillDisplayUrl(detailFullShots[detailShotQueueIndex]));
  }
  var btn = document.querySelector('.detail-shots-more');
  if (btn) btn.style.display = (detailShotQueueIndex >= detailFullShots.length) ? 'none' : '';
}
function queueShot(idx, src){
  // 用 Image() 预载探测尺寸，onload 后再插入最矮列，避免占位导致整体重排
  var probe = new Image();
  probe.onload = function(){ placeShot(idx, src, probe.naturalWidth, probe.naturalHeight); };
  probe.onerror = function(){ placeShot(idx, src, 0, 0); };
  probe.src = src;
}
function placeShot(idx, src, nw, nh){
  if (!detailShotCols.length) return;
  // 选当前逻辑高度最矮的列
  var c = 0;
  if (detailShotColH[1] < detailShotColH[0]) c = 1;
  if (detailShotColH[2] < detailShotColH[c]) c = 2;
  var el = document.createElement('div');
  el.className = 'detail-shot';
  el.setAttribute('data-idx', idx);
  el.addEventListener('click', function(){ openShotPreview(idx); });
  var img = document.createElement('img');
  img.loading = 'lazy';
  img.alt = '';
  img.onload = function(){ this.classList.add('shot-loaded'); };
  img.src = src;
  el.appendChild(img);
  detailShotCols[c].appendChild(el);
  // 累加该列逻辑高度（按列宽等比缩放），用于后续最矮列判断
  var estH = (nw && nh) ? (detailShotColW * nh / nw) : 200;
  detailShotColH[c] += estH + 12;
  // 先保持隐藏，交给串行揭示队列，确保「一张接一张」逐张出现（即便网络好、多图同时 onload 也严格串行）
  el.classList.remove('shot-in');
  detailShotRevealQueue.push(el);
  pumpShotReveal();
  // 已显示的剧照进入底图轮播候选池（带真实尺寸，无需再全量预载）；池扩大时自动重算宽图
  detailVisibleShots.push({ url: src, w: nw, h: nh });
  refreshDetailBgPool();
}

function pumpShotReveal(){
  if (detailShotRevealing) return;
  if (!detailShotRevealQueue.length) return;
  detailShotRevealing = true;
  var el = detailShotRevealQueue.shift();
  requestAnimationFrame(function(){ el.classList.add('shot-in'); });
  // 等本张淡入动画基本结束，再揭示下一张
  setTimeout(function(){ detailShotRevealing = false; pumpShotReveal(); }, SHOT_REVEAL_MS);
}

/* 滚动渐变 + 磨砂（滚轮同样触发） */
function updateDetailScrollEffect(){
  var bgEl = document.getElementById('detailBg');
  var sc = document.getElementById('detailScroll');
  if (!bgEl || !sc) return;
  // PC 端与手机端一致：顶部清晰，随滚动逐渐变糊、遮罩加深
  var range = sc.clientHeight * DETAIL_ALPHA_CAP_AT;
  var p = sc.scrollTop / range;
  if (p < 0) p = 0; else if (p > 1) p = 1;
  // ① 遮罩透明度：0 -> DETAIL_ALPHA_MAX，指数加深
  var alpha = DETAIL_ALPHA_MAX * (Math.exp(2.5 * p) - 1) / (DETAIL_EXP_BASE - 1);
  bgEl.style.setProperty('--dt-alpha', alpha.toFixed(3));
  // ② 磨砂玻璃：从 DETAIL_GLASS_START_AT 比例起线性增加到 DETAIL_GLASS_MAX
  var gStart = DETAIL_GLASS_START_AT / DETAIL_ALPHA_CAP_AT;
  var glass = Math.max(0, (p - gStart) / (1 - gStart)) * DETAIL_GLASS_MAX;
  if (glass > DETAIL_GLASS_MAX) glass = DETAIL_GLASS_MAX;
  bgEl.style.setProperty('--dt-glass', glass.toFixed(1) + 'px');
  // ③ 轻微视差：底图随滚动缓慢上移制造景深
  var par = Math.min(sc.scrollTop * 0.06, 30);
  bgEl.style.setProperty('--dt-par', (-par).toFixed(1) + 'px');
}
function initDetailScroll(){
  var sc = document.getElementById('detailScroll');
  if (!sc) return;
  sc.addEventListener('scroll', updateDetailScrollEffect, { passive: true });
}

/* ---------- 详情页底图自动轮播（仅宽图，交叉淡入） ---------- */
var detailBgTimer = null;
var detailBgActiveLayer = 0;   /* 0 = #detailPoster，1 = #detailPoster2 */
var detailBgCurrentUrl = '';
var detailBgLandscapes = [];

/* 停止轮播并复位两层 */
function stopDetailBgSlideshow(){
  if (detailBgTimer){ clearInterval(detailBgTimer); detailBgTimer = null; }
  detailBgLandscapes = [];
  detailBgCurrentUrl = '';
  detailBgActiveLayer = 0;
  var p1 = document.getElementById('detailPoster');
  var p2 = document.getElementById('detailPoster2');
  if (p1){ p1.style.transition = 'none'; p1.style.transform = 'scale(1)'; p1.style.opacity = '1'; }
  if (p2){ p2.style.backgroundImage = ''; p2.style.opacity = '0'; p2.style.transform = 'scale(1)'; }
}
/* 离开详情页时把「加载更多」加载的多余剧照从 DOM 中卸掉，只保留初始 SHOTS_INITIAL 张，释放内存解码资源。
   下次进入会由 renderFilmDetail 重新渲染前 SHOTS_INITIAL 张，互不干扰。 */
function trimShotsToInitial(){
  var init = getShotCap();
  var nodes = document.querySelectorAll('.detail-shot');
  for (var i = 0; i < nodes.length; i++){
    var seq = parseInt(nodes[i].getAttribute('data-idx'), 10);
    if (!isNaN(seq) && seq >= init) nodes[i].remove();
  }
  if (detailShotQueueIndex > init) detailShotQueueIndex = init;
  if (detailVisibleShots.length > init) detailVisibleShots = detailVisibleShots.slice(0, init);
  detailShotRevealQueue = [];
  detailShotRevealing = false;
  var btn = document.querySelector('.detail-shots-more');
  if (btn) btn.style.display = 'none';
}

/* 从「当前已显示的剧照」中挑宽图作为底图轮播候选池（用 placeShot 已拿到的真实尺寸，不再全量预载）。
   点「加载更多」后已显示剧照增多，池子自动扩大；不足 2 张宽图则保持静止。 */
function refreshDetailBgPool(){
  var lands = [];
  for (var i = 0; i < detailVisibleShots.length; i++){
    var it = detailVisibleShots[i];
    if (it && it.w > it.h * 1.05) lands.push(it.url);
  }
  var seen = {}; var uniq = [];
  lands.forEach(function(u){ if (u && !seen[u]){ seen[u] = 1; uniq.push(u); } });
  detailBgLandscapes = uniq;
  if (uniq.length < 2) return; /* 不足 2 张宽图则不切换，保持静止（用户要求） */
  if (detailBgTimer) return;   /* 已在轮播，仅更新候选池即可 */
  /* 首次启动：当前显示的初始图立即开始 5 秒缓慢放大 */
  var layers = [document.getElementById('detailPoster'), document.getElementById('detailPoster2')];
  var cur = layers[detailBgActiveLayer];
  if (cur){ cur.style.transition = 'opacity .9s ease, transform 5s ease-out'; cur.style.transform = 'scale(1.1)'; }
  detailBgTimer = setInterval(detailBgCrossfade, 5000);
}

/* 缓慢放大 + 交叉淡入：当前图放大到 110% 后，换下一张（下一张从 100% 重新放大） */
function detailBgCrossfade(){
  if (!detailBgLandscapes.length) return;
  var idx;
  do { idx = Math.floor(Math.random() * detailBgLandscapes.length); }
  while (detailBgLandscapes.length > 1 && detailBgLandscapes[idx] === detailBgCurrentUrl);
  var url = detailBgLandscapes[idx];
  var layers = [document.getElementById('detailPoster'), document.getElementById('detailPoster2')];
  var active = layers[detailBgActiveLayer];
  var inactive = layers[1 - detailBgActiveLayer];
  if (!active || !inactive) return;
  /* 非活动层：先无动画复位到 scale(1)、设新图，强制重排后再淡入+缓慢放大到 110% */
  inactive.style.transition = 'none';
  inactive.style.transform = 'scale(1)';
  inactive.style.backgroundImage = 'url(' + escapeAttr(url) + ')';
  void inactive.offsetWidth; /* 强制重排，确保 opacity/transform 过渡生效 */
  inactive.style.transition = 'opacity .9s ease, transform 5s ease-out';
  inactive.style.opacity = '1';
  inactive.style.transform = 'scale(1.1)';
  /* 当前活动层淡出（保留其在放大尾段状态，仅做淡出） */
  active.style.transition = 'opacity .9s ease';
  active.style.opacity = '0';
  detailBgActiveLayer = 1 - detailBgActiveLayer;
  detailBgCurrentUrl = url;
}

/* ---------- 详情页操作 ---------- */
function detailEdit(){
  if (!currentDetailFilmId) return;
  newFilm();
  openFilm(encodeURIComponent(currentDetailFilmId));
}
function detailDownloadMeta(){
  if (!currentDetailFilmId) return;
  downloadMetadata(currentDetailFilmId);
}
function detailDelete(){
  if (!currentDetailFilmId) return;
  var id = currentDetailFilmId;
  var f = currentDetailFilm;
  showConfirm({
    title: '删除影片',
    desc: '「' + ((f && f.data && f.data.title) || id) + '」将从本地库中移除，此操作不可撤销。',
    okText: '删除',
    onOk: function(){
      deleteFilm(id).then(function(){
        showToast('已删除', 'success');
        renderOverview();
        switchPage('home');
      }).catch(function(){ showToast('删除失败', 'error'); });
    }
  });
}

/* ---------- 预告片播放 ---------- */
function openTrailer(){
  var url = currentDetailTrailer;
  if (!url) return;
  if (isDirectVideoUrl(url)){
    showTrailerModal(url, 'video');
  } else {
    var key = '';
    var m = url.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{6,})/);
    if (m) key = m[1];
    else if (/^[A-Za-z0-9_-]{6,}$/.test(url)) key = url;
    if (!key){ showToast('无法识别的预告片地址', 'error'); return; }
    showTrailerModal('https://www.youtube.com/embed/' + key + '?autoplay=1&rel=0', 'iframe');
  }
}
function showTrailerModal(url, kind){
  var frame = document.getElementById('trailerFrame');
  var ext = document.getElementById('trailerExtBtn');
  if (ext) ext.style.display = (kind === 'video') ? '' : 'none';
  if (frame) frame.src = url;
  openSheet('trailerModal');
}
function closeTrailer(){
  var frame = document.getElementById('trailerFrame');
  if (frame) frame.src = '';
  var m = document.getElementById('trailerModal');
  if (m) m.classList.remove('show');
  if (!document.querySelector('.modal.show')){
    var mask = document.getElementById('sheetMask');
    if (mask) mask.classList.remove('show');
  }
}

/* ===================================================================
   磁力搜索
   =================================================================== */
function openMagnetSheet(){
  var f = currentDetailFilm;
  magnetCurrentFilm = f || null;
  var modeBox = document.getElementById('magnetTitleMode');
  if (modeBox) modeBox.style.display = f ? '' : 'none';
  var inp = document.getElementById('magnetQueryInput');
  if (inp){
    var d = (f && f.data) || {};
    inp.value = d.dvdId || d.title || '';
  }
  toggleMagnetClear();
  var box = document.getElementById('magnetResults');
  if (box) box.innerHTML = '<div class="empty"><div class="empty-desc">确认关键词后点击搜索</div></div>';
  openSheet('magnetSheet');
  if (inp) inp.focus();
}
function toggleMagnetClear(){
  var inp = document.getElementById('magnetQueryInput');
  var btn = document.getElementById('magnetClear');
  if (btn) btn.classList.toggle('show', !!(inp && inp.value));
}
function clearMagnetQuery(){
  var inp = document.getElementById('magnetQueryInput');
  if (inp) inp.value = '';
  toggleMagnetClear();
  if (inp) inp.focus();
}
function onMagnetTitleModeChange(mode, btn){
  var d = (magnetCurrentFilm && magnetCurrentFilm.data) || {};
  var inp = document.getElementById('magnetQueryInput');
  if (inp) inp.value = (mode === 'original') ? (d.originaltitle || d.title || '') : (d.title || '');
  toggleMagnetClear();
  var seg = document.getElementById('magnetTitleMode');
  if (seg){
    var bs = seg.querySelectorAll('button');
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('active', bs[i].getAttribute('data-mode') === mode);
  }
}
function renderMagnetResults(items){
  stopLoadingRotator();
  var box = document.getElementById('magnetResults');
  if (!box) return;
  if (!items || !items.length){
    box.innerHTML = '<div class="empty"><div class="empty-title">未找到磁力链接</div><div class="empty-desc">换个关键词或番号试试</div></div>';
    return;
  }
  box.innerHTML = items.map(function(it){
    var meta = [];
    if (it.size) meta.push(escapeHtml(it.size));
    if (it.seeders) meta.push('做种 ' + escapeHtml(String(it.seeders)));
    if (it.leechers) meta.push('下载 ' + escapeHtml(String(it.leechers)));
    var magnet = escapeAttr(decodeXmlEntities(it.magnet || ''));
    return '<div class="result-item" data-magnet="' + magnet + '" onclick="copyMagnet(this)">'
         +   '<div class="result-body">'
         +     '<div class="result-title">' + escapeHtml(it.title || '无标题') + '</div>'
         +     '<div class="result-meta"><span class="badge badge-accent">' + escapeHtml(it.source || 'bt4g') + '</span>'
         +       (meta.length ? '<span>' + meta.join(' · ') + '</span>' : '') + '</div>'
         +   '</div>'
         + '</div>';
  }).join('');
}

/* ===================================================================
   字幕搜索
   =================================================================== */
function openSubtitleSheet(){
  var f = currentDetailFilm;
  var d = (f && f.data) || {};
  var inp = document.getElementById('subQueryInput');
  if (inp) inp.value = (d.title || '') + (d.year ? ('.' + d.year) : '');
  subUserEdited = false;
  onSubQueryChange();
  var box = document.getElementById('subResults');
  if (box) box.innerHTML = '<div class="empty"><div class="empty-desc">确认片名后点击搜索</div></div>';
  openSheet('subtitleSheet');
  if (inp) inp.focus();
}
function onSubQueryChange(){
  var inp = document.getElementById('subQueryInput');
  var btn = document.getElementById('subQueryClear');
  if (btn) btn.classList.toggle('show', !!(inp && inp.value));
}
function clearSubQuery(){
  var inp = document.getElementById('subQueryInput');
  if (inp) inp.value = '';
  onSubQueryChange();
  if (inp) inp.focus();
}
function selectSubTitleMode(mode, btn){
  var f = currentDetailFilm;
  var d = (f && f.data) || {};
  var inp = document.getElementById('subQueryInput');
  if (inp) inp.value = (mode === 'original') ? (d.originaltitle || d.title || '') : (d.title || '');
  onSubQueryChange();
  var seg = document.getElementById('subTitleModeSeg');
  if (seg){
    var bs = seg.querySelectorAll('button');
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('active', bs[i].getAttribute('data-mode') === mode);
  }
}
function onSubLangSelect(sel){ subCurrentLang = sel.value; }
function renderSubtitleResults(items, warnings){
  stopLoadingRotator();
  subResultsCache = items || [];
  var box = document.getElementById('subResults');
  if (!box) return;
  var list = subResultsCache.slice().sort(function(a, b){
    return (a.source === 'assrt' ? 0 : 1) - (b.source === 'assrt' ? 0 : 1);
  });
  if (!list.length){
    box.innerHTML = '<div class="empty"><div class="empty-title">未找到字幕</div>'
      + (warnings && warnings.length ? '<div class="empty-desc">' + escapeHtml(warnings.join('；')) + '</div>' : '')
      + '</div>';
    return;
  }
  var html = (warnings && warnings.length)
    ? '<div class="sub-warn">' + escapeHtml(warnings.join('；')) + '</div>' : '';
  html += list.map(function(it, i){
    var src = it.source === 'assrt' ? '伪射手' : 'OS';
    var cls = it.source === 'assrt' ? 'badge-warning' : 'badge-accent';
    var meta = [];
    if (it.downloads) meta.push('下载 ' + escapeHtml(String(it.downloads)));
    if (it.meta) meta.push(escapeHtml(String(it.meta)));
    return '<div class="result-item" onclick="downloadSubtitle(' + i + ')">'
         +   '<div class="result-body">'
         +     '<div class="result-title"><span class="badge ' + cls + '">' + src + '</span> '
         +       escapeHtml(it.title || '无标题') + '</div>'
         +     '<div class="result-meta"><span style="color:var(--accent);font-weight:600">'
         +       escapeHtml(it.langDesc || it.lang || '') + '</span>'
         +       (meta.length ? '<span>' + meta.join(' · ') + '</span>' : '') + '</div>'
         +   '</div>'
         + '</div>';
  }).join('');
  if ((state.tier || '') !== 'full'){
    html = '<div class="sub-warn">字幕下载暂不可用</div>' + html;
  }
  box.innerHTML = html;
}

/* ===================================================================
   图片全屏预览（滚轮缩放 / 拖拽平移 / 方向键翻页）
   =================================================================== */
function openImagePreview(type){
  if (type !== 'shot'){
    var cur = state[type];
    if (!cur) return;
    previewType = type;
    var cands = state[type + 'Candidates'];
    previewList = (cands && cands.length > 1) ? cands.slice() : [cur];
    previewIndex = Math.max(0, previewList.indexOf(cur));
  } else {
    previewType = 'shot';
  }
  if (!previewList || !previewList.length) return;
  renderPreview();
  document.getElementById('imagePreviewMask').classList.add('show');
  document.getElementById('imagePreviewModal').classList.add('show');
}
function renderPreview(){
  var img = document.getElementById('previewImg');
  if (img) img.src = previewList[previewIndex] || '';
  var dots = document.getElementById('previewDots');
  if (dots) dots.textContent = (previewIndex + 1) + ' / ' + previewList.length;
  var multi = previewList.length > 1;
  var p = document.getElementById('previewPrev');
  var n = document.getElementById('previewNext');
  if (p) p.classList.toggle('show', multi);
  if (n) n.classList.toggle('show', multi);
  resetPreviewZoom();
}
function previewStep(d){
  if (!previewList || !previewList.length) return;
  previewIndex = (previewIndex + d + previewList.length) % previewList.length;
  renderPreview();
}
function resetPreviewZoom(){
  previewZoom = { scale: 1, tx: 0, ty: 0 };
  applyPreviewZoom();
}
function previewZoomBy(d){
  previewZoom.scale = Math.min(5, Math.max(0.2, previewZoom.scale + d));
  if (previewZoom.scale <= 1.02){ previewZoom.scale = 1; previewZoom.tx = 0; previewZoom.ty = 0; }
  applyPreviewZoom();
}
function applyPreviewZoom(){
  var img = document.getElementById('previewImg');
  if (img) img.style.transform = 'translate(' + previewZoom.tx + 'px,' + previewZoom.ty + 'px) scale(' + previewZoom.scale + ')';
}
function closeImagePreview(){
  document.getElementById('imagePreviewMask').classList.remove('show');
  document.getElementById('imagePreviewModal').classList.remove('show');
  resetPreviewZoom();
}
function downloadCurrentPreview(){
  var url = previewList[previewIndex];
  if (!url) return;
  var a = document.createElement('a');
  a.href = url;
  a.download = 'image_' + (previewIndex + 1) + '.jpg';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
function initPreviewMouse(){
  var stage = document.getElementById('imagePreviewModal');
  var img = document.getElementById('previewImg');
  if (!stage || !img) return;
  stage.addEventListener('wheel', function(e){
    if (!stage.classList.contains('show')) return;
    e.preventDefault();
    previewZoomBy(e.deltaY > 0 ? -0.2 : 0.2);
  }, { passive: false });
  var dragging = false, sx = 0, sy = 0;
  img.addEventListener('mousedown', function(e){
    if (previewZoom.scale <= 1.02) return;
    e.preventDefault();
    dragging = true;
    sx = e.clientX - previewZoom.tx;
    sy = e.clientY - previewZoom.ty;
    img.classList.add('dragging');
  });
  document.addEventListener('mousemove', function(e){
    if (!dragging) return;
    previewZoom.tx = e.clientX - sx;
    previewZoom.ty = e.clientY - sy;
    applyPreviewZoom();
  });
  document.addEventListener('mouseup', function(){
    dragging = false;
    img.classList.remove('dragging');
  });
  img.addEventListener('dblclick', function(){
    if (previewZoom.scale > 1.05) resetPreviewZoom();
    else previewZoomBy(1);
  });
  var tsx = 0, tsy = 0, touchTrack = false;
  stage.addEventListener('touchstart', function(e){
    if (previewZoom.scale > 1.02) return;
    if (e.touches.length !== 1) return;
    touchTrack = true; tsx = e.touches[0].clientX; tsy = e.touches[0].clientY;
  }, { passive: true });
  stage.addEventListener('touchend', function(e){
    if (!touchTrack) return;
    touchTrack = false;
    var dx = e.changedTouches[0].clientX - tsx;
    var dy = e.changedTouches[0].clientY - tsy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) previewStep(dx < 0 ? 1 : -1);
  }, { passive: true });
  // 点图片外黑色背景区域关闭预览；点图片/按钮/计数不关闭
  var clickStart = null;
  stage.addEventListener('mousedown', function(e){ clickStart = { x: e.clientX, y: e.clientY }; });
  stage.addEventListener('click', function(e){
    if (e.target !== stage) return;
    if (clickStart && (Math.abs(e.clientX - clickStart.x) > 4 || Math.abs(e.clientY - clickStart.y) > 4)) return;
    closeImagePreview();
  });
}

/* ===================================================================
   裁剪（滚轮缩放 / 拖拽 / 双击复位）
   =================================================================== */
function openCrop(type){
  var url = cropOriginals[type] || state[type];
  if (!url) return;
  cropType = type;
  cropRatio = (type === 'fanart') ? fanartRatio : 0;
  var ratios = document.getElementById('cropRatios');
  if (ratios) ratios.style.display = (type === 'fanart') ? '' : 'none';
  var img = document.getElementById('cropImg');
  img.onload = function(){ resetCropTransform(); };
  img.src = url;
  openSheet('cropModal');
}
function setFanartRatio(r, btn){
  fanartRatio = (r === '16:9') ? 16 / 9 : (r === '3:2') ? 3 / 2 : (r === '4:3') ? 4 / 3 : 0;
  cropRatio = fanartRatio;
  var seg = document.getElementById('cropRatios');
  if (seg){
    var bs = seg.querySelectorAll('button');
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('active', bs[i].getAttribute('data-ratio') === r);
  }
  resetCropTransform();
}
function closeCrop(){
  var m = document.getElementById('cropModal');
  if (m) m.classList.remove('show');
  if (!document.querySelector('.modal.show')){
    var mask = document.getElementById('sheetMask');
    if (mask) mask.classList.remove('show');
  }
  cropType = null;
}
function initCropMouse(){
  var stage = document.getElementById('cropStage');
  var img = document.getElementById('cropImg');
  if (!stage || !img) return;
  stage.addEventListener('wheel', function(e){
    if (!document.getElementById('cropModal').classList.contains('show')) return;
    e.preventDefault();
    var t = img._crop;
    if (!t) return;
    t.scale *= (e.deltaY > 0 ? 0.92 : 1.08);
    clampCropTransform();
    applyCropTransform();
  }, { passive: false });
  var dragging = false, sx = 0, sy = 0;
  stage.addEventListener('mousedown', function(e){
    var t = img._crop;
    if (!t) return;
    dragging = true;
    sx = e.clientX - t.x;
    sy = e.clientY - t.y;
  });
  document.addEventListener('mousemove', function(e){
    if (!dragging) return;
    var t = img._crop;
    if (!t) return;
    t.x = e.clientX - sx;
    t.y = e.clientY - sy;
    clampCropTransform();
    applyCropTransform();
  });
  document.addEventListener('mouseup', function(){ dragging = false; });
  stage.addEventListener('dblclick', function(){ resetCropTransform(); });
}

/* ===================================================================
   表单事件
   =================================================================== */
function onMpaaSelect(sel){
  var v = sel.value || '';
  state.mpaa = v;
  state.adult = /^(nc-17|nr)$/i.test(v);
  applyEditMode();
  updateState();
  markDirty(true);
}
function onYearSelect(sel){
  state.year = sel.value || '';
  updateState();
  markDirty(true);
}
function onPremieredChange(inp){
  autoFillYear(inp.value);
  updateState();
  markDirty(true);
}
function onTrailerInput(inp){
  var v = (inp.value || '').trim();
  var key = '';
  var m = v.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{6,})/);
  if (m) key = m[1];
  else if (/^[A-Za-z0-9_-]{6,}$/.test(v)) key = v;
  else if (isDirectVideoUrl(v)) key = v;
  state.trailer = key || v || null;
  var h = document.getElementById('trailerHint');
  if (h){
    if (isDirectVideoUrl(v)){ h.textContent = '已识别直链视频'; h.style.color = 'var(--success)'; }
    else if (key){ h.textContent = '已识别预告片 ID：' + key; h.style.color = 'var(--success)'; }
    else if (v){ h.textContent = '未能识别，请输入 YouTube 链接 / 视频 ID / 直链'; h.style.color = 'var(--danger)'; }
    else { h.textContent = ''; h.style.color = ''; }
  }
  markDirty(true);
}
function initFormDirty(){
  var ids = ['title','originaltitle','premiered','year','runtime','rating','mpaa','dvdid','studio','label','series','plot','trailer'];
  ids.forEach(function(id){
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', function(){ markDirty(true); });
    el.addEventListener('change', function(){ markDirty(true); });
  });
  var hs = document.getElementById('hasSubtitle');
  if (hs) hs.addEventListener('change', function(){ markDirty(true); });
}

/* ===================================================================
   API 配置面板
   =================================================================== */
function openApiKeySheet(){
  var set = function(id, v){ var el = document.getElementById(id); if (el) el.value = v || ''; };
  set('apiKeyInput', state.apiKey);
  set('activationCodeInput', state.activationCode);
  toggleApiClear(); toggleActivationClear();
  updateActivationStatus();
  openSheet('apiSheet');
}
function _toggleClear(inputId, btnId){
  var i = document.getElementById(inputId);
  var b = document.getElementById(btnId);
  if (b) b.classList.toggle('show', !!(i && i.value));
}
function toggleApiClear(){ _toggleClear('apiKeyInput', 'apiClearBtn'); }
function clearApiInput(){ var i = document.getElementById('apiKeyInput'); if (i) i.value = ''; toggleApiClear(); }

function toggleActivationClear(){ _toggleClear('activationCodeInput', 'activationClearBtn'); }
function clearActivationInput(){ var i = document.getElementById('activationCodeInput'); if (i) i.value = ''; toggleActivationClear(); }

function updateActivationStatus(){
  var el = document.getElementById('activationStatus');
  if (!el) return;
  var t = (state.tier || '').trim();
  if (t === 'full' || t === 'medium'){ el.textContent = '已激活'; el.className = 'activation-status ok'; }
  else { el.textContent = '未激活'; el.className = 'activation-status'; }
}

function verifyActivationCode(){
  var code = ((document.getElementById('activationCodeInput') || {}).value || '').trim();
  if (!code){ showToast('请输入激活码', 'error'); return; }
  var w = state.magnetWorker || DEFAULT_WORKER;
  if (!w){ showToast('请先填写 Worker 地址', 'error'); return; }
  var url = w.replace(/\/$/, '') + '/verify?code=' + encodeURIComponent(code);
  fetch(url, { cache: 'no-store' })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d && d.ok){
        state.activationCode = code;
        state.tier = d.tier || '';
        Promise.all([ setActivationCode(code), setTier(state.tier) ]).then(function(){
          updateActivationStatus();
          showToast('已激活', 'success');
          // 验证后按新权限补载头像 / 剧照（若正在看详情页）
          if (typeof currentDetailFilm !== 'undefined' && currentDetailFilm){ loadCurrentCastPhotos(); renderFilmDetail(currentDetailFilm); }
        });
      } else {
        showToast('激活码无效', 'error');
      }
    })
    .catch(function(){ showToast('验证失败，请检查 Worker 地址', 'error'); });
}

/* ===================================================================
   恢复初始状态
   =================================================================== */
function showRestoreConfirm(){
  showConfirm({
    title: '恢复初始状态',
    desc: '将清空所有配置与本地缓存，恢复到初始状态。此操作不可撤销。',
    okText: '恢复',
    onOk: restoreApp
  });
}
function restoreApp(){
  showToast('正在恢复初始状态…');
  var clearIDB = new Promise(function(res){
    var r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = res; r.onerror = res; r.onblocked = res;
  });
  var clearCaches = ('caches' in window)
    ? caches.keys().then(function(ns){ return Promise.all(ns.map(function(n){ return caches.delete(n); })); })
    : Promise.resolve();
  Promise.all([clearIDB, clearCaches]).then(function(){ location.reload(); }).catch(function(){ location.reload(); });
  setTimeout(function(){ location.reload(); }, 1200);
}

/* ===================================================================
   拖放上传 / 侧栏 / 键盘
   =================================================================== */
function initDragDrop(){
  ['poster', 'fanart', 'logo'].forEach(function(type){
    var el = document.getElementById(type + 'Upload');
    if (!el) return;
    el.addEventListener('dragover', function(e){ e.preventDefault(); el.classList.add('dragover'); });
    el.addEventListener('dragleave', function(){ el.classList.remove('dragover'); });
    el.addEventListener('drop', function(e){
      e.preventDefault();
      el.classList.remove('dragover');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f || !/^image\//.test(f.type)) return;
      var r = new FileReader();
      r.onload = function(){
        var url = String(r.result);
        cropOriginals[type] = url;
        state[type] = url;
        renderMediaThumb(type, url);
        updateState();
        markDirty(true);
        showToast('已载入图片', 'success');
      };
      r.readAsDataURL(f);
    });
  });
}
function initSidebarNav(){
  var nav = document.getElementById('sidebarNav');
  if (!nav) return;
  nav.addEventListener('click', function(e){
    var btn = e.target.closest ? e.target.closest('.nav-item') : null;
    if (!btn) return;
    var page = btn.getAttribute('data-page');
    if (page === 'edit'){
      if (currentFilmId) openFilm(encodeURIComponent(currentFilmId));
      else openCustomEdit();
      return;
    }
    switchPage(page);
  });
  var tg = document.getElementById('sidebarToggle');
  if (tg) tg.addEventListener('click', toggleSidebar);
}
function initKeyboard(){
  document.addEventListener('keydown', function(e){
    var mod = e.ctrlKey || e.metaKey;
    var tag = (e.target && e.target.tagName || '').toLowerCase();
    var typing = (tag === 'input' || tag === 'textarea' || tag === 'select');
    var pal = document.getElementById('cmdPalette');
    var palOpen = pal && pal.classList.contains('show');

    if (e.key === 'Escape'){
      if (palOpen){ closeCmdPalette(); return; }
      if (_ctxOpen){ hideContextMenu(); return; }
      if (document.body.classList.contains('edit-modal-open')){ closeEditModal(); return; }
      var pv = document.getElementById('imagePreviewModal');
      if (pv && pv.classList.contains('show')){ closeImagePreview(); return; }
      closeTrailer();
      closeAllSheets();
      return;
    }
    if (palOpen){
      if (mod && (e.key === 'k' || e.key === 'K')){ e.preventDefault(); return; }
      return;
    }
    if (mod && (e.key === 'n' || e.key === 'N')){ e.preventDefault(); openCustomEdit(); return; }
    if (mod && (e.key === 'k' || e.key === 'K')){ e.preventDefault(); openCmdPalette(); return; }
    if (mod && (e.key === 's' || e.key === 'S')){
      var ep = document.getElementById('page-edit');
      if (ep && (ep.classList.contains('active') || document.body.classList.contains('edit-modal-open'))){ e.preventDefault(); saveToDisk(); }
      return;
    }
    var pv2 = document.getElementById('imagePreviewModal');
    if (pv2 && pv2.classList.contains('show')){
      if (e.key === 'ArrowLeft'){ e.preventDefault(); previewStep(-1); }
      else if (e.key === 'ArrowRight'){ e.preventDefault(); previewStep(1); }
      else if (e.key === '+' || e.key === '='){ e.preventDefault(); previewZoomBy(0.25); }
      else if (e.key === '-'){ e.preventDefault(); previewZoomBy(-0.25); }
      return;
    }
    var home = document.getElementById('page-home');
    if (!typing && home && home.classList.contains('active')){
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){ e.preventDefault(); libMoveFocus(e.key === 'ArrowDown' ? 1 : -1); return; }
      if (e.key === 'Enter'){ e.preventDefault(); libActivate(false); return; }
      if (mod && e.key === 'Enter'){ e.preventDefault(); libActivate(true); return; }
      if (e.key === 'Delete' || e.key === 'Backspace'){ e.preventDefault(); libDeleteFocused(); return; }
    }
    if (!typing && e.key === '/'){
      e.preventDefault();
      goLibrary();
      var q2 = document.getElementById('libSearch');
      if (q2){ q2.focus(); q2.select(); }
    }
  });
}

/* ===================================================================
   启动
   =================================================================== */
function bootApp(){
  /* 侧栏已移除，无需恢复展开状态 */
  initNativeSelects();
  populateSettingSelects();
  renderThemeGrid();
  initDetailScroll();
  initPreviewMouse();
  initCropMouse();
  initDragDrop();
  initSidebarNav();
  initKeyboard();
  initFormDirty();

  Promise.all([
    getTMDBKey().then(function(k){ state.apiKey = k || ''; }).catch(function(){}),
    getThemeColor().then(function(c){ if (c) applyThemeColor(c, false); }).catch(function(){}),
    getAutoClearMode().then(function(m){
      state.autoClear = m || 'never';
      updateAutoClearDisplay();
      clearExpiredFilms();
    }).catch(function(){}),
    getAppearance().then(function(m){
      state.appearance = (m === 'dark' || m === 'light' || m === 'auto') ? m : 'auto';
      updateAppearanceDisplay();
      applyAppearance(state.appearance);
    }).catch(function(){}),
    getMagnetConfig().then(function(cfg){ if (cfg && cfg.worker) state.magnetWorker = cfg.worker; }).catch(function(){}),
    getTier().then(function(t){ state.tier = t || ''; }).catch(function(){}),
    getActivationCode().then(function(c){ state.activationCode = c || ''; updateActivationStatus(); }).catch(function(){}),
    getAdultLoadingPhrases().then(function(list){ currentAdultPhrases = list || []; }).catch(function(){}),
    idbGet('kv', 'libView').then(function(v){ if (v === 'grid' || v === 'list') state._libView = v; }).catch(function(){}),
    getThemeHidden().then(function(h){
      state.themeHidden = !!h;
      var p = Promise.resolve();
      if (!state.themeHidden){
        state.metaSource = 'tmdb'; state.overviewTab = 'movie';
      } else {
        // 里模式：恢复上次停留的影片/XV 标签与数据源，避免刷新后回退到默认影片/TMDB
        p = Promise.all([ idbGet('kv', 'overviewTab'), idbGet('kv', 'metaSource') ]).then(function(r){
          if (r[0] === 'xv' || r[0] === 'movie') state.overviewTab = r[0];
          if (r[1] === 'tmdb' || r[1] === 'jav' || r[1] === 'tpdb') state.metaSource = r[1];
          var seg = document.getElementById('overviewTabs');
          if (seg){
            var bs = seg.querySelectorAll('button');
            for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('active', bs[i].getAttribute('data-tab') === state.overviewTab);
          }
        });
      }
      return p.then(function(){
        syncThemeHiddenSwitch();
        updateOverviewTabVisibility();
        applyEditMode();
        syncSearchSourceUI();
        syncLibSearchUI();
        updateSearchPlaceholder();
        syncAdultPhraseRow();
        var lv = document.querySelectorAll('#libViewGroup .btn');
        for (var i = 0; i < lv.length; i++) lv[i].classList.toggle('active', lv[i].getAttribute('data-view') === (state._libView || 'grid'));
      });
    }).catch(function(){})
  ]).then(function(){
    return loadPresets().catch(function(){});
  }).then(function(){
    renderCountryChips();
    renderGenreChips();
    return renderOverview();
  }).then(function(){
    renderCast();
    updateState();
    updateSubtitleBtn();
    switchPage('home');
    switchHomeTab('basic');
    checkFilmCap(900);
  }).catch(function(err){
    if (window.console && console.error) console.error('启动失败', err);
    showToast('初始化出错，部分功能可能不可用', 'error');
  });
}

/* ===================================================================
   批选 / 命令面板 / 键盘导航（Stage 3 交互增强）
   =================================================================== */
var CMD_ICONS = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  theme: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 8l5-5 5 5M12 3v12"/></svg>',
  sidebar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 8.6a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>',
  restore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  film: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4M7 12h10"/></svg>'
};

var _selMode = false;
var _selSet = {};
var _libFocusIdx = -1;
var _cmdItems = [];
var _cmdActive = 0;

/* ---------- 批量选择 ---------- */
function _currentLibNodes(){
  var grid = document.getElementById('overviewGrid');
  if (grid && !grid.classList.contains('hidden')) return Array.prototype.slice.call(grid.querySelectorAll('.poster-card'));
  var list = document.getElementById('overviewList');
  if (list && !list.classList.contains('hidden')) return Array.prototype.slice.call(list.querySelectorAll('.list-row'));
  return [];
}
function _selCheckSvg(){
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
}
function toggleSelectMode(){
  _selMode = !_selMode;
  var grid = document.getElementById('overviewGrid');
  var list = document.getElementById('overviewList');
  var bar = document.getElementById('libBatchBar');
  var btn = document.getElementById('libSelectBtn');
  if (_selMode){
    if (grid) grid.classList.add('select-mode');
    if (list) list.classList.add('select-mode');
    _syncSelectUI();
    if (bar) bar.classList.remove('hidden');
    if (btn){ btn.classList.add('btn-primary'); btn.classList.remove('btn-default'); }
  } else {
    if (grid){ grid.classList.remove('select-mode'); Array.prototype.forEach.call(grid.querySelectorAll('.sel-check'), function(e){ e.remove(); }); }
    if (list){ list.classList.remove('select-mode'); Array.prototype.forEach.call(list.querySelectorAll('.sel-check'), function(e){ e.remove(); }); }
    Array.prototype.forEach.call(document.querySelectorAll('.poster-card.selected, .list-row.selected'), function(e){ e.classList.remove('selected'); });
    _selSet = {};
    if (bar) bar.classList.add('hidden');
    if (btn){ btn.classList.remove('btn-primary'); btn.classList.add('btn-default'); }
    _libFocusIdx = -1;
  }
}
function _syncSelectUI(){
  if (!_selMode) return;
  var nodes = _currentLibNodes();
  nodes.forEach(function(n){
    var id = decodeURIComponent(n.getAttribute('data-id'));
    if (!n.querySelector('.sel-check')){
      var c = document.createElement('div');
      c.className = 'sel-check';
      c.innerHTML = _selCheckSvg();
      n.appendChild(c);
    }
    n.classList.toggle('selected', !!_selSet[id]);
  });
  updateSelCount();
}
function toggleSelect(id, node){
  if (!_selMode) return;
  var el = node || (function(){ var ns = _currentLibNodes(); for (var i=0;i<ns.length;i++){ if (decodeURIComponent(ns[i].getAttribute('data-id'))===id) return ns[i]; } return null; })();
  if (_selSet[id]){ delete _selSet[id]; if (el) el.classList.remove('selected'); }
  else { _selSet[id] = true; if (el) el.classList.add('selected'); }
  updateSelCount();
}
function updateSelCount(){
  var el = document.getElementById('libSelCount');
  if (el) el.textContent = '已选 ' + Object.keys(_selSet).length + ' 部';
  var all = document.getElementById('libSelAll');
  if (all){
    var nodes = _currentLibNodes();
    var sel = nodes.filter(function(n){ return n.classList.contains('selected'); }).length;
    all.checked = nodes.length > 0 && sel === nodes.length;
  }
}
function toggleSelectAll(on){
  var nodes = _currentLibNodes();
  _selSet = {};
  nodes.forEach(function(n){
    if (on){ n.classList.add('selected'); _selSet[decodeURIComponent(n.getAttribute('data-id'))] = true; }
    else { n.classList.remove('selected'); }
  });
  updateSelCount();
}
function batchDelete(){
  var ids = Object.keys(_selSet);
  if (!ids.length){ showToast('请先选择影片', 'info'); return; }
  showConfirm({
    title: '批量删除',
    desc: '将删除选中的 ' + ids.length + ' 部影片及其元数据与图片，此操作不可撤销。',
    okText: '删除',
    onOk: function(){
      Promise.all(ids.map(function(id){ return deleteFilm(id); })).then(function(){
        showToast('已删除 ' + ids.length + ' 部', 'success');
        toggleSelectMode();
        renderOverview();
      }).catch(function(){ showToast('部分删除失败', 'error'); renderOverview(); });
    }
  });
}
function batchRefresh(){
  var ids = Object.keys(_selSet);
  if (!ids.length){ showToast('请先选择影片', 'info'); return; }
  showToast('正在刷新 ' + ids.length + ' 部…');
  var done = 0, fail = 0;
  ids.forEach(function(id){
    refreshFilm(id).then(function(){ done++; if (done + fail === ids.length) finish(); }).catch(function(){ fail++; if (done + fail === ids.length) finish(); });
  });
  function finish(){
    showToast('刷新完成（' + done + ' 成功' + (fail ? '，' + fail + ' 失败' : '') + '）', fail ? 'error' : 'success');
    renderOverview();
  }
}
function batchExportNfo(){
  var ids = Object.keys(_selSet);
  if (!ids.length){ showToast('请先选择影片', 'info'); return; }
  if (ids.length === 1){ downloadMetadata(ids[0]); return; }
  showToast('正在打包 ' + ids.length + ' 部…');
  Promise.all(ids.map(function(id){ return loadFilm(id); })).then(function(films){
    var zipFiles = [], used = {};
    films.forEach(function(film){
      if (!film) return;
      var d = film.data || {};
      var base = sanitizeName(d.filename || d.title || film.title || film.id || 'movie');
      if (used[base]) base = base + '_' + film.id;
      used[base] = true;
      zipFiles.push({ name: base + '.nfo', data: new TextEncoder().encode(buildNFOMovieXml(d)) });
      if (typeof d.poster === 'string'){ var pb = dataUrlToBytesSync(d.poster); if (pb) zipFiles.push({ name: base + '-poster.jpg', data: pb }); }
      if (typeof d.fanart === 'string'){ var fb = dataUrlToBytesSync(d.fanart); if (fb) zipFiles.push({ name: base + '-fanart.jpg', data: fb }); }
      if (typeof d.logo === 'string'){ var lb = dataUrlToBytesSync(d.logo); if (lb) zipFiles.push({ name: base + '-clearlogo.png', data: lb }); }
    });
    if (!zipFiles.length) return showToast('没有可导出的元数据', 'error');
    var zipBlob = new Blob([makeZip(zipFiles)], { type: 'application/zip' });
    directDownload(zipBlob, 'nfo-export-' + ids.length + '.zip');
  }).catch(function(){ showToast('导出失败', 'error'); });
}

/* ---------- 命令面板 ---------- */
function openCmdPalette(){
  var p = document.getElementById('cmdPalette');
  var m = document.getElementById('cmdMask');
  if (!p) return;
  if (m) m.classList.add('show');
  p.classList.add('show');
  renderCmdResults('');
  var inp = document.getElementById('cmdInput');
  if (inp){ inp.value = ''; setTimeout(function(){ inp.focus(); }, 20); }
}
function closeCmdPalette(){
  var p = document.getElementById('cmdPalette');
  var m = document.getElementById('cmdMask');
  if (p) p.classList.remove('show');
  if (m) m.classList.remove('show');
}
function _cmdStaticActions(q){
  var acts = [
    { icon: 'plus', label: '新建影片', hint: '⌘N', run: function(){ closeCmdPalette(); openCustomEdit(); } },
    { icon: 'search', label: '搜索媒体库', run: function(){ closeCmdPalette(); goLibrary(); var q = document.getElementById('libSearch'); if (q){ q.focus(); q.select(); } } },
    { icon: 'theme', label: '切换外观（浅色 / 深色 / 自动）', run: function(){ closeCmdPalette(); cycleAppearance(); } },
    { icon: 'upload', label: '导入 NFO', run: function(){ closeCmdPalette(); var i = document.getElementById('nfoImport'); if (i) i.click(); } },
    { icon: 'settings', label: '打开设置', run: function(){ closeCmdPalette(); toggleSettingsMenu(); } },
    { icon: 'restore', label: '恢复初始状态', run: function(){ closeCmdPalette(); showRestoreConfirm(); } }
  ];
  q = (q || '').trim().toLowerCase();
  if (!q) return acts;
  return acts.filter(function(a){ return a.label.toLowerCase().indexOf(q) >= 0; });
}
function renderCmdResults(q){
  var list = document.getElementById('cmdList');
  if (!list) return;
  q = (q || '').trim();
  _cmdItems = [];
  listFilms().then(function(films){
    if (!state.themeHidden) films = films.filter(function(f){ return !f.adult; });
    var ql = q.toLowerCase();
    var acts = _cmdStaticActions(q);
    var html = '';
    if (acts.length){
      html += '<div class="cmd-section">命令</div>';
      acts.forEach(function(a){
        _cmdItems.push(a);
        html += '<div class="cmd-item" data-i="' + (_cmdItems.length - 1) + '">'
              + (a.icon ? '<span class="ci-icon">' + CMD_ICONS[a.icon] + '</span>' : '')
              + '<span class="ci-label">' + escapeHtml(a.label) + '</span>'
              + (a.hint ? '<span class="ci-hint">' + a.hint + '</span>' : '') + '</div>';
      });
    }
    if (ql){
      var matches = films.filter(function(f){
        var hay = [f.title, f.id, (f.data && f.data.dvdId), (f.data && f.data.originaltitle)].join(' ').toLowerCase();
        return hay.indexOf(ql) >= 0;
      }).slice(0, 8);
      if (matches.length){
        html += '<div class="cmd-section">影片</div>';
        matches.forEach(function(f){
          var enc = encodeURIComponent(f.id);
          var title = (f.adult && f.data && f.data.dvdId) ? String(f.data.dvdId).toUpperCase() : (f.title || f.id);
          var sub = [f.year, f.runtime ? (f.runtime + ' 分钟') : ''].filter(Boolean).join(' · ');
          var thumb = f.posterDataUrl ? '<img class="ci-thumb" src="' + escapeAttr(f.posterDataUrl) + '">' : '<span class="ci-icon">' + CMD_ICONS.film + '</span>';
          _cmdItems.push({ run: function(){ closeCmdPalette(); openFilmDetail(enc); } });
          html += '<div class="cmd-item" data-i="' + (_cmdItems.length - 1) + '">' + thumb
                + '<span class="ci-label">' + escapeHtml(title) + '</span>'
                + (sub ? '<span class="ci-sub">' + escapeHtml(sub) + '</span>' : '') + '</div>';
        });
      }
    }
    if (!_cmdItems.length) html = '<div class="cmd-empty">没有匹配结果</div>';
    list.innerHTML = html;
    bindCmdItems();
    _cmdActivate(0);
  }).catch(function(){ list.innerHTML = '<div class="cmd-empty">没有匹配结果</div>'; });
}
function bindCmdItems(){
  var items = document.querySelectorAll('#cmdList .cmd-item');
  Array.prototype.forEach.call(items, function(el){
    var i = +el.getAttribute('data-i');
    el.addEventListener('click', function(){ if (_cmdItems[i]) _cmdItems[i].run(); });
    el.addEventListener('mousemove', function(){ _cmdActivate(i); });
  });
}
function _cmdActivate(i){
  var items = document.querySelectorAll('#cmdList .cmd-item');
  if (!items.length) return;
  if (i < 0) i = 0;
  if (i >= items.length) i = items.length - 1;
  _cmdActive = i;
  Array.prototype.forEach.call(items, function(el, idx){ el.classList.toggle('active', idx === i); });
  var active = items[i];
  if (active && active.scrollIntoView){ try { active.scrollIntoView({ block: 'nearest' }); } catch (e) {} }
}
function cmdInputKey(e){
  if (e.key === 'ArrowDown'){ e.preventDefault(); _cmdActivate(_cmdActive + 1); }
  else if (e.key === 'ArrowUp'){ e.preventDefault(); _cmdActivate(_cmdActive - 1); }
  else if (e.key === 'Enter'){ e.preventDefault(); if (_cmdItems[_cmdActive]) _cmdItems[_cmdActive].run(); }
  else if (e.key === 'Escape'){ e.preventDefault(); closeCmdPalette(); }
}
function cycleAppearance(){
  var order = ['light', 'dark', 'auto'];
  var cur = state.appearance || 'auto';
  var next = order[(order.indexOf(cur) + 1) % order.length];
  setAppearance(next);
  var label = { light: '浅色', dark: '深色', auto: '跟随系统' }[next];
  showToast('外观：' + label, 'success');
}

/* ---------- 库键盘导航 ---------- */
function _libFocusNodes(){
  var grid = document.getElementById('overviewGrid');
  if (grid && !grid.classList.contains('hidden')) return Array.prototype.slice.call(grid.querySelectorAll('.poster-card'));
  var list = document.getElementById('overviewList');
  if (list && !list.classList.contains('hidden')) return Array.prototype.slice.call(list.querySelectorAll('.list-row'));
  return [];
}
function libMoveFocus(dir){
  var nodes = _libFocusNodes();
  if (!nodes.length) return;
  if (_libFocusIdx < 0) _libFocusIdx = (dir > 0) ? 0 : (nodes.length - 1);
  else _libFocusIdx = Math.max(0, Math.min(nodes.length - 1, _libFocusIdx + dir));
  nodes.forEach(function(n, i){ n.classList.toggle('kb-focus', i === _libFocusIdx); });
  var cur = nodes[_libFocusIdx];
  if (cur && cur.scrollIntoView){ try { cur.scrollIntoView({ block: 'nearest' }); } catch (e) {} }
}
function libActivate(edit){
  var nodes = _libFocusNodes();
  if (_libFocusIdx < 0 || _libFocusIdx >= nodes.length) return;
  var enc = nodes[_libFocusIdx].getAttribute('data-id');
  if (edit){ newFilm(); openFilm(enc); }
  else { openFilmDetail(enc); }
}
function libDeleteFocused(){
  var nodes = _libFocusNodes();
  if (_libFocusIdx < 0 || _libFocusIdx >= nodes.length) return;
  var id = decodeURIComponent(nodes[_libFocusIdx].getAttribute('data-id'));
  confirmDeleteFilm(id);
}

/* PWA：Service Worker（仅 HTTPS / localhost） */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')){
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('./sw.js').catch(function(){});
  });
}

