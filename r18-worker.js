/**
 * R18.dev + 封面图代理 Worker（Cloudflare Workers 语法）
 *
 * 用途：r18.dev 被 Cloudflare 拦浏览器直连（带 UA 无 Referer 即 403），
 * 且封面域名 pics.dmm.co.jp 无 CORS 头，无法直接用 fetch 拉图。
 * 本 Worker 在云端转发请求并补上 UA / Referer / CORS 头，手机端即可调用。
 *
 * 部署：Cloudflare Dashboard → Workers → 新建 → 粘贴本文件 → 部署，
 *       把分配的 https 地址填到 App 的「设置 → API 配置 → 磁力 / R18 Worker 地址」。
 *
 * 路由：
 *   /r18?dvd_id=IPX-011      代理 r18.dev 影片详情 JSON
 *   /img?url=<封面URL>        代理任意图片（解决跨域，返回带 CORS 头的图片）
 *   /?q=... 及 /subtitles?... 磁力搜索（保留你原有磁力逻辑，见下方占位）
 *
 * 若你已有 Vercel 磁力 Worker，只需把下面 handleR18() 与 handleImg() 两个分支
 * 复制进现有 Worker 的 fetch 处理即可（逻辑相同，仅语法糖略有差异）。
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // —— R18 影片详情 ——
    if (url.pathname === '/r18') {
      const dvd = url.searchParams.get('dvd_id');
      if (!dvd) return json({ error: 'missing dvd_id' }, 400);
      const target = 'https://r18.dev/videos/vod/movies/detail/-/dvd_id=' +
        encodeURIComponent(dvd) + '/json';
      try {
        const r = await fetch(target, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
            'Referer': 'https://r18.dev/',
            'Accept': 'application/json'
          }
        });
        const body = await r.text();
        return new Response(body, {
          status: r.status,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'access-control-allow-origin': '*',
            'cache-control': 'max-age=86400'
          }
        });
      } catch (e) {
        return json({ error: 'r18 fetch failed: ' + e.message }, 502);
      }
    }

    // —— 图片代理（封面 / 剧照跨域）——
    if (url.pathname === '/img') {
      const u = url.searchParams.get('url');
      if (!u) return new Response('missing url', { status: 400 });
      try {
        const r = await fetch(u, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://r18.dev/'
          }
        });
        return new Response(await r.arrayBuffer(), {
          status: r.status,
          headers: {
            'content-type': r.headers.get('content-type') || 'image/jpeg',
            'access-control-allow-origin': '*',
            'cache-control': 'max-age=86400'
          }
        });
      } catch (e) {
        return new Response('img fetch failed: ' + e.message, { status: 502 });
      }
    }

    // —— 磁力搜索（保留你原有逻辑，此处为占位）——
    // 例：把请求转发到你原本的磁力后端 API。把下面替换成你现有 Worker 的真实实现。
    if (url.pathname === '/' || url.pathname.startsWith('/subtitles')) {
      // TODO: 在此粘贴你现有磁力 Worker 的处理逻辑（保持 /?q= 与 /subtitles?action= 路由不变）
      return new Response('磁力路由未配置：请将你现有磁力 Worker 逻辑粘贴到此分支。', {
        status: 501,
        headers: { 'access-control-allow-origin': '*' }
      });
    }

    return new Response('not found', { status: 404 });
  }
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' }
  });
}
