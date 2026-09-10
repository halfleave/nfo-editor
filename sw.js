/* nfo-editor-ios Service Worker —— 离线缓存应用壳 + 海报图片
 * 策略：
 *  - 磁力代理（*.workers.dev）：始终走网络、不缓存，保证每次都打到最新 Worker
 *  - 同源（nfo-editor-ios.html / manifest.json 等应用壳）：网络优先且**绕过浏览器 HTTP 缓存**，
 *    离线回退缓存（支持离线打开）。绕过缓存是为了让 PWA 独立窗口每次打开都拿到最新版，
 *    不再需要用户手动清站缓存 / 重加主屏。
 *  - 跨域图片（image.tmdb.org 等海报）：缓存优先，离线可见已加载过的图
 *  - 其余（TMDB API 等）：走网络，不缓存
 * 改版时递增下方 CACHE 版本号，旧缓存会在 activate 阶段被清理。
 * 逐版本变更记录见 git log，此处不再罗列。
 */
const CACHE = 'nfo-ios-v269';
const APP_SHELL = ['./nfo-editor-ios.html', './manifest.json', './src/core-shared.js', './src/pinyin-initial.js', './src/auto115-core.js', './styles/ios.css', './src/ui-ios.js', './src/qrcode.min.js'];
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
      return c.addAll(APP_SHELL).catch(function () { return c.add('./nfo-editor-ios.html').catch(function () {}); });
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

  // 同源：网络优先（绕过 HTTP 缓存，保证拿到最新），离线回退缓存
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req, { cache: 'reload' }).then(function (res) {
        if (okToCache(res)) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (cached) {
          if (cached) return cached;
          // 静态资源带 ?v= 版本号，忽略查询串回退到预缓存的无参数版本
          return caches.match(req, { ignoreSearch: true }).then(function (c2) { return c2 || caches.match('./nfo-editor-ios.html'); });
        });
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
