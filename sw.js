/* nfo-editor-ios Service Worker —— 离线缓存应用壳 + 海报图片
 * v448 策略（「秒开 + 后台静默更新」）：
 *  - 同源（应用壳）：**缓存优先**——有缓存立刻返回，不再等网络（旧版是网络优先 + cache:'reload'，
 *    弱网时会白屏十几秒）。缓存未命中才联网，拿到后顺手写入缓存。
 *    HTML 也不做后台覆盖：同一次发版的所有文件共用一个 CACHE 桶，整桶替换只发生在
 *    「新版本 sw.js 安装」时，避免出现「新 HTML 配旧 JS/CSS」的错位。
 *  - install：逐文件预缓存（allSettled），单个文件失败不连累其它；**不再 skipWaiting**——
 *    新版本停在 waiting，等用户在设置页点「发现新版本」或下次启动生效。
 *  - message SKIP_WAITING：设置页点更新时由页面通知，立即接管。
 *  - 磁力代理（*.workers.dev / Vercel）：始终走网络、不缓存
 *  - 跨域图片（tmdb 等海报）：缓存优先，离线可见已加载过的图
 *  - 其余（TMDB API 等）：走网络，不缓存
 * 改版时递增下方 CACHE 版本号（tools/bump.js 自动改），旧缓存会在 activate 阶段被清理。
 * 注意：不发版就别改这个号——sw.js 字节不变浏览器就认为没有新版本，设置页的更新按钮也永远不会出现。
 */
const CACHE = 'nfo-ios-v448';
const APP_SHELL = ['./nfo-editor-ios.html', './manifest.json', './src/core-shared.js', './src/pinyin-initial.js', './src/auto115-core.js', './src/toolbox-core.js', './src/tidy-core.js', './styles/ios.css', './src/ui-ios.js', './src/qrcode.min.js'];
// 注意：真实 Worker 部署在 Vercel（nfo-magnet-proxy-vercel.vercel.app），并非 Cloudflare 的 *.workers.dev，
// 故此处须同时匹配 vercel.app 上的 Worker 域名，否则「Worker 请求永远走网络、不缓存」的规则对其不生效，
// 故障期的 404 可能被浏览器 HTTP 缓存住而在手机端持续出现。
const WORKER_RE = /(workers\.dev|nfo-magnet-proxy-vercel\.vercel\.app)$/i;

function okToCache(res) {
  return res && (res.status === 200 || res.type === 'opaque' || res.status === 0);
}

function isImageReq(req) {
  var u = new URL(req.url);
  if (/tmdb\.org|i\.ibb\.co|img\.smg|cloudinary\.com/.test(u.hostname)) return true;
  return /\.(jpe?g|png|webp|gif|avif|svg)(\?|$)/i.test(u.pathname);
}

self.addEventListener('install', function (e) {
  // allSettled：弱网下个别文件失败不连累其余文件入缓存（缺的等真正用到时再补下载）
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.allSettled(APP_SHELL.map(function (u) { return c.add(u); }));
  }));
  // 不调用 skipWaiting：新版本先停在 waiting，等用户点「发现新版本」或下次启动自动接管
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) {
      return k !== CACHE ? caches.delete(k) : Promise.resolve();
    }));
  }).then(function () { return self.clients.claim(); }));
});

/* 设置页「发现新版本 → 点击更新」：页面通知后立即接管（页面在 controllerchange 里重载） */
self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
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

  // 同源：缓存优先（秒开），未命中才联网并回填缓存
  if (url.origin === self.location.origin) {
    e.respondWith(caches.open(CACHE).then(function (c) {
      // ignoreSearch：页面引用的是 styles/ios.css?v=448，预缓存的是无查询串版本
      return c.match(req, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        // 导航请求兜底：start_url 与文件路径不一致时也能落到缓存的壳上
        if (req.mode === 'navigate') {
          return c.match('./nfo-editor-ios.html').then(function (shellHit) {
            if (shellHit) return shellHit;
            return fetchAndCache(c, req);
          });
        }
        return fetchAndCache(c, req);
      });
    }));
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

function fetchAndCache(c, req) {
  return fetch(req).then(function (res) {
    if (okToCache(res)) {
      var copy = res.clone();
      c.put(req, copy).catch(function () {});
    }
    return res;
  });
}
