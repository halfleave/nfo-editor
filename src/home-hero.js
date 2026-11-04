/* ===== v452 首页改版：海报焦点 + 分类横滑 =====
   结构（原型 prototype/home-v2.html 落地）：
     焦点区  —— 最多 8 部随机，整幅海报作底图；底部信息依次是「地区行（居中）/ 片名（居中）/
              简介（3 行，左对齐）/ 平台评分（居中）」，可左右滑动，页码点可点。
     三排横滑 —— 电影 / 剧集 / 动漫（动画类剧集），按添加顺序（新的在前）。
     全部     —— 某类超过 15 部才在排头出现入口，点了进二级页 #page-all（不是弹窗）。
   背景：取当前海报的综合色铺满整页（浅/深色模式都不影响），海报底部用同色渐变衔接，不留分割线。
   依赖 ui-ios.js 的全局：state / listFilms / escapeHtml / escapeAttr / NfoCore / idbGet / idbPut /
   DEFAULT_WORKER / detailRatingsHtml / DETAIL_RATINGS_TTL / avCoverMaskHtml / bindOverviewLongPress。 */
(function(){
  'use strict';

  var HERO_MAX = 8;          // 焦点区最多 8 部
  var ALL_THRESHOLD = 15;    // 某类超过这个数量才给「全部」入口
  var ANIME_GAP_NAMES = ['动画', '動畫', 'アニメ', 'animation', 'anime'];

  var heroFilms = [];        // 本次焦点区选中的影片
  var heroSig = '';          // 选中集合签名：数据没变就不重洗，避免每次渲染都跳
  var heroIdx = 0;
  var allKind = '';          // 「全部」二级页当前在看哪一类
  var allTitle = '';         // 以及它的标题（刷新时沿用）
  var ambById = {};          // 影片 id → [h,s,l]
  var scoreTried = {};       // 评分请求去重（会话内）
  var ambCanvas = document.createElement('canvas');
  ambCanvas.width = 24; ambCanvas.height = 36;

  function d(id){ return document.getElementById(id); }
  function dataOf(f){ return (f && f.data) || {}; }
  function isTvFilm(f){ var x = dataOf(f); return !!(x.tmdbMediaType === 'tv' && !(x.dvdId || x.content_id)); }
  function isAnimeFilm(f){
    if (!isTvFilm(f)) return false;
    var g = dataOf(f).genres || [];
    for (var i = 0; i < g.length; i++){
      var n = String(g[i] || '').trim().toLowerCase();
      if (ANIME_GAP_NAMES.indexOf(n) >= 0) return true;
    }
    var tid = String(dataOf(f).tmdbId || '');
    try { if (tid && window._animeProbe && _animeProbe['tv:' + tid] === true) return true; } catch (e) {}
    return false;
  }
  function kindOf(f){
    if (NfoCore.isAvFilm(f)) return 'xv';
    if (!isTvFilm(f)) return 'movie';
    return isAnimeFilm(f) ? 'anime' : 'tv';
  }
  function titleOf(f){
    var x = dataOf(f);
    var t = f.title || x.title || x.originaltitle || f.id;
    if (NfoCore.isAvFilm(f) && x.dvdId) t = String(x.dvdId).toUpperCase();
    return String(t || '');
  }
  function yearOf(f){
    var x = dataOf(f);
    return String(x.year || (x.premiered || '').slice(0, 4) || '').trim();
  }
  function posterOf(f){
    var x = dataOf(f);
    return x.poster || f.posterDataUrl || '';
  }
  function addedAt(f){ return (f.createdAt || f.updatedAt || 0); }
  function placeOf(f){
    var c = dataOf(f).countries || [];
    return c.length ? String(c[0]) : '';
  }
  function genresOf(f){
    var g = dataOf(f).genres || [];
    return g.slice(0, 3).join(', ');
  }

  /* ================= 海报综合色 ================= */
  function rgb2hsl(r, g, b){
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    var l = (mx + mn) / 2, h = 0, s = 0;
    if (mx !== mn){
      var dd = mx - mn;
      s = l > .5 ? dd / (2 - mx - mn) : dd / (mx + mn);
      if (mx === r) h = (g - b) / dd + (g < b ? 6 : 0);
      else if (mx === g) h = (b - r) / dd + 2;
      else h = (r - g) / dd + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  /* 取主色：按色相分 24 桶，用「饱和度 × 中间调权重」加权，取最重的桶再回算平均色。
     明度压到 18%~30% —— 这块颜色要当整页底色用，压得够暗白字才稳。 */
  function extractAmbient(img){
    try {
      var ctx = ambCanvas.getContext('2d', { willReadFrequently: true });
      ctx.clearRect(0, 0, ambCanvas.width, ambCanvas.height);
      ctx.drawImage(img, 0, 0, ambCanvas.width, ambCanvas.height);
      var px = ctx.getImageData(0, 0, ambCanvas.width, ambCanvas.height).data;
      var buckets = {}, best = null;
      for (var i = 0; i < px.length; i += 4){
        if (px[i + 3] < 128) continue;
        var hsl = rgb2hsl(px[i], px[i + 1], px[i + 2]);
        var l = hsl[2], s = hsl[1];
        if (l < 0.07 || l > 0.95) continue;
        var mid = Math.max(1 - Math.abs(l - 0.5) * 1.2, 0.08);
        var w = (0.25 + s) * mid;
        var k = Math.round(hsl[0] / 15) % 24;
        var b = buckets[k] || (buckets[k] = { w: 0, r: 0, g: 0, b: 0 });
        b.w += w; b.r += px[i] * w; b.g += px[i + 1] * w; b.b += px[i + 2] * w;
        if (!best || b.w > best.w) best = b;
      }
      if (!best || !best.w) return null;
      var out = rgb2hsl(best.r / best.w, best.g / best.w, best.b / best.w);
      return [
        Math.round(out[0]),
        Math.round(Math.min(0.55, Math.max(0.20, out[1] * 1.1)) * 100),
        Math.round(Math.min(0.30, Math.max(0.18, out[2])) * 100)
      ];
    } catch (e) {
      return null;      // 画布被污染（跨域图没带 CORS 头）→ 退回中性色
    }
  }
  function ambientOfUrl(url){
    return new Promise(function(resolve){
      if (!url){ resolve(null); return; }
      var img = new Image();
      var done = false;
      var fin = function(v){ if (!done){ done = true; resolve(v); } };
      img.crossOrigin = 'anonymous';
      img.onload = function(){ fin(extractAmbient(img)); };
      img.onerror = function(){ fin(null); };
      setTimeout(function(){ fin(null); }, 6000);
      img.src = url;
    });
  }
  function applyAmbient(hsl){
    var page = d('page-home');
    if (!page) return;
    var c = hsl || [215, 14, 20];
    page.style.setProperty('--home-h', c[0]);
    page.style.setProperty('--home-s', c[1] + '%');
    page.style.setProperty('--home-l', c[2] + '%');
  }

  /* ================= 焦点区 ================= */
  function heroInfoHtml(f){
    var x = dataOf(f);
    var score = String(f.rating || x.rating || '').trim();
    var bits = [];
    if (score) bits.push('<span class="hi-star">★</span><span class="hi-score">' + escapeHtml(score) + '</span>');
    var y = yearOf(f), pl = placeOf(f), gg = genresOf(f);
    if (y) bits.push('<span>' + escapeHtml(y) + '</span>');
    if (pl) bits.push('<span>' + escapeHtml(pl) + '</span>');
    if (gg) bits.push('<span>' + escapeHtml(gg) + '</span>');
    var meta = bits.length > 1 ? bits.join('<span class="hi-sep">｜</span>') : bits.join('');

    var avMask = !!state.avCoverMask && NfoCore.isAvFilm(f);
    var poster = posterOf(f);
    var media = avMask
      ? '<div class="hero-mask">' + avCoverMaskHtml((x.dvdId || titleOf(f))) + '</div>'
      : (poster
          ? '<img src="' + escapeAttr(poster) + '" alt="" draggable="false" onerror="this.style.display=\'none\'">'
          : '');

    /* 影片 logo（TMDB 的透明标题图，详情页同一个字段 d.logo）放在地区行上方；没有就不占位 */
    var logo = String(x.logo || '').trim();
    var logoHtml = logo
      ? '<div class="hero-logo"><img src="' + escapeAttr(logo) + '" alt="' + escapeAttr(titleOf(f)) + '" draggable="false" onerror="this.parentNode.style.display=\'none\'"></div>'
      : '';

    return '<div class="hero-slide">' + media
      + '<div class="hero-info">'
      +   logoHtml
      +   '<div class="hero-meta">' + meta + '</div>'
      /* v452：片名不再单独一行，改成【片名】直接接在简介前面，整段最多 3 行 */
      +   '<p class="hero-plot"><b class="hero-ttl">【' + escapeHtml(titleOf(f)) + '】</b>' + escapeHtml(String(x.plot || '').trim() || '暂无简介') + '</p>'
      +   '<div class="hero-rate detail-ratings" data-fid="' + escapeAttr(f.id) + '"></div>'
      + '</div></div>';
  }

  function pickHero(pool){
    /* 签名只看「有哪些片子」：数据更新（翻译补全、评分回写）不该把焦点区重新洗一遍 */
    var sig = pool.map(function(f){ return f.id; }).sort().join('|');
    if (sig === heroSig && heroFilms.length){
      var alive = {};
      pool.forEach(function(f){ alive[f.id] = 1; });
      heroFilms = heroFilms.filter(function(f){ return alive[f.id]; });
      if (heroFilms.length) return heroFilms;
    }
    heroSig = sig;
    var arr = pool.slice();
    for (var i = arr.length - 1; i > 0; i--){                  // 每次随机 8 部
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    heroFilms = arr.slice(0, Math.min(HERO_MAX, arr.length));
    heroIdx = 0;
    return heroFilms;
  }

  function renderHero(pool, mode){
    var hero = d('homeHero'), track = d('heroTrack'), dots = d('heroDots');
    if (!hero || !track) return;
    var list = pickHero(pool);
    if (!list.length){
      /* 空态直接写在焦点区里（外面不再放第二块提示，避免两句话叠着说） */
      var t1 = mode === 'xv' ? '还没有 XV 影片' : '还没有影片';
      var t2 = mode === 'xv' ? '在里模式下添加后会出现在这里' : '从「搜索」添加后会出现在这里';
      track.innerHTML = '<div class="hero-slide no-shade"><div class="hero-empty"><b>' + t1 + '</b><span>' + t2 + '</span></div></div>';
      track.style.transform = 'translate3d(0,0,0)';
      if (dots) dots.innerHTML = '';
      applyAmbient(null);
      return;
    }
    if (heroIdx >= list.length) heroIdx = 0;
    track.innerHTML = list.map(heroInfoHtml).join('');
    if (dots) dots.innerHTML = list.map(function(_, i){ return '<i data-i="' + i + '"' + (i === heroIdx ? ' class="on"' : '') + '></i>'; }).join('');
    track.style.transform = 'translate3d(' + (-heroIdx * 100) + '%,0,0)';
    track.classList.remove('dragging');
    applyIdx(heroIdx);
  }

  function applyIdx(i){
    var f = heroFilms[i];
    if (!f) return;
    var id = f.id;
    if (ambById[id]) applyAmbient(ambById[id]);
    else ambientOfUrl(posterOf(f)).then(function(c){ ambById[id] = c; if (heroFilms[heroIdx] && heroFilms[heroIdx].id === id) applyAmbient(c); });
    var track = d('heroTrack');
    var rateEl = track ? track.querySelectorAll('.hero-rate')[i] : null;
    if (rateEl) loadScores(f, rateEl);
  }

  function go(i){
    var n = heroFilms.length;
    if (!n) return;
    heroIdx = ((i % n) + n) % n;
    var track = d('heroTrack'), dots = d('heroDots');
    if (track) track.style.transform = 'translate3d(' + (-heroIdx * 100) + '%,0,0)';
    if (dots) Array.prototype.forEach.call(dots.children, function(el, k){ el.classList.toggle('on', k === heroIdx); });
    applyIdx(heroIdx);
  }

  /* ================= 平台评分（懒加载：滑到哪部取哪部，缓存 30 天） ================= */
  function loadScores(f, el){
    if ((state.tier || '') !== 'full') return;
    var x = dataOf(f);
    if (String(x.dvdId || x.content_id || '').trim()) return;      // 番号片没有 IMDb
    var tmdbId = /^\d+$/.test(String(x.tmdbId || '')) ? String(x.tmdbId) : '';
    var rawTitle = String(x.originaltitle || x.title || f.title || '').trim();
    if (!tmdbId && !rawTitle) return;
    var type = isTvFilm(f) ? 'tv' : 'movie';
    var year = yearOf(f);
    var key = 'detailRatings:' + f.id + ':' + (tmdbId || (rawTitle + '|' + year));
    var stillHere = function(){ return el.isConnected && el.getAttribute('data-fid') === f.id; };

    idbGet('kv', key).then(function(v){
      if (v && v.data && (Date.now() - (v.ts || 0)) < DETAIL_RATINGS_TTL){
        var html = detailRatingsHtml(v.data);
        if (html && stillHere()) el.innerHTML = html;
        return true;
      }
      return false;
    }).catch(function(){ return false; }).then(function(hit){
      if (hit || scoreTried[key]) return;
      var w = state.magnetWorker || DEFAULT_WORKER;
      if (!w) return;
      scoreTried[key] = 1;
      var url = w.replace(/\/$/, '') + '/scores?type=' + type
        + (tmdbId ? '&tmdb=' + encodeURIComponent(tmdbId) : '')
        + '&title=' + encodeURIComponent(rawTitle)
        + '&year=' + encodeURIComponent(year)
        + (state.activationCode ? '&code=' + encodeURIComponent(state.activationCode) : '');
      fetch(url, { cache: 'no-store' }).then(function(r){ return r.json().catch(function(){ return null; }); })
        .then(function(data){
          if (!data || !data.ok) return;
          var html = detailRatingsHtml(data);
          if (!html) return;
          if (stillHere()) el.innerHTML = html;
          var s = data.sources || {};
          if (s.imdb || s.rottenTomatoes || s.metacritic){
            idbPut('kv', key, { ts: Date.now(), data: data }).catch(function(){});
          }
        }).catch(function(){ scoreTried[key] = 0; });
    });
  }

  /* ================= 三排横滑 ================= */
  function cardHtml(f){
    var x = dataOf(f);
    var id = encodeURIComponent(f.id);
    var avMask = !!state.avCoverMask && NfoCore.isAvFilm(f);
    var poster = posterOf(f);
    var media = avMask
      ? '<div class="hc-poster av-cover-mask">' + avCoverMaskHtml(x.dvdId || titleOf(f)) + '</div>'
      : '<div class="hc-poster"' + (poster ? ' style="background-image:url(' + escapeAttr(poster) + ')"' : '') + '></div>';
    var y = yearOf(f);
    return '<div class="movie-card-wrap home-card" data-id="' + escapeAttr(id) + '">'
      + media
      + '<div class="hc-title">' + escapeHtml(titleOf(f)) + '</div>'
      + (y ? '<div class="hc-year">' + escapeHtml(y) + '</div>' : '')
      + '</div>';
  }

  var ROW_DEFS = [
    { key: 'movie', title: '电影' },
    { key: 'tv',    title: '剧集' },
    { key: 'anime', title: '动漫' }
  ];

  function renderRows(films){
    var host = d('homeRows');
    if (!host) return;
    var mode = state.overviewTab === 'xv' ? 'xv' : 'movie';
    var defs = mode === 'xv' ? [{ key: 'xv', title: 'XV' }] : ROW_DEFS;
    var html = defs.map(function(def){
      var list = films.filter(function(f){ return kindOf(f) === def.key; });
      if (!list.length) return '';
      var showAll = list.length > ALL_THRESHOLD;
      return '<section class="home-row">'
        + '<div class="home-row-head"><h2>' + def.title + '<em>' + list.length + '</em></h2>'
        + (showAll ? '<button class="home-more" onclick="HomeHero.openAll(\'' + def.key + '\',\'' + def.title + '\')">全部'
            + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg></button>' : '')
        + '</div>'
        + '<div class="home-strip">' + list.map(cardHtml).join('') + '</div>'
        + '</section>';
    }).join('');
    host.innerHTML = html;
    bindOverviewLongPress(0, host);      // 复用首页卡片的长按菜单（编辑/刷新/锁定/删除）
  }

  /* ================= 入口 ================= */
  function syncHead(){
    var btn = d('homeModeBtn');
    var xv = state.overviewTab === 'xv';
    if (btn){
      btn.style.display = state.themeHidden ? '' : 'none';   // 只在里模式给「影片 / XV」切换
      btn.classList.toggle('is-xv', xv);
    }
    var dt = d('homeDate'), hi = d('homeHi');
    if (dt && hi){
      var now = new Date(), h = now.getHours();
      var word = h < 6 ? '凌晨好' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
      var week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];
      dt.textContent = (now.getMonth() + 1) + '月' + now.getDate() + '日 ' + week;
      hi.textContent = word;
    }
  }

  function render(){
    /* v453：这个函数是启动流程的一环（renderOverview 转调过来），
       同步抛错会让启动页永远停住，所以整体兜住，出任何问题都返回一个已完成的 Promise。 */
    try {
      var host = d('homeRows');
      if (!host) return Promise.resolve();
      syncHead();
      if (!state.themeHidden) state.overviewTab = 'movie';      // 普通模式只放非番号影片
      return listFilms().then(function(all){
        var films = (all || []).slice().sort(function(a, b){ return addedAt(b) - addedAt(a); });  // 添加顺序：新的在前
        var mode = state.overviewTab === 'xv' ? 'xv' : 'movie';
        var pool = films.filter(function(f){ return mode === 'xv' ? kindOf(f) === 'xv' : kindOf(f) !== 'xv'; });
        renderHero(pool, mode);
        renderRows(films);
        /* 停在「全部」二级页时（比如在那儿长按删了一部），首页重画顺便把二级页也刷一遍 */
        var allPage = d('page-all');
        if (allPage && allPage.classList.contains('active') && allKind) openAll(allKind, '');
      }).catch(function(){});
    } catch (e) {
      return Promise.resolve();
    }
  }

  function toggleTab(){
    if (!state.themeHidden){ showToast('里模式下才有 XV 列表', 'info'); return; }
    state.overviewTab = state.overviewTab === 'xv' ? 'movie' : 'xv';
    heroSig = '';                 // 换分类要重洗焦点区，不然还停在上一次那几部
    render();
    window.scrollTo(0, 0);
    var sc = d('homeScroll'); if (sc) sc.scrollTop = 0;
  }

  /* ================= 全部（二级页） ================= */
  function openAll(kind, title){
    if (!kind) return;
    allKind = kind;
    if (title) allTitle = title;
    var t = d('allPageTitle'); if (t) t.textContent = allTitle || '全部';
    var grid = d('allGrid');
    if (grid) grid.innerHTML = '<div class="all-loading">加载中…</div>';
    switchPage('all');
    listFilms().then(function(all){
      var films = (all || []).slice().sort(function(a, b){ return addedAt(b) - addedAt(a); });
      var list = films.filter(function(f){ return kindOf(f) === kind; });
      var cnt = d('allPageCount'); if (cnt) cnt.textContent = list.length ? ('共 ' + list.length + ' 部') : '';
      if (!grid) return;
      if (!list.length){ grid.innerHTML = '<div class="all-loading">这里还没有影片</div>'; return; }
      grid.innerHTML = '';
      var i = 0, BATCH = 24;
      (function next(){
        if (i >= list.length) return;
        var slice = list.slice(i, i + BATCH);
        i += slice.length;
        grid.insertAdjacentHTML('beforeend', slice.map(cardHtml).join(''));
        bindOverviewLongPress(0, grid);
        if (i < list.length) requestAnimationFrame(next);
      })();
    }).catch(function(){});
  }
  function backFromAll(){
    switchPage('home');            // 回到首页时 switchPage 内部已经会让首页重画一次
    var sc = d('homeScroll'); if (sc) sc.scrollTop = 0;
  }

  /* ================= 手势：左右滑动（只此一种，不放假箭头按钮） ================= */
  (function bindSwipe(){
    var hero = d('homeHero');
    if (!hero) return;
    var startX = 0, startY = 0, dx = 0, dragging = false, locked = null, w = 0;
    hero.addEventListener('pointerdown', function(e){
      if (!heroFilms.length) return;
      if (e.target.closest('.hero-top')) return;
      startX = e.clientX; startY = e.clientY; dx = 0; dragging = true; locked = null;
      w = hero.clientWidth;
      var track = d('heroTrack');
      if (track) track.classList.add('dragging');
    });
    hero.addEventListener('pointermove', function(e){
      if (!dragging) return;
      var mx = e.clientX - startX, my = e.clientY - startY;
      if (locked === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) locked = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      if (locked !== 'x') return;
      dx = mx;
      var resist = (heroIdx === 0 && dx > 0) || (heroIdx === heroFilms.length - 1 && dx < 0) ? .35 : 1;
      var track = d('heroTrack');
      if (track) track.style.transform = 'translate3d(' + (-heroIdx * w + dx * resist) + 'px,0,0)';
    });
    function end(){
      if (!dragging) return;
      dragging = false;
      var track = d('heroTrack');
      if (track) track.classList.remove('dragging');
      if (locked === 'x' && Math.abs(dx) > Math.min(70, w * .16)) go(heroIdx + (dx < 0 ? 1 : -1));
      else go(heroIdx);
    }
    hero.addEventListener('pointerup', end);
    hero.addEventListener('pointercancel', end);
    hero.addEventListener('pointerleave', end);

    var dots = d('heroDots');
    if (dots) dots.addEventListener('click', function(e){
      var i = e.target && e.target.getAttribute('data-i');
      if (i != null) go(+i);
    });
  })();

  window.HomeHero = {
    render: render,
    syncHead: syncHead,
    toggleTab: toggleTab,
    openAll: openAll,
    backFromAll: backFromAll,
    go: go
  };

  /* 首屏：等 ui-ios 初始化完（state 就绪）再画 */
  window.addEventListener('load', function(){ setTimeout(function(){ if (d('homeRows')) render(); }, 60); });
})();
