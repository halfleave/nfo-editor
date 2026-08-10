/* nfo-editor-ios Service Worker —— 离线缓存应用壳 + TMDB 海报
 * 策略：
 *  - 同源（index.html 等应用壳）：网络优先，离线回退缓存（避免旧版缓存，同时支持离线打开）
 *  - 跨域图片（image.tmdb.org 等海报）：缓存优先，离线可见已加载过的图
 *  - 其余（TMDB API 等）：走网络，不缓存
 */
const CACHE = 'nfo-ios-v1';
const APP_SHELL = ['./index.html'];

function okToCache(res){
  return res && (res.status === 200 || res.type === 'opaque' || res.status === 0);
}

self.addEventListener('install', function(e){
  e.waitUntil((function(){
    return caches.open(CACHE).then(function(c){
      // 安装时页面可能尚未就绪，失败也无妨，运行时网络优先会补齐
      return c.add('./index.html').catch(function(){});
    });
  })().then(function(){ return self.skipWaiting(); }));
});

self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.map(function(k){
      return k !== CACHE ? caches.delete(k) : Promise.resolve();
    }));
  }).then(function(){ return self.clients.claim(); }));
});

function isImageReq(req){
  var u = new URL(req.url);
  if (/tmdb\.org|i\.ibb\.co|img\.smg|cloudinary\.com/.test(u.hostname)) return true;
  return /\.(jpe?g|png|webp|gif|avif|svg)(\?|$)/i.test(u.pathname);
}

self.addEventListener('fetch', function(e){
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // 同源：网络优先，离线回退缓存
  if (url.origin === self.location.origin){
    e.respondWith(
      fetch(req).then(function(res){
        if (okToCache(res)){
          var copy = res.clone();
          caches.open(CACHE).then(function(c){ c.put(req, copy); });
        }
        return res;
      }).catch(function(){
        return caches.match(req).then(function(cached){ return cached || caches.match('./index.html'); });
      })
    );
    return;
  }

  // 跨域图片：缓存优先
  if (isImageReq(req)){
    e.respondWith(
      caches.match(req).then(function(cached){
        if (cached) return cached;
        return fetch(req).then(function(res){
          if (okToCache(res)){
            var copy = res.clone();
            caches.open(CACHE).then(function(c){ c.put(req, copy); });
          }
          return res;
        }).catch(function(){ return cached; });
      })
    );
    return;
  }
  // 其余（TMDB API 等）走网络，不缓存
});
