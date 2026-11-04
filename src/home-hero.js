/* ===== 首页：海报焦点 + 分类横滑 =====
   结构（原型 prototype/home-v2.html 落地）：
     焦点区  —— 最多 8 部随机（**永远不含 AV**），整幅海报作底图；底部信息依次是「logo 位（有番号显示番号）/
              地区行（居中）/[片名] + 简介（3 行）/ 平台评分（居中）」，可左右滑动，页码点可点。
     横滑列表 —— 电影 / 剧集 / 动漫（动画类剧集）/ AVideo，按添加顺序（新的在前）。
              AVideo 行只在里模式出现，标题右侧的眼镜 = 设置页「隐私封面」开关（直接控封面显隐）。
     全部     —— 某类超过 15 部才在排头出现入口，点了进二级页 #page-all（不是弹窗）。
   背景：取当前海报的综合色铺满整页（浅/深色模式都不影响）。
   滚动：焦点区是 sticky 的，上滑时海报钉住不动、逐渐模糊，横滑列表从它上面滑过去（对齐详情页观感）。
   底色：按影片缓存（内存 + IndexedDB），一进首页就把 8 部全取好；拖动时底色按拖动比例插值，跟手不跳。
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
  var ambById = {};          // 影片 id → { url, hsl }：底色按影片缓存（内存 + IndexedDB），滑到就有色，不再现算
  var ambPending = {};       // 同一部片的取样去重（拖动时会被反复问）
  var curAmb = null;         // 当前铺在页面上的底色 [h,s,l]
  var dragBase = null;       // 本次拖动开始时的底色，插值从它起算
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
    curAmb = c;
    page.style.setProperty('--home-h', c[0]);
    page.style.setProperty('--home-s', c[1] + '%');
    page.style.setProperty('--home-l', c[2] + '%');
  }
  function ambOf(f){
    var hit = f && ambById[f.id];
    return hit && hit.hsl ? hit.hsl : null;
  }
  /* 取一部片的底色：内存 → IndexedDB → 现取样，三级缓存。
     开了预取之后，滑到的那一部基本都已经有色，切换时不会再「先是旧色、半秒后才跳」 */
  function ensureAmb(f){
    var url = posterOf(f);
    if (!url) return Promise.resolve(null);
    var hit = ambById[f.id];
    if (hit && hit.url === url) return Promise.resolve(hit.hsl);
    if (ambPending[f.id]) return ambPending[f.id];
    var key = 'amb:' + f.id;
    var p = idbGet('kv', key).then(function(rec){
      if (rec && rec.url === url && rec.hsl && rec.hsl.length === 3){
        ambById[f.id] = { url: url, hsl: rec.hsl };
        return rec.hsl;
      }
      return null;
    }).catch(function(){ return null; }).then(function(cached){
      if (cached) return cached;
      return ambientOfUrl(url).then(function(hsl){
        if (hsl){
          ambById[f.id] = { url: url, hsl: hsl };
          idbPut('kv', key, { url: url, hsl: hsl }).catch(function(){});
        }
        return hsl;
      });
    });
    ambPending[f.id] = p;
    p.catch(function(){}).then(function(){ delete ambPending[f.id]; });
    return p;
  }
  /* 两个底色之间插值：色相走最短弧，避免红→紫绕一整圈 */
  function lerpHsl(a, b, t){
    if (!a) return b;
    if (!b) return a;
    var d = b[0] - a[0];
    if (d > 180) d -= 360; else if (d < -180) d += 360;
    var h = a[0] + d * t;
    if (h < 0) h += 360; else if (h >= 360) h -= 360;
    return [
      Math.round(h),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t)
    ];
  }

  /* 整屏模糊底图用的是哪张海报（顶栏里已经有一份清晰海报，这里只负责上滑后接管整屏） */
  function setBackdrop(f){
    var page = d('page-home');
    if (!page) return;
    if (!f){ page.style.setProperty('--home-bg-img', 'none'); return; }
    var url = posterOf(f);
    var masked = !!state.avCoverMask && NfoCore.isAvFilm(f);   // 隐私封面下不把海报铺到底图上
    page.style.setProperty('--home-bg-img', (!masked && url) ? 'url("' + url.replace(/"/g, '%22') + '")' : 'none');
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

    /* logo 位：有番号就直接显示番号（番号片本来也没有 TMDB 标题图）；
       没有番号才用 TMDB 的透明标题图（详情页同一个字段 d.logo）；两者都没有就不占位 */
    var code = String(x.dvdId || x.content_id || '').trim();
    var logo = String(x.logo || '').trim();
    var logoHtml = '';
    if (code){
      logoHtml = '<div class="hero-logo"><span class="hero-code">' + escapeHtml(code.toUpperCase()) + '</span></div>';
    } else if (logo){
      logoHtml = '<div class="hero-logo"><img src="' + escapeAttr(logo) + '" alt="' + escapeAttr(titleOf(f)) + '" draggable="false" onerror="this.parentNode.style.display=\'none\'"></div>';
    }

    /* 片名不单独占行：用 [] 包住接在简介前面，整段最多 3 行。
       番号片的 titleOf 本身就是番号，上面 logo 位已经显示过一次了，这里改回真实片名免得重复；
       没有真实片名就干脆不加前缀。 */
    var ttl = titleOf(f);
    if (code && ttl.toUpperCase() === code.toUpperCase()) ttl = String(f.title || x.title || '').trim();
    var ttlHtml = ttl ? '<b class="hero-ttl">[' + escapeHtml(ttl) + ']</b>' : '';

    return '<div class="hero-slide">' + media
      + '<div class="hero-info">'
      +   logoHtml
      +   '<div class="hero-meta">' + meta + '</div>'
      +   '<p class="hero-plot">' + ttlHtml + escapeHtml(String(x.plot || '').trim() || '暂无简介') + '</p>'
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

  function renderHero(pool){
    var hero = d('homeHero'), track = d('heroTrack'), dots = d('heroDots');
    if (!hero || !track) return;
    var list = pickHero(pool);
    if (!list.length){
      /* 空态直接写在焦点区里（外面不再放第二块提示，避免两句话叠着说） */
      track.innerHTML = '<div class="hero-slide no-shade"><div class="hero-empty"><b>还没有影片</b><span>从「搜索」添加后会出现在这里</span></div></div>';
      track.style.transform = 'translate3d(0,0,0)';
      if (dots) dots.innerHTML = '';
      applyAmbient(null);
      setBackdrop(null);
      return;
    }
    if (heroIdx >= list.length) heroIdx = 0;
    track.innerHTML = list.map(heroInfoHtml).join('');
    if (dots) dots.innerHTML = list.map(function(_, i){ return '<i data-i="' + i + '"' + (i === heroIdx ? ' class="on"' : '') + '></i>'; }).join('');
    track.style.transform = 'translate3d(' + (-heroIdx * 100) + '%,0,0)';
    track.classList.remove('dragging');
    applyIdx(heroIdx);
    /* 一进来就把 8 部的底色全取好（内存/IndexedDB 有就秒回）：左右滑到谁都有色可切，
       而不是滑完才现取样、半秒后底色再跳一下 */
    list.forEach(function(f){ if (f.id !== list[heroIdx].id) ensureAmb(f).catch(function(){}); });
  }

  function applyIdx(i){
    var f = heroFilms[i];
    if (!f) return;
    var id = f.id;
    var cached = ambOf(f);
    if (cached) applyAmbient(cached);
    setBackdrop(f);
    ensureAmb(f).then(function(c){
      if (!c) return;
      if (heroFilms[heroIdx] && heroFilms[heroIdx].id === id) applyAmbient(c);
    }).catch(function(){});
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
    { key: 'anime', title: '动漫' },
    { key: 'xv',    title: 'AVideo', av: true }     // 只在里模式出现；标题右侧的眼镜控制封面显隐
  ];

  /* 眼镜按钮：睁眼 = 显示封面，划线眼 = 隐私封面（只露番号）。
     它和设置页「隐私封面」是同一个开关（state.avCoverMask），点这里设置页也会跟着变。 */
  function eyeBtnHtml(masked){
    return '<button class="row-eye' + (masked ? ' masked' : '') + '" onclick="HomeHero.toggleMask()"'
      + ' aria-label="' + (masked ? '显示 AV 封面' : '隐藏 AV 封面') + '">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">'
      + '<path d="M2.2 12S5.9 6 12 6s9.8 6 9.8 6-3.9 6-9.8 6S2.2 12 2.2 12z"/>'
      + '<circle cx="12" cy="12" r="3"/>'
      + '<path class="eye-slash" d="M3.4 20.6L20.6 3.4"/>'
      + '</svg></button>';
  }

  function renderRows(films){
    var host = d('homeRows');
    if (!host) return;
    var masked = !!state.avCoverMask;
    var html = ROW_DEFS.map(function(def){
      if (def.av && !state.themeHidden) return '';     // 普通模式不显示 AV 行（里外隔离照旧）
      var list = films.filter(function(f){ return kindOf(f) === def.key; });
      if (!list.length) return '';
      var showAll = list.length > ALL_THRESHOLD;
      return '<section class="home-row">'
        + '<div class="home-row-head"><h2>' + def.title
        + (def.av ? eyeBtnHtml(masked) : '')
        + '<em>' + list.length + '</em></h2>'
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
      return listFilms().then(function(all){
        var films = (all || []).slice().sort(function(a, b){ return addedAt(b) - addedAt(a); });  // 添加顺序：新的在前
        /* 焦点区永远不读取 AV 影片（AV 只在下面那排里出现，且要里模式） */
        var pool = films.filter(function(f){ return kindOf(f) !== 'xv'; });
        renderHero(pool);
        renderRows(films);
        syncScrollState();      // 重画后把模糊/遮罩状态按当前滚动位置拉正（回到首页时一般是 0）
        /* 停在「全部」二级页时（比如在那儿长按删了一部），首页重画顺便把二级页也刷一遍 */
        var allPage = d('page-all');
        if (allPage && allPage.classList.contains('active') && allKind) openAll(allKind, '');
      }).catch(function(){});
    } catch (e) {
      return Promise.resolve();
    }
  }

  /* 首页 AV 行标题右侧的眼镜：和设置页「隐私封面」同一个开关 */
  function toggleMask(){
    var v = !state.avCoverMask;
    if (typeof setAvCoverMask === 'function'){
      setAvCoverMask(v);          // 内部会同步设置页开关、持久化、并重画首页
      return;
    }
    state.avCoverMask = v;
    idbPut('kv', 'avCoverMask', v).catch(function(){});
    render();
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

  /* ================= 滚动：底图钉住不动、随上滑逐渐模糊（对齐详情页的观感） =================
     焦点区是 sticky 的（CSS），内容从它上面滑过去；这里按滚动进度推四个变量：
       --home-bg    整屏模糊底图的显影（0 → 1，与清晰海报交叉淡入）
       --home-blur  底图模糊半径
       --home-veil  底图上那层自身底色的浓度（模糊后仍要有对比，字/卡片才看清）
       --home-fade  焦点区文字（日期胶囊 / logo / 简介 / 评分 / 页码点）的透明度
     只改 CSS 变量、只碰一个节点，不触发重排，滚动才不卡。 */
  function syncScrollState(){
    var sc = d('homeScroll'), hero = d('homeHero'), page = d('page-home');
    if (!sc || !hero || !page) return;
    var h = hero.offsetHeight || 1;
    var t = sc.scrollTop / (h * .55);
    if (t < 0) t = 0; else if (t > 1) t = 1;
    page.style.setProperty('--home-bg', Math.min(t * 1.6, 1).toFixed(3));
    page.style.setProperty('--home-blur', (t * 22).toFixed(1) + 'px');
    page.style.setProperty('--home-blur-n', t.toFixed(3));
    page.style.setProperty('--home-veil', (t * .55).toFixed(3));
    page.style.setProperty('--home-fade', Math.max(1 - t * 3.2, 0).toFixed(3));
  }
  (function bindScroll(){
    var sc = d('homeScroll');
    if (!sc) return;
    var ticking = false;
    sc.addEventListener('scroll', function(){
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function(){ ticking = false; syncScrollState(); });
    }, { passive: true });
    syncScrollState();
  })();

  /* ================= 手势：左右滑动 + 轻点进详情（不放假箭头按钮） =================
     一次触摸要么是「滑」要么是「点」，不能既滑又点：
       · 位移超过 8px 就锁定方向，锁定过（横向或纵向）就不是点击；
       · 松手时再核一次滚动位置，上滑滚动的惯性/位移不会被当成点击；
       · 页码点、顶部日期胶囊自己处理点击，不参与（否则会和详情跳转打架）。 */
  (function bindSwipe(){
    var hero = d('homeHero');
    if (!hero) return;
    var startX = 0, startY = 0, dx = 0, dragging = false, locked = null, w = 0;
    var startT = 0, startTop = 0;
    hero.addEventListener('pointerdown', function(e){
      if (!heroFilms.length) return;
      if (e.target.closest('.hero-top') || e.target.closest('.hero-dots')) return;
      startX = e.clientX; startY = e.clientY; dx = 0; dragging = true; locked = null;
      startT = Date.now();
      var sc = d('homeScroll');
      startTop = sc ? sc.scrollTop : 0;
      w = hero.clientWidth;
      dragBase = curAmb ? curAmb.slice() : null;
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
      /* 底色跟着手指走：按拖过去的比例，在当前片与相邻片的底色之间插值。
         这一段必须关掉 CSS 过渡（.amb-live），否则 .55s 缓动会拖在手指后面，看着一卡一卡的 */
      var frac = -(dx * resist) / (w || 1);
      var nextAmb = ambOf(heroFilms[heroIdx + (frac > 0 ? 1 : -1)]);
      if (dragBase && nextAmb){
        var page = d('page-home');
        if (page) page.classList.add('amb-live');
        applyAmbient(lerpHsl(dragBase, nextAmb, Math.min(Math.abs(frac), 1)));
      }
    });
    function end(allowTap){
      if (!dragging) return;
      dragging = false;
      var track = d('heroTrack');
      if (track) track.classList.remove('dragging');
      var page = d('page-home');
      if (page) page.classList.remove('amb-live');    // 先恢复过渡再落位，颜色收尾才不硬跳
      if (locked === 'x' && Math.abs(dx) > Math.min(70, w * .16)) go(heroIdx + (dx < 0 ? 1 : -1));
      else go(heroIdx);

      /* 点击进详情：没锁过方向（没左右滑也没上下滑）、按得不久、页面没被滚走 */
      if (!allowTap || locked) return;
      if (Date.now() - startT > 900) return;
      var sc = d('homeScroll');
      if (sc && Math.abs(sc.scrollTop - startTop) > 2) return;
      var f = heroFilms[heroIdx];
      if (!f || typeof openFilmDetail !== 'function') return;
      openFilmDetail(encodeURIComponent(f.id));
    }
    hero.addEventListener('pointerup', function(){ end(true); });
    hero.addEventListener('pointercancel', function(){ end(false); });
    hero.addEventListener('pointerleave', function(){ end(false); });

    var dots = d('heroDots');
    if (dots) dots.addEventListener('click', function(e){
      var i = e.target && e.target.getAttribute('data-i');
      if (i != null) go(+i);
    });
  })();

  window.HomeHero = {
    render: render,
    syncHead: syncHead,
    syncScroll: syncScrollState,
    toggleMask: toggleMask,
    openAll: openAll,
    backFromAll: backFromAll,
    go: go
  };

  /* 首屏：等 ui-ios 初始化完（state 就绪）再画 */
  window.addEventListener('load', function(){ setTimeout(function(){ if (d('homeRows')) render(); }, 60); });
})();
