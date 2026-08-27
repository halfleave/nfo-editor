/* nfo-editor-ios Service Worker —— 离线缓存应用壳 + TMDB 海报
 * 策略：
 *  - 磁力代理（*.workers.dev）：始终走网络、不缓存，保证每次都打到最新 Worker
 *  - 同源（nfo-editor-ios.html 等应用壳）：网络优先，离线回退缓存（支持离线打开）
 *  - 跨域图片（image.tmdb.org 等海报）：缓存优先，离线可见已加载过的图
 *  - 其余（TMDB API 等）：走网络，不缓存
 * 注意：2026-08-12 升 v2，2026-08-26 升 v5→v6→v7→v8→v9→v10→v11→v12→v13→v14→v15→v16→v17→v18→v19→v20→v21→v22→v23→v24→v25→v26→v27→v28（修复 AV 剧照不持久化），2026-08-27 升 v29（新增 TPDB 第三元数据源）v30（HH→XV）v31（普通模式隐藏 影片/XV 与搜索源切换；里模式 TPDB Scene/Movie/JAV 改为输入框内单按钮轮播）v32（修复 themeHidden 判断反了）v33（日期标签改回）v34（TPDB 类型切换改为输入框内纯文字最右侧，清除按钮移到标签左侧，并加滚动器切换动效）v35（修复 TPDB 类型标签文字显示不全）v36（TPDB 类型切换动效重做：旧标签上移+淡出，新标签从下方淡入+上移到位，双层绝对定位独立动画）v37（修复切换动效结束时的回弹：动画结束后临时禁用 transition 固化新态，避免旧/新标签滑回）v38（统一搜索框宽度/位置：三种源下 input padding-right 与 clear 位置一致；TPDB 占位文案改为「请输入…」）v39（修正保存逻辑：编辑页去掉顶部影片标签；番号/制作商/发行商/系列作为通用字段显示并放到分级与国家/地区之间；保存后跳对应首页 tab；TPDB 类型顺序改为 电影→AV→场景，标签改为中文）v40（修复 TPDB 保存后首页无封面：搜索结果快速保存时丢弃了 populateFromTPDB 的图片加载 Promise，导致封面未补存；改为保存后监听图片加载完成再 silentRefreshCurrentFilm 静默补存封面，与 JAV 路径一致）v41（修复多项细节：API 配置页 Worker 代理地址补清除按钮；API 配置改为 blur/弹窗关闭时自动保存；搜索框清除按钮在无 TPDB 类型标签时贴到最右侧；JAV 默认 NR 分级；移除 JAV/TPDB 搜索列表 XV 标签；TPDB 类型标签右移、靠近清除按钮）v42（修复搜过 JAV 后元数据页残留：setFieldVal 空值不写输入框，导致 studio/label/series/dvdid 输入框残留上次 JAV 数据；改为 applyFilmData 与 newFilm 对这几个字段空值也显式清空输入框，并补清空 state；populateFromTMDB 开头也清空番号/制作商/发行商/系列/预告，避免搜索源间串档）v43（统一详情页 renderFilmDetail：去掉 adult 分支，改为同一套布局——顶部标题优先级 番号→LOGO→标题；制作商/发行商/系列所有影片统一显示（缺项不补占位符）；简介前缀统一为 [番号 标题] 或 [标题]；演职人员演员在前、导演统一放最后、标题统一「演职人员」；剧照固定 1 海报+最多 5 剧照；删除按钮 margin-left:auto 推到操作行最右侧）v47（影片增加来源标识 source 并据此刷新：film 记录 source=tmdb/jav/tpdb/custom（持久化进缓存，页面不展示）；populateFromTMDB/JAV/TPDB 分别置源、openCustomEdit 置 custom、buildFilmFromCurrent 写入、applyFilmData 还原；新增 refreshFilm(id) 按 source 路由到 refreshFromTMDB/refreshFromR18/refreshFromTPDB，新增 refreshFromTPDB 用 data.tpdbId 重新拉取覆盖保存；长按菜单「刷新」在 source==='custom' 时置灰不可点（showContextSheet 支持 disabled 项）；旧数据无 source 按 adult 兜底），清掉旧版缓存，避免 iOS 主屏 PWA 一直跑旧 HTML，v48（TMDB 搜索支持电影/剧集切换：搜索框右侧新增「电影/剧集」单按钮轮播，按 state.tmdbMediaType 走 /search/movie 或 /search/tv；结果卡片记录 data-tmdb-type 供详情拉取；applyTMDBById 按 mediaType 走 /movie 或 /tv 并适配视频 URL、预告角标缓存 key 带类型防冲突；populateFromTMDB 适配 TV 字段 name/first_air_date/episode_run_time/content_ratings/created_by；film.data 持久化 tmdbMediaType、刷新按此类型重新拉取），清掉旧版缓存，避免 iOS 主屏 PWA 一直跑旧 HTML，v49（接入自建 JavBus 抓取源：AV 搜索改为 JavBus 关键词/番号优先、无结果且像番号时回退 R18 兜底；API 配置新增 JavBus 服务地址；新增 populateFromJavbus/refreshFromJavbus 与 source='javbus' 刷新路由；封面/剧照经 Worker /img 代理）。
 */
const CACHE = 'nfo-ios-v52';
const APP_SHELL = ['./nfo-editor-ios.html'];
const WORKER_RE = /workers\.dev$/i;

function okToCache(res) {
  return res && (res.status === 200 || res.type === 'opaque' || res.status === 0);
}

function isImageReq(req) {
  var u = new URL(req.url);
  if (/tmdb\.org|i\.ibb\.co|img\.smg|cloudinary\.com/.test(u.hostname)) return true;
  return /\.(jpe?g|png|webp|gif|avif|svg)(\?|$)/i.test(u.pathname);
}

self.addEventListener('install', function (e) {
  e.waitUntil((function () {
    return caches.open(CACHE).then(function (c) {
      return c.add('./nfo-editor-ios.html').catch(function () {});
    });
  })().then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) {
      return k !== CACHE ? caches.delete(k) : Promise.resolve();
    }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // 磁力代理：始终网络、不缓存
  if (WORKER_RE.test(url.hostname)) {
    e.respondWith(fetch(req, { cache: 'no-store' }).catch(function () { return fetch(req); }));
    return;
  }

  // 同源：网络优先，离线回退缓存
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req).then(function (res) {
        if (okToCache(res)) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (cached) { return cached || caches.match('./nfo-editor-ios.html'); });
      })
    );
    return;
  }

  // 跨域图片：缓存优先
  if (isImageReq(req)) {
    e.respondWith(
      caches.match(req).then(function (cached) {
        if (cached) return cached;
        return fetch(req).then(function (res) {
          if (okToCache(res)) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
          return res;
        }).catch(function () { return cached; });
      })
    );
    return;
  }
  // 其余（TMDB API 等）走网络，不缓存
});
