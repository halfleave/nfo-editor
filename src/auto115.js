/* =====================================================================
 * nfo-editor · PC 端 115 自动化引擎（auto115.js）
 * 移植自手机端 ui-ios.js v213/v214 的活跃逻辑；剔除 4.0 加密逆向死代码，
 * SHA1/HMAC 走 Web Crypto（与手机端一致）。渲染指向 PC DOM（popover + 配置弹窗），
 * 不触碰手机端代码。依赖 PC 全局：state / currentDetailFilm / idbGet / idbPut /
 * showToast / openSheet / closeAllSheets / DEFAULT_WORKER / escapeHtml /
 * escapeAttr / buildNFOMovieXml / dataUrlToBytesSync / loadFilm / copyText。
 * 暴露 window.PC115 供 ui.js 调用；任务/引擎函数为全局（供内联 onclick 直接调用）。
 * ===================================================================== */
(function (global) {
  'use strict';

  /* ---------- 常量 ---------- */
  var C115_PROXY_TOKEN = 'C115PX_7d3k9f2m5q8x1a4t';
  var C115_APP = 'web';
  var C115_COOKIE_KEY = 'c115cookie';
  var C115_TOKEN_KEY = 'c115token';
  var C115_DEFAULT_DIR_CID = '3311283881428122938';
  var C115_OPEN_KEY = 'c115open';
  var C115_UA_DISK = 'Mozilla/5.0 115disk/30.5.1';
  var C115_UA_ALI = 'aliyun-sdk-android/2.9.1';

  /* 确保 state 上的 115 字段存在（core.js 已定义 state） */
  if (typeof state !== 'undefined') {
    if (!('c115Cookie' in state)) state.c115Cookie = '';
    if (!('c115ProxyToken' in state)) state.c115ProxyToken = C115_PROXY_TOKEN;
    if (!('c115Open' in state)) state.c115Open = null;
  }

  /* ---------- 协议层（与手机端一致） ---------- */
  function c115ProxyBase() {
    return (state.magnetWorker || DEFAULT_WORKER || '').replace(/\/$/, '') + '';
  }
  var c115FailStreak = 0;
  function c115AdaptiveDelay() {
    if (c115FailStreak <= 0) return 0;
    var base = Math.min(800 * Math.pow(2, c115FailStreak - 1), 8000);
    return base + Math.floor(Math.random() * 300);
  }
  function c115Sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function c115ProxyFetch(targetUrl, opts) {
    opts = opts || {};
    var base = c115ProxyBase();
    if (!base) { var err = new Error('未配置代理服务地址'); err.status = 0; err.body = ''; throw err; }
    var proxyUrl = base + '/api/cloud/proxy';
    var form = 'url=' + encodeURIComponent(targetUrl) + '&token=' + encodeURIComponent(state.c115ProxyToken || C115_PROXY_TOKEN);
    if (opts.headers && opts.headers['X-115-Cookie']) form += '&ck=' + encodeURIComponent(opts.headers['X-115-Cookie']);
    if (opts.ua) form += '&ua=' + encodeURIComponent(opts.ua);
    if (opts.xs) form += '&xs=' + encodeURIComponent(JSON.stringify(opts.xs));
    if (opts.noRef) form += '&noRef=1';
    if (opts.method && opts.method !== 'GET') {
      form += '&method=' + encodeURIComponent(opts.method.toUpperCase());
      if (opts.body != null) form += '&payload=' + encodeURIComponent(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
      if (opts.headers && opts.headers['Content-Type']) form += '&ct=' + encodeURIComponent(opts.headers['Content-Type']);
      if (opts.b64) form += '&b64=1';
    }
    var waitMs = c115AdaptiveDelay();
    if (waitMs > 0) await c115Sleep(waitMs);
    return fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      cache: 'no-store'
    }).then(function (r) {
      c115FailStreak = r.ok ? 0 : Math.min(c115FailStreak + 1, 4);
      if (opts.bin) {
        return r.arrayBuffer().then(function (buf) {
          return { ok: r.ok, status: r.status, d: {}, raw: '', bin: c115BytesToB64(new Uint8Array(buf)) };
        });
      }
      return r.text().then(function (txt) {
        var d = {};
        try { d = JSON.parse(txt); } catch (_) { d = { raw: txt.slice(0, 300) }; }
        if (!r.ok) {
          var errMsg = d && d.error ? d.error : ('HTTP ' + r.status);
          if (d && d.debug) errMsg += ' | ' + JSON.stringify(d.debug);
          var err = new Error(errMsg); err.status = r.status; err.body = txt.slice(0, 300); err.data = d;
          throw err;
        }
        return { ok: r.ok, status: r.status, d: d || {}, raw: txt.slice(0, 500) };
      });
    }).catch(function (e) {
      if (!(e && e.status)) c115FailStreak = Math.min(c115FailStreak + 1, 4);
      if (e && e.status) throw e;
      var err = new Error((e && e.message ? e.message : '网络错误') + ' [' + proxyUrl + ']');
      err.network = true; err.url = proxyUrl; err.original = e;
      throw err;
    });
  }

  /* ---------- 加密辅助（Web Crypto） ---------- */
  async function c115Sha1Hex(input, tag) {
    var bytes = (typeof input === 'string') ? new TextEncoder().encode(input) : input;
    try {
      var buf = await crypto.subtle.digest('SHA-1', bytes);
      return Array.from(new Uint8Array(buf)).map(function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
    } catch (e) {
      throw new Error('SHA1' + (tag ? '(' + tag + ')' : '') + '失败：' + ((e && e.message) || e) + ' len=' + bytes.length);
    }
  }
  async function c115HmacSha1B64(secret, msg) {
    try {
      var k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
      var mac = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
      return c115BytesToB64(new Uint8Array(mac));
    } catch (e) { throw new Error('HMAC-SHA1 失败：' + ((e && e.message) || e) + ' secretLen=' + secret.length + ' msgLen=' + msg.length); }
  }
  function c115BytesToB64(bytes) {
    var bin = '', i;
    for (i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
    return btoa(bin);
  }
  function pcSanitizeName(name) {
    if (typeof NfoCore !== 'undefined' && NfoCore.sanitizeName) return NfoCore.sanitizeName(name);
    if (typeof sanitizeName === 'function') return sanitizeName(name);
    return (name || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim() || 'movie';
  }

  /* ---------- 115 配置（扫码登录 + Cookie 管理 + 开放平台授权） ---------- */
  var c115QrInstance = null, c115Polling = false, c115PollTimer = null, c115QrTimer = null;
  var c115CountdownTimer = null, c115QrDeadline = 0, c115Session = null;

  function pc115SetStatus(text, type) {
    var el = document.getElementById('c115StatusPc');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'c115-status' + (type ? ' ' + type : '');
  }
  function pc115OpenSheet() {
    closeAllSheets();
    var ta = document.getElementById('c115CookiePc');
    if (ta) ta.value = '';
    openSheet('pc115Sheet');
    pc115RefreshOpenStatus();
    idbGet('kv', C115_COOKIE_KEY).then(function (v) {
      var cookie = (typeof v === 'string') ? v : (v && v.cookie) || '';
      if (ta && cookie) ta.value = cookie;
      state.c115Cookie = cookie;
      pc115ResetQrButton();
    }).catch(function () { pc115ResetQrButton(); });
    var tk = document.getElementById('c115TokenPc');
    if (tk) tk.value = '';
    idbGet('kv', C115_TOKEN_KEY).then(function (v) {
      var t = (typeof v === 'string') ? v : (v && v.token) || '';
      if (tk && t) tk.value = t;
      state.c115ProxyToken = t || C115_PROXY_TOKEN;
    }).catch(function () { state.c115ProxyToken = C115_PROXY_TOKEN; });
    var vEl = document.getElementById('c115VerifyPc');
    if (vEl) { vEl.textContent = ''; vEl.className = 'c115-verify'; }
  }
  function pc115StartLogin() {
    if (c115QrTimer) { clearTimeout(c115QrTimer); c115QrTimer = null; }
    if (c115CountdownTimer) { clearInterval(c115CountdownTimer); c115CountdownTimer = null; }
    pc115ShowQrArea();
    var base = c115ProxyBase();
    if (!base) { showToast('还没设置网络服务，去「设置 → 应用配置」填一下', 'error'); return; }
    pc115SetStatus('正在生成二维码…', '');
    c115ProxyFetch('https://qrcodeapi.115.com/api/1.0/web/1.0/token/')
      .then(function (res) {
        if (!res.ok || !res.d || !res.d.data || !res.d.data.uid) { var err = new Error('获取二维码失败'); err.status = res && res.status; err.data = res && res.d; throw err; }
        var data = res.d.data;
        c115Session = { uid: data.uid, time: data.time, sign: data.sign, app: C115_APP };
        var qrText = data.qrcode || ('https://qrcodeapi.115.com/api/1.0/web/1.0/token/?uid=' + data.uid + '&time=' + data.time + '&sign=' + data.sign + '&app=' + C115_APP);
        var m = /[?&]app=([^&]+)/.exec(qrText);
        if (m) c115Session.app = decodeURIComponent(m[1]);
        pc115RenderQr(qrText);
        pc115SetStatus('请用 115 App 扫码并在手机上确认', '');
        pc115StartPolling();
        pc115StartCountdown();
      })
      .catch(function (e) {
        var info = (e && e.message ? e.message : '网络错误');
        if (e && e.status) info += ' (HTTP ' + e.status + ')';
        if (e && e.body && e.body.length < 80) info += ' ' + e.body;
        if (e && e.data) info += ' | ' + JSON.stringify(e.data).slice(0, 200);
        if (e && e.network) info = '连不上代理：' + info;
        pc115SetStatus('生成二维码失败：' + info, 'err');
      });
  }
  function pc115ShowQrArea() {
    var wrap = document.getElementById('c115QrWrapPc'); if (wrap) wrap.style.display = '';
    var st = document.getElementById('c115StatusPc'); if (st) { st.style.display = ''; st.textContent = '正在生成二维码…'; }
    var cd = document.getElementById('c115CountdownPc'); if (cd) { cd.style.display = ''; cd.textContent = ''; }
    var btn = document.getElementById('c115ShowQrBtnPc'); if (btn) btn.style.display = 'none';
  }
  function pc115ResetQrButton() {
    if (c115CountdownTimer) { clearInterval(c115CountdownTimer); c115CountdownTimer = null; }
    if (c115QrTimer) { clearTimeout(c115QrTimer); c115QrTimer = null; }
    pc115StopPolling();
    var wrap = document.getElementById('c115QrWrapPc'); if (wrap) wrap.style.display = 'none';
    var st = document.getElementById('c115StatusPc'); if (st) { st.style.display = 'none'; st.textContent = ''; }
    var cd = document.getElementById('c115CountdownPc'); if (cd) { cd.style.display = 'none'; cd.textContent = ''; }
    var btn = document.getElementById('c115ShowQrBtnPc'); if (btn) btn.style.display = '';
  }
  function pc115StartCountdown() {
    if (c115CountdownTimer) { clearInterval(c115CountdownTimer); c115CountdownTimer = null; }
    c115QrDeadline = Date.now() + 120000;
    pc115UpdateCountdown();
    c115CountdownTimer = setInterval(pc115UpdateCountdown, 1000);
  }
  function pc115UpdateCountdown() {
    var el = document.getElementById('c115CountdownPc');
    if (!el) return;
    var remain = Math.ceil((c115QrDeadline - Date.now()) / 1000);
    if (remain <= 0) {
      if (c115CountdownTimer) { clearInterval(c115CountdownTimer); c115CountdownTimer = null; }
      pc115StartLogin();
      return;
    }
    el.textContent = '二维码 ' + remain + ' 秒后刷新';
  }
  function pc115RenderQr(text) {
    var el = document.getElementById('c115QrPc');
    if (!el) return;
    el.innerHTML = '';
    if (typeof QRCode === 'undefined') { pc115SetStatus('二维码库未加载', 'err'); return; }
    c115QrInstance = new QRCode(el, { text: text, width: 168, height: 168, correctLevel: QRCode.CorrectLevel.M });
  }
  function pc115StartPolling() {
    if (c115Polling) return;
    c115Polling = true;
    pc115PollOnce();
  }
  function pc115StatusValue(res) {
    if (!res || !res.d || !res.d.data) return null;
    var d = res.d.data;
    if (typeof d.status !== 'undefined' && d.status !== null) return d.status;
    if (Array.isArray(d) && d[0] && typeof d[0].status !== 'undefined') return d[0].status;
    return null;
  }
  function pc115PollOnce() {
    if (!c115Polling || !c115Session) return;
    var s = c115Session;
    var url = 'https://qrcodeapi.115.com/get/status/?uid=' + s.uid + '&time=' + s.time + '&sign=' + encodeURIComponent(s.sign);
    c115ProxyFetch(url)
      .then(function (res) {
        if (!c115Polling) return;
        var st = pc115StatusValue(res);
        if (st === 0 || st === null) { pc115SetStatus('请用 115 App 扫码并在手机上确认', ''); c115PollTimer = setTimeout(pc115PollOnce, 1800); }
        else if (st === 1) { pc115SetStatus('已扫码，请在 115 App 上确认登录', ''); c115PollTimer = setTimeout(pc115PollOnce, 1800); }
        else if (st === 2) { pc115SetStatus('已确认，正在换取 Cookie…', 'ok'); pc115StopPolling(); pc115ExchangeCookie(s.uid); }
        else if (st === -1) {
          pc115SetStatus('二维码已过期，请重新点击「展示二维码」', 'err'); pc115StopPolling();
          if (c115CountdownTimer) { clearInterval(c115CountdownTimer); c115CountdownTimer = null; }
          var qrw = document.getElementById('c115QrWrapPc'); if (qrw) qrw.style.display = 'none';
          var sb = document.getElementById('c115ShowQrBtnPc'); if (sb) sb.style.display = '';
        } else if (st === -2) {
          pc115SetStatus('已取消登录', 'err'); pc115StopPolling();
          var sb2 = document.getElementById('c115ShowQrBtnPc'); if (sb2) sb2.style.display = '';
        } else { pc115SetStatus('未知状态：' + st, 'err'); c115PollTimer = setTimeout(pc115PollOnce, 1800); }
      })
      .catch(function (e) {
        if (!c115Polling) return;
        var info = (e && e.message ? e.message : '网络错误');
        if (e && e.status) info += ' (' + e.status + ')';
        pc115SetStatus('轮询失败：' + info + '，重试中…', 'err');
        c115PollTimer = setTimeout(pc115PollOnce, 2500);
      });
  }
  function pc115StopPolling() {
    c115Polling = false;
    if (c115PollTimer) { clearTimeout(c115PollTimer); c115PollTimer = null; }
    if (c115QrTimer) { clearTimeout(c115QrTimer); c115QrTimer = null; }
  }
  function pc115ExchangeCookie(uid) {
    var btn = document.getElementById('c115LoginBtnPc');
    if (btn) btn.disabled = true;
    var app = (c115Session && c115Session.app) || C115_APP;
    c115ProxyFetch('https://passportapi.115.com/app/1.0/' + app + '/1.0/login/qrcode/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'app=' + encodeURIComponent(app) + '&account=' + encodeURIComponent(uid)
    })
      .then(function (res) {
        if (!res.ok || !res.d || !res.d.data || !res.d.data.cookie) { var msg = (res.d && res.d.error) ? res.d.error : '换取 Cookie 失败'; var err = new Error(msg); err.status = res.status; err.data = res.d; throw err; }
        var ck = res.d.data.cookie;
        var cookieStr = Object.keys(ck).map(function (k) { return k + '=' + ck[k]; }).join('; ');
        var ta = document.getElementById('c115CookiePc');
        if (ta) ta.value = cookieStr;
        state.c115Cookie = cookieStr;
        return idbPut('kv', C115_COOKIE_KEY, cookieStr).then(function () {
          pc115SetStatus('登录成功，Cookie 已自动保存', 'ok');
          if (c115CountdownTimer) { clearInterval(c115CountdownTimer); c115CountdownTimer = null; }
          var sb = document.getElementById('c115ShowQrBtnPc'); if (sb) sb.style.display = 'none';
          showToast('115 登录成功', 'success');
          pc115Verify();
        });
      })
      .catch(function (e) {
        var info = (e && e.message ? e.message : '网络错误');
        if (e && e.status) info += ' (HTTP ' + e.status + ')';
        pc115SetStatus('换取 Cookie 失败：' + info, 'err');
        if (btn) btn.disabled = false;
      });
  }
  function pc115TokenInput() {
    var tk = document.getElementById('c115TokenPc');
    var t = tk ? tk.value.trim() : '';
    state.c115ProxyToken = t || C115_PROXY_TOKEN;
    idbPut('kv', C115_TOKEN_KEY, t).catch(function () {});
  }
  function pc115CopyCookie() {
    var ta = document.getElementById('c115CookiePc');
    var v = ta ? ta.value.trim() : '';
    if (!v) { showToast('没有可复制的登录信息', 'error'); return; }
    copyText(v, function (ok) { showToast(ok ? '已复制登录信息' : '复制失败', ok ? 'success' : 'error'); });
  }
  function pc115Verify(silent) {
    var vEl = silent ? null : document.getElementById('c115VerifyPc');
    var ta = document.getElementById('c115CookiePc');
    var cookie = (ta && ta.value) ? ta.value.trim() : (state.c115Cookie || '');
    if (!cookie) { if (vEl) { vEl.textContent = '请先填写登录信息'; vEl.className = 'c115-verify err'; } return; }
    if (vEl) { vEl.textContent = '正在检查…'; vEl.className = 'c115-verify'; }
    var timedOut = false;
    var timer = setTimeout(function () {
      timedOut = true;
      if (vEl) { vEl.textContent = '✗ 没连上，稍后再试'; vEl.className = 'c115-verify err'; }
    }, 15000);
    var done = function () { clearTimeout(timer); };
    c115ProxyFetch('https://webapi.115.com/files?cid=0', { headers: { 'X-115-Cookie': cookie } })
      .then(function (res) {
        done();
        if (timedOut) return;
        if (!res.ok || !res.d || res.d.state !== true) throw new Error((res.d && (res.d.error || res.d.msg)) || 'Cookie 无效');
        if (vEl) { vEl.textContent = '✓ 连接正常'; vEl.className = 'c115-verify ok'; }
        state.c115Cookie = cookie;
        idbPut('kv', C115_COOKIE_KEY, cookie).catch(function () {});
      })
      .catch(function (e) {
        done();
        if (timedOut) return;
        var msg = (e && e.message) ? e.message : '自检失败';
        if (vEl) { vEl.textContent = '✗ 没能连上，稍后再试'; vEl.className = 'c115-verify err'; return; }
        if (silent && /Cookie|失效|令牌|登录/.test(msg)) showToast('115 登录过期了，去设置里重新登录一下', 'error');
      });
  }

  /* ---------- 开放平台（上传 NFO 走官方通道） ---------- */
  function c115OpenForm(o) { return Object.keys(o).map(function (k) { return k + '=' + encodeURIComponent(o[k]); }).join('&'); }
  async function c115OpenReq(url, method, body, auth) {
    var opts = { method: method || 'GET', xs: auth, ua: C115_UA_DISK };
    if (body != null) { opts.body = body; opts.headers = { 'Content-Type': 'application/x-www-form-urlencoded' }; }
    var r = await c115ProxyFetch(url, opts);
    var d = r.d || {};
    if (d.state === false) throw new Error('开放平台拒绝：' + (d.message || d.error || JSON.stringify(d).slice(0, 120)));
    return d.data || d;
  }
  async function c115OpenAuthorize() {
    var base = c115ProxyBase();
    if (!base) throw new Error('未配置代理服务地址');
    var cookie = state.c115Cookie || '';
    if (!cookie) throw new Error('未登录 115（无 Cookie）');
    var r = await fetch(base + '/open115/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'token=' + encodeURIComponent(state.c115ProxyToken || C115_PROXY_TOKEN) + '&ck=' + encodeURIComponent(cookie),
      cache: 'no-store'
    });
    var j = {};
    try { j = await r.json(); } catch (_) { throw new Error('授权响应解析失败（HTTP ' + r.status + '）'); }
    if (!j.ok) {
      var extra = '';
      if (j.hint) extra += '\n诊断：' + j.hint;
      if (j.redirectTo) extra += '\n服务端 Location：' + j.redirectTo;
      throw new Error((j.error || '授权失败') + extra);
    }
    var rec = { access: j.access_token, refresh: j.refresh_token, appId: j.app_id || '', exp: Date.now() + 7000 * 1000 };
    try { await idbPut('kv', C115_OPEN_KEY, rec); } catch (_) {}
    state.c115Open = rec;
    return rec;
  }
  async function c115OpenToken() {
    var t = state.c115Open;
    if (!t || !t.access) { try { t = await idbGet('kv', C115_OPEN_KEY); } catch (_) { t = null; } if (t && t.access) state.c115Open = t; }
    if (t && t.access && t.exp && Date.now() < t.exp - 60000) return t.access;
    if (t && t.refresh) {
      try {
        var res = await c115ProxyFetch('https://passportapi.115.com/open/refreshToken', {
          method: 'POST', body: 'refresh_token=' + encodeURIComponent(t.refresh),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, ua: C115_UA_DISK, noRef: 1
        });
        var d = res.d || {}, dd = d.data || d;
        if (dd && dd.access_token) {
          var rec = { access: dd.access_token, refresh: dd.refresh_token || t.refresh, appId: t.appId, exp: Date.now() + 7000 * 1000 };
          try { await idbPut('kv', C115_OPEN_KEY, rec); } catch (_) {}
          state.c115Open = rec;
          return rec.access;
        }
      } catch (e) {}
    }
    var fresh = await c115OpenAuthorize();
    return fresh.access;
  }
  async function c115OpenUploadFile(cid, fileName, bytes, mime) {
    var at = await c115OpenToken();
    var auth = { 'Authorization': 'Bearer ' + at };
    var fileID = (await c115Sha1Hex(bytes, 'file')).toUpperCase();
    var preID = (await c115Sha1Hex(bytes.subarray(0, Math.min(bytes.length, 131072)), 'preid')).toUpperCase();
    var payload = { file_name: fileName, file_size: String(bytes.length), target: 'U_1_' + cid, fileid: fileID, preid: preID, topupload: '0' };
    var d = await c115OpenReq('https://proapi.115.com/open/upload/init', 'POST', c115OpenForm(payload), auth);
    var status = Number(d.status), code = Number(d.code || 0);
    if ((code === 700 && status === 6) || (code === 701 && status === 7)) {
      var sc = String(d.sign_check || '').split('-');
      var s0 = parseInt(sc[0], 10), s1 = parseInt(sc[1], 10);
      if (isNaN(s0) || isNaN(s1) || s0 < 0 || s1 < s0) throw new Error('sign_check 范围异常：' + d.sign_check);
      payload.sign_key = String(d.sign_key || '');
      payload.sign_val = (await c115Sha1Hex(bytes.subarray(s0, s1 + 1), 'signVal')).toUpperCase();
      d = await c115OpenReq('https://proapi.115.com/open/upload/init', 'POST', c115OpenForm(payload), auth);
      status = Number(d.status); code = Number(d.code || 0);
    }
    if (code === 702 && status === 8) throw new Error('文件签名认证失败（702）');
    if (status === 2) return '';
    if (status !== 1) throw new Error('上传初始化失败：' + (d.message || JSON.stringify(d).slice(0, 120)));
    var bucket = d.bucket, object = d.object, cb = d.callback || {};
    if (!bucket || !object || !cb.callback) throw new Error('初始化响应缺少 OSS 参数：' + JSON.stringify(d).slice(0, 120));
    var sts = await c115OpenReq('https://proapi.115.com/open/upload/get_token', 'GET', null, auth);
    if (!sts.endpoint || !sts.AccessKeyId || !sts.AccessKeySecret || !sts.SecurityToken) throw new Error('获取 OSS 临时凭证失败：' + JSON.stringify(sts).slice(0, 120));
    mime = mime || 'application/octet-stream';
    var date = new Date().toUTCString();
    var xs = {
      'x-oss-security-token': sts.SecurityToken,
      'x-oss-callback': btoa(unescape(encodeURIComponent(cb.callback))),
      'x-oss-callback-var': btoa(unescape(encodeURIComponent(cb.callback_var || ''))),
      'x-oss-date': date
    };
    var canonical = ['x-oss-callback', 'x-oss-callback-var', 'x-oss-date', 'x-oss-security-token'].map(function (k) { return k + ':' + xs[k] + '\n'; }).join('');
    var strToSign = 'PUT\n\n' + mime + '\n' + date + '\n' + canonical + '/' + bucket + '/' + object;
    xs['Authorization'] = 'OSS ' + sts.AccessKeyId + ':' + (await c115HmacSha1B64(sts.AccessKeySecret, strToSign));
    var putUrl = String(sts.endpoint).replace(/\/+$/, '');
    if (!/^https?:\/\//.test(putUrl)) putUrl = 'https://' + putUrl;
    putUrl = putUrl.replace(/^(https?:\/\/)([^/]+)$/, '$1' + bucket + '.$2');
    if (putUrl.indexOf('/' + bucket + '.') < 0 && putUrl.indexOf(bucket + '.') < 0) putUrl = putUrl.replace(/^(https?:\/\/)/, '$1' + bucket + '.');
    putUrl = putUrl.replace(/\/+$/, '') + '/' + object;
    var putRes = await c115ProxyFetch(putUrl, { method: 'PUT', body: c115BytesToB64(bytes), b64: true, ua: C115_UA_ALI, xs: xs, headers: { 'Content-Type': mime } });
    var pd = putRes.d || {};
    if (pd.state === true || putRes.status === 200) return '';
    throw new Error('OSS PUT 失败（HTTP ' + putRes.status + '）：' + (pd.message || pd.error || (putRes.raw || '').slice(0, 110)));
  }
  function pc115OpenAuthUI() {
    var el = document.getElementById('c115OpenStatusPc');
    function set(t) { if (el) el.textContent = t; }
    set('正在授权…');
    ensure115Cookie().then(function () {
      return c115OpenAuthorize();
    }).then(function (rec) {
      var txt = '已授权（AppID ' + (rec.appId || '-') + '）· access 约 2 小时 · refresh 1 年';
      set(txt); showToast('开放平台授权成功', 'success');
    }).catch(function (e) {
      var msg = (e && e.message) ? e.message : String(e);
      set('授权失败：' + msg); console.warn('[115授权]', msg); showToast('115 授权没成功，稍后再试一次', 'error');
    });
  }
  function pc115RefreshOpenStatus() {
    var el = document.getElementById('c115OpenStatusPc');
    if (!el) return;
    idbGet('kv', C115_OPEN_KEY).then(function (v) {
      if (!v || !v.access) { el.textContent = '未授权'; return; }
      var left = v.exp ? Math.max(0, Math.round((v.exp - Date.now()) / 60000)) : 0;
      el.textContent = '已授权（AppID ' + (v.appId || '-') + '）· token 剩余约 ' + left + ' 分钟';
    }).catch(function () { el.textContent = '未授权'; });
  }

  /* ---------- 取 Cookie ---------- */
  function ensure115Cookie() {
    if (state.c115Cookie) return Promise.resolve(state.c115Cookie);
    return idbGet('kv', C115_COOKIE_KEY).then(function (v) {
      var c = v ? ((typeof v === 'string') ? v : (v.cookie || '')) : '';
      if (c) state.c115Cookie = c;
      return c;
    }).catch(function () { return ''; });
  }

  /* ---------- 115 离线（磁力搜索一键离线，复用） ---------- */
  function c115Offline(magnet) {
    ensure115Cookie().then(function (cookie) {
      if (!cookie) { showToast('请先到「设置 → 115 网盘」登录', 'error'); return null; }
      showToast('正在添加到 115 离线下载…', 'info');
      var cid = C115_DEFAULT_DIR_CID;
      var body = 'url=' + encodeURIComponent((magnet || '').trim()) + '&wp_path_id=' + encodeURIComponent(cid);
      return c115ProxyFetch('https://115.com/web/lixian/?ct=lixian&ac=add_task_url', {
        method: 'POST',
        headers: { 'X-115-Cookie': cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body
      });
    }).then(function (res) {
      if (!res) return;
      var d = res.d || {};
      var ok = res.ok && (d.state === true || (d.data && (d.data.tid || d.data.task_id || d.data.infoid)));
      if (!ok && res.ok && d.errcode === 10008) { showToast('该任务已在 115 离线列表中', 'info'); return; }
      if (ok) showToast('已发送到 115 离线下载（默认目录）', 'success');
      else { var msg = (d.error || d.msg || (d.data && (d.data.error || d.data.msg))); if (!msg && res.raw) msg = res.raw; console.warn('[115离线]', msg); showToast('没能加到离线，稍后再试', 'error'); }
    }).catch(function (e) {
      var detail = (e && e.body) ? e.body.slice(0, 300) : '';
      console.warn('[115离线]', e, detail); showToast('网络不太顺，稍后再试', 'error');
    });
  }

  /* ---------- 自动化任务模型 ----------
     纯逻辑（步骤表/命名规则/季集解析/冲突决策）单点真相在 src/auto115-core.js（Auto115Core），
     本文件只留 API 调用（auto115Post/ListDir…）与 PC popover 渲染薄层。 */
  var AUTO115_PREFIX = 'auto115:';
  var AUTO115_PROBE_GAPS = Auto115Core.PROBE_GAPS;
  var AUTO115_PROBE_MAX = Auto115Core.PROBE_MAX;
  var AUTO115_DIR_SLACK_MS = Auto115Core.DIR_SLACK_MS;
  var AUTO115_FLOW_VERSION = Auto115Core.FLOW_VERSION;
  var AUTO115_STEP_DEFS = Auto115Core.STEP_DEFS;
  var AUTO115_STEPS_TV = Auto115Core.STEPS_TV;
  var AUTO115_STEPS_UPLOAD = Auto115Core.STEPS_UPLOAD;
  var AUTO115_STEP_TABLE = Auto115Core.STEP_TABLE;
  function auto115TaskType(t) { return Auto115Core.taskType(t); }
  function auto115IsTvTask() { return !!(auto115Doc && auto115Doc.type === 'tv'); }
  function auto115StepDefs(t) {
    if (auto115IsTvTask()) return AUTO115_STEPS_TV;
    return AUTO115_STEP_TABLE[auto115TaskType(t)] || AUTO115_STEP_DEFS;
  }
  function auto115TaskTitle(t) {
    if (auto115TaskType(t) === 'upload') return '上传 NFO';
    return (t && (t.magnetTitle || auto115Btih(t && t.magnet))) || '磁力任务';
  }
  var auto115Doc = null;
  var auto115ProbeTimer = null;
  var auto115Expanded = {};
  var auto115RunningId = '';
  var auto115LockAt = 0;                     // 拿到锁的时刻，用于识别「占着锁但没在跑」的脏锁
  var AUTO115_LOCK_GRACE = Auto115Core.LOCK_GRACE_MS;   // 宽限期：刚拿到锁的头 45s 允许还没跑到 running 步骤
  /* 僵尸步骤清理：某一步卡在 running 超过 10 分钟没动静（关页面/断网/请求挂起会留下这种状态），
     它会被当成「任务还在跑」，导致执行锁不释放、别的任务永远排不上队。这里统一判死，让用户能重试。 */
  var AUTO115_ZOMBIE_MS = Auto115Core.ZOMBIE_MS;
  function auto115SweepZombies() {
    var ts = (auto115Doc && auto115Doc.tasks) || [];
    var now = Date.now(), changed = false;
    for (var i = 0; i < ts.length; i++) {
      var t = ts[i];
      if (!t || t.aborted) continue;
      var steps = t.steps || [];
      for (var j = 0; j < steps.length; j++) {
        var s = steps[j];
        if (Auto115Core.isZombieStep(s, now)) {
          s.state = 'fail'; s.msg = '这一步长时间没响应，点「重试」继续';
          changed = true;
        }
      }
    }
    if (changed) { auto115Save(); pc115RenderAuto(); pc115UpdateBadge(); }
    return changed;
  }
  function auto115HoldLock(t) { auto115RunningId = t.id; auto115LockAt = Date.now(); }
  function auto115ReleaseLock() { auto115RunningId = ''; auto115LockAt = 0; }
  /* 脏锁清理：锁指向的任务不存在 / 已中止 / 已终态 / 超过宽限期仍无任何 running 步骤 → 释放。
     最后一条是「卡在待提交」的根因：任务拿到锁后卡在读 Cookie 等异步环节，步骤迟迟不 running。 */
  function auto115ClearDirtyLock() {
    if (!auto115RunningId) return;
    var cur = auto115Task(auto115RunningId);
    if (!cur || cur.aborted) { auto115ReleaseLock(); return; }
    if (auto115IsActive(cur)) return;
    var st = auto115Status(cur);
    if (st.cls === 'ab-ok' || st.cls === 'ab-fail') { auto115ReleaseLock(); return; }
    if (Date.now() - auto115LockAt > AUTO115_LOCK_GRACE) auto115ReleaseLock();
  }
  /* 自愈：没有任何任务在跑时，把最早一条待开始（排队中/待提交）的任务拉起来，避免永远停摆 */
  function auto115KickStuck() {
    if (!auto115Doc) return;
    auto115SweepZombies();                          // 先清僵尸（可能把占锁任务的 running 步骤判死）
    if (auto115RunningId) auto115ClearDirtyLock();  // 僵尸清完后锁往往就变脏了，顺带释放
    if (auto115RunningId) return;
    var ts = auto115Doc.tasks || [];
    for (var k = 0; k < ts.length; k++) if (auto115IsActive(ts[k])) return;  // 有任务在跑就不抢，防并发串档
    var target = null;
    for (var i = ts.length - 1; i >= 0; i--) {
      if (ts[i] && ts[i].queued && !ts[i].aborted) { target = ts[i]; break; }
    }
    if (!target) {
      for (var j = ts.length - 1; j >= 0; j--) {
        var x = ts[j];
        if (x && !x.aborted && auto115Status(x).cls === 'ab-idle') { target = x; break; }
      }
    }
    if (!target) return;
    target.queued = false;
    auto115Run(target);
  }

  function auto115Key(filmId) { return AUTO115_PREFIX + filmId; }
  function auto115Now() { return Date.now(); }
  function auto115Time(ts) { return Auto115Core.timeFmt(ts); }
  function auto115Btih(magnet) { return Auto115Core.btih(magnet); }
  function auto115NewSteps(type) { return Auto115Core.newSteps(type, auto115IsTvTask()); }
  function auto115Size(n) { return Auto115Core.sizeFmt(n); }
  function auto115ErrText(d, res, fallback) { return Auto115Core.errText(d, res, fallback); }
  function auto115EnsureDoc() {
    var film = currentDetailFilm;
    if (!film) return Promise.reject(new Error('未打开影片'));
    var d = film.data || {};
    var isTv = (state.tmdbMediaType === 'tv') || (d.media_type === 'tv') || (d.tmdbMediaType === 'tv');
    var dvdId = (d.dvdId || d.content_id || (d.originaltitle && /[A-Za-z]/.test(d.originaltitle) && /\d/.test(d.originaltitle) ? d.originaltitle : '') || '').toString().trim();
    var year = (d.year || (d.premiered || '').slice(0, 4) || '').toString().trim();
    if (!auto115Doc) {
      auto115Doc = { filmId: film.id, filmTitle: d.title || '', dvdId: dvdId, originalTitle: d.originaltitle || '', year: year, type: isTv ? 'tv' : 'movie', tasks: [] };
    } else {
      auto115Doc.filmId = film.id;
      auto115Doc.filmTitle = d.title || auto115Doc.filmTitle || '';
      auto115Doc.dvdId = dvdId || auto115Doc.dvdId || '';
      auto115Doc.originalTitle = d.originaltitle || '';
      auto115Doc.year = year || auto115Doc.year || '';
      auto115Doc.type = isTv ? 'tv' : (auto115Doc.type || 'movie');
    }
    return idbGet('kv', auto115Key(film.id)).then(function (v) {
      if (v && v.tasks) {
        var uploadKeys = {};
        for (var k = 0; k < AUTO115_STEPS_UPLOAD.length; k++) uploadKeys[AUTO115_STEPS_UPLOAD[k].key] = 1;
        for (var i = 0; i < v.tasks.length; i++) {
          var tt = v.tasks[i];
          if (tt.type === 'upload' && tt.steps) tt.steps = tt.steps.filter(function (s) { return uploadKeys[s.key]; });
          if (tt.fv !== AUTO115_FLOW_VERSION) {
            tt.fv = AUTO115_FLOW_VERSION;
            tt.steps = auto115NewSteps();
            delete tt.offlineDirCid; delete tt.offlineDirName;
            delete tt.videoFid; delete tt.videoName; delete tt.videoSize; delete tt.noFolder; delete tt.finalDirCid; delete tt.finalDirName;
            tt.aborted = false;
          }
        }
        // ⚠️ 不能直接 auto115Doc.tasks = v.tasks：会把内存里刚创建/正在跑的任务对象换成反序列化副本，
        // 执行器手里还是旧引用 → 请求照发（115 里确实存进去了），进度却写到孤儿对象上，界面永远「待提交」。
        auto115Doc.tasks = auto115MergeTasks(auto115Doc.tasks || [], v.tasks || []);
        auto115Doc.filmTitle = d.title || v.filmTitle || auto115Doc.filmTitle || '';
        auto115Doc.dvdId = dvdId || v.dvdId || auto115Doc.dvdId || '';
        auto115Doc.originalTitle = d.originaltitle || v.originalTitle || '';
        auto115Doc.year = year || v.year || auto115Doc.year || '';
        auto115Doc.type = isTv ? 'tv' : (v.type || auto115Doc.type || 'movie');
      }
      return auto115Doc;
    }).catch(function () { return auto115Doc; });
  }
  /* 合并任务列表：单点实现在 Auto115Core.mergeTasks（内存任务保持原引用，只补库里有、内存没有的）。 */
  function auto115MergeTasks(memTasks, savedTasks) { return Auto115Core.mergeTasks(memTasks, savedTasks); }
  function auto115Save() {
    if (!auto115Doc) return Promise.resolve();
    return idbPut('kv', auto115Key(auto115Doc.filmId), auto115Doc).catch(function () {});
  }
  function auto115Task(id) {
    if (!auto115Doc) return null;
    var ts = auto115Doc.tasks || [];
    for (var i = 0; i < ts.length; i++) if (ts[i].id === id) return ts[i];
    return null;
  }
  function auto115GetStep(t, key) { return Auto115Core.getStep(t, key); }
  function auto115Set(t, key, stt, msg) {
    var s = auto115GetStep(t, key);
    s.state = stt; s.msg = msg || '';
    if (stt !== 'idle' && stt !== 'running') s.at = auto115Now();
    else if (!s.at) s.at = auto115Now();
    pc115RenderAuto(); auto115Save();
    return s;
  }
  function auto115Finish(t) { t.updatedAt = auto115Now(); pc115RenderAuto(); auto115Save(); pc115UpdateBadge(); auto115AdvanceQueue(t); }

  /* ---------- 大状态合成（纯逻辑在 Auto115Core.status，isTv 由当前影片详情判定） ---------- */
  function auto115StepLabel(key) { return Auto115Core.stepLabel(key); }
  function auto115Status(t) { return Auto115Core.status(t, auto115IsTvTask()); }
  /* 任务是否真的在跑：只要有任一步骤处于 running 就算活跃 */
  function auto115IsActive(t) { return Auto115Core.isActive(t); }

  /* ---------- PC popover 渲染 ---------- */
  function pc115RenderAuto() {
    var listEl = document.getElementById('pcAutoPanel');
    var emptyEl = document.getElementById('pcAutoEmpty');
    var titleEl = document.getElementById('pcAutoFilmTitle');
    var tipEl = document.getElementById('pcAutoLoginTip');
    if (!listEl || !auto115Doc) return;
    if (titleEl) titleEl.textContent = (auto115Doc.type === 'tv' ? '剧集：' : '目标：') + (auto115Doc.dvdId || auto115Doc.filmTitle || '未命名');
    var tvTag = document.getElementById('pcAutoTvTag');
    if (tvTag) tvTag.style.display = (auto115Doc.type === 'tv') ? '' : 'none';
    var tasks = auto115Doc.tasks || [];
    if (emptyEl) emptyEl.style.display = tasks.length ? 'none' : '';
    if (tipEl) tipEl.style.display = (state.c115Cookie ? 'none' : '');
    var html = '';
    listEl.innerHTML = html + tasks.map(auto115TaskHtml).join('');
    var clearBtn = document.getElementById('pcAutoClearBtn');
    if (clearBtn) clearBtn.style.display = tasks.some(function (t) { return auto115Status(t).cls === 'ab-ok'; }) ? '' : 'none';
    var uploadBtn = document.getElementById('pcAutoUploadBtn');
    if (uploadBtn) uploadBtn.style.display = tasks.some(function (t) { return auto115TaskType(t) === 'upload'; }) ? 'none' : '';
    pc115UpdateBadge();
  }
  function pc115UpdateBadge() {
    var el = document.getElementById('pcAutoBadge');
    if (!el) return;
    var cls = '';
    if (auto115Doc && (auto115Doc.tasks || []).length) {
      var ts = auto115Doc.tasks, hasFail = false, hasActive = false, allDone = true;
      for (var i = 0; i < ts.length; i++) {
        var c = auto115Status(ts[i]).cls;
        if (c === 'ab-fail') hasFail = true;
        if (c === 'ab-run' || c === 'ab-wait' || c === 'ab-idle') hasActive = true;
        if (c !== 'ab-ok') allDone = false;
      }
      if (hasFail) cls = 'auto-badge-red';
      else if (hasActive) cls = 'auto-badge-run';
      else if (allDone) cls = 'auto-badge-ok';
    }
    el.textContent = '';
    el.className = cls ? ('auto-badge ' + cls) : 'auto-badge';
    el.style.display = cls ? '' : 'none';
  }
  function auto115StepHtml(t, s) {
    var label = auto115StepLabel(s.key);
    if (s.state === 'running') label += '…';
    var dot = (s.state === 'ok') ? '✓' : (s.state === 'fail') ? '!' : (s.state === 'skip') ? '–' : '';
    var ops = '';
    if (s.state === 'fail') ops = '<button class="as-op-retry" onclick="auto115RetryStep(\'' + t.id + '\',\'' + s.key + '\')">重试</button>';
    if (s.key === 'wait' && s.state === 'waiting') {
      ops = '<button class="as-op-retry" onclick="auto115ContinueProbe(\'' + t.id + '\')">继续探测</button>'
        + '<button class="as-op-ghost" onclick="auto115RetryStep(\'' + t.id + '\',\'submit\')">重新提交</button>';
    }
    if (s.key === 'wait' && s.state === 'running') ops = '<button class="as-op-ghost" onclick="auto115Abort(\'' + t.id + '\')">中止</button>';
    return '<div class="auto-step">'
      + '<div class="as-dot ' + s.state + '">' + dot + '</div>'
      + '<div class="as-body">'
      + '<div class="as-label' + (s.state === 'idle' ? ' dim' : '') + '">' + escapeHtml(label)
      + (s.at ? '<span class="as-time">' + auto115Time(s.at) + '</span>' : '') + '</div>'
      + (s.msg ? '<div class="as-msg' + (s.state === 'fail' ? ' err' : '') + '">' + escapeHtml(s.msg) + '</div>' : '')
      + (ops ? '<div class="as-ops">' + ops + '</div>' : '')
      + '</div></div>';
  }
  function auto115TaskHtml(t) {
    var st = auto115Status(t);
    var expanded = !!auto115Expanded[t.id];
    var html = '<div class="auto-task' + (expanded ? ' expanded' : '') + '">'
      + '<div class="auto-task-head" onclick="auto115Toggle(\'' + t.id + '\')">'
      + '<div class="auto-task-title">' + escapeHtml(auto115TaskTitle(t)) + '</div>'
      + '<span class="auto-task-badge ' + st.cls + '">' + escapeHtml(st.text) + '</span>'
      + (st.cls === 'ab-idle'
        ? '<button type="button" class="auto-task-start" onclick="event.stopPropagation();auto115ForceStart(\'' + t.id + '\')">开始</button>'
        : '')
      + '<svg class="auto-task-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>'
      + '</div>';
    if (expanded) {
      var renderSteps = (t.steps || []).slice();
      if (auto115TaskType(t) === 'upload') {
        var uploadKeys = {};
        for (var k = 0; k < AUTO115_STEPS_UPLOAD.length; k++) uploadKeys[AUTO115_STEPS_UPLOAD[k].key] = 1;
        renderSteps = renderSteps.filter(function (s) { return uploadKeys[s.key]; });
      }
      var startOp = (st.cls === 'ab-idle')
        ? '<button type="button" class="op-start" onclick="auto115ForceStart(\'' + t.id + '\')">开始</button>' : '';
      html += '<div class="auto-steps">' + renderSteps.map(function (s) { return auto115StepHtml(t, s); }).join('') + '</div>'
        + '<div class="auto-task-ops">'
        + startOp
        + '<button type="button" onclick="auto115RetryTask(\'' + t.id + '\')">重试</button>'
        + '<button type="button" onclick="auto115RemoveTask(\'' + t.id + '\')">删除</button>'
        + '</div>';
    }
    return html + '</div>';
  }
  function auto115Toggle(id) { if (auto115Expanded[id]) delete auto115Expanded[id]; else auto115Expanded[id] = true; pc115RenderAuto(); }

  /* ---------- 115 接口封装 ---------- */
  function auto115Post(url, body) {
    return c115ProxyFetch(url, {
      method: 'POST',
      headers: { 'X-115-Cookie': state.c115Cookie || '', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    });
  }
  function auto115ListDir(cid, sort) {
    var url = 'https://webapi.115.com/files?cid=' + encodeURIComponent(cid) + '&offset=0&limit=200&show_dir=1';
    if (sort) url += '&o=' + sort + '&asc=0';
    return c115ProxyFetch(url, { headers: { 'X-115-Cookie': state.c115Cookie || '' } }).then(function (res) {
      var d = res.d || {};
      var list = d.data || d.files || [];
      return Array.isArray(list) ? list : [];
    });
  }
  function auto115ItemTime(it) {
    var v = it && (it.t != null ? it.t : (it.pt != null ? it.pt : ''));
    if (Array.isArray(v)) v = v[0];
    var n = Number(v);
    if (!isFinite(n) || n <= 0) { var p = Date.parse(v); return isFinite(p) ? p : 0; }
    return n < 1e12 ? n * 1000 : n;
  }
  function auto115IsVideoName(n) { return Auto115Core.isVideoName(n); }
  function auto115FindDir(parentCid, name) {
    return auto115ListDir(parentCid).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var it = list[i];
        if ((it.n || it.name) === name) return { cid: (it.cid || it.fid || '').toString(), name: name };
      }
      return null;
    });
  }
  function auto115QueryTask(t) {
    return auto115Post('https://115.com/web/lixian/?ct=lixian&ac=task_lists', 'page=1&page_row=100').then(function (res) {
      var d = res.d || {};
      var tasks = d.tasks || (d.data && d.data.tasks) || [];
      var hash = (t.infoHash || '').toUpperCase();
      var found = null;
      for (var i = 0; i < tasks.length; i++) {
        var x = tasks[i];
        var xh = ((x.info_hash || x.infohash || x.hash || '') + '').toUpperCase();
        if (hash && xh && xh === hash) { found = x; break; }
        if (!found && t.offlineName && x.name === t.offlineName) found = x;
      }
      if (!found) return null;
      var percent = (found.percentDone != null) ? found.percentDone : (found.percent != null ? found.percent : null);
      var status = found.status;
      var done = (percent === 100 || status === 2 || status === '2' || status === 'complete' || status === '已完成');
      var failed = (status === 3 || status === '3' || status === -1 || status === '-1' || status === 'failed' || status === '失败');
      return { done: !!done, failed: !!failed, percent: percent, name: found.name || '', msg: found.error_msg || found.msg || '', cid: (found.cid || found.dir_id || found.wp_path_id || '').toString() };
    });
  }

  /* ---------- 六步执行器 ---------- */
  function auto115Run(t) {
    if (!t) return Promise.resolve(null);
    /* 引用兜底：doc 被重新加载过时换回 doc 里当前那条；doc 里没有就收编回来，避免进度写进孤儿对象 */
    var live = auto115Task(t.id);
    if (live) t = live;
    else if (auto115Doc && auto115Doc.tasks && t.id) auto115Doc.tasks.unshift(t);
    auto115ClearDirtyLock();
    if (auto115RunningId && auto115RunningId !== t.id) {
      var cur = auto115Task(auto115RunningId);
      if (cur && (auto115IsActive(cur) || Date.now() - auto115LockAt <= AUTO115_LOCK_GRACE)) {
        t.queued = true;
        auto115Set(t, auto115StepDefs(t)[0].key, 'idle', '排队中：等「' + (cur.magnetTitle || '当前任务') + '」完成');
        auto115Save(); pc115RenderAuto(); pc115UpdateBadge();
        return Promise.resolve(null);
      }
      auto115ReleaseLock();
    }
    auto115HoldLock(t);
    t.queued = false;
    return ensure115Cookie().then(function (ck) {
      if (!ck) { auto115Set(t, auto115StepDefs(t)[0].key, 'fail', '还没登录 115'); auto115Finish(t); return null; }
      return (auto115TaskType(t) === 'upload') ? auto115StepUploadDir(t) : auto115StepSubmit(t);
    }).catch(function (e) {
      auto115Set(t, auto115StepDefs(t)[0].key, 'fail', (e && e.message) ? e.message : '启动失败');
      auto115Finish(t); return null;
    });
  }
  function auto115AdvanceQueue(t) {
    if (auto115RunningId && (!t || t.id === auto115RunningId)) auto115ReleaseLock();
    auto115ClearDirtyLock();
    auto115KickStuck();
  }
  function auto115StepSubmit(t) {
    auto115Set(t, 'submit', 'running', '正在提交到 115 云下载…');
    var body = 'url=' + encodeURIComponent(t.magnet) + '&wp_path_id=' + encodeURIComponent(C115_DEFAULT_DIR_CID);
    return auto115Post('https://115.com/web/lixian/?ct=lixian&ac=add_task_url', body).then(function (res) {
      var d = res.d || {};
      if (res.ok && (d.state === true || d.errcode === 10008 || (d.data && d.data.info_hash))) {
        t.infoHash = ((d.info_hash || (d.data && d.data.info_hash) || auto115Btih(t.magnet)) || '').toUpperCase();
        t.offlineName = d.name || (d.data && d.data.name) || t.magnetTitle || '';
        auto115Set(t, 'submit', 'ok', d.errcode === 10008 ? '任务已在 115 列表中（复用）' : '已提交到云下载');
        return auto115StepWait(t, true);
      }
      auto115Set(t, 'submit', 'fail', auto115ErrText(d, res, '提交失败'));
      auto115Finish(t); return null;
    }).catch(function (e) { auto115Set(t, 'submit', 'fail', (e && e.message) ? e.message : '网络错误'); auto115Finish(t); return null; });
  }
  function auto115StepWait(t, reset) {
    var s = auto115Set(t, 'wait', 'running', '正在查询离线状态…');
    if (reset) s.probes = 0;
    return auto115QueryTask(t).then(function (info) {
      if (!info) {
        s.probes = (s.probes || 0) + 1;
        if (s.probes >= AUTO115_PROBE_MAX) { auto115Set(t, 'wait', 'waiting', '已探测 ' + s.probes + ' 次，任务暂未出现在列表'); auto115Finish(t); return null; }
        s.msg = '任务暂未出现（' + s.probes + '/' + AUTO115_PROBE_MAX + '）';
        auto115Finish(t); auto115ScheduleProbe(t); return null;
      }
      if (info.done) {
        t.offlineName = info.name || t.offlineName;
        auto115Set(t, 'wait', 'ok', '离线完成' + (info.percent != null ? '（' + info.percent + '%）' : ''));
        return auto115StepMkdir(t);
      }
      if (info.failed) { console.warn('[115离线]', info.msg); auto115Set(t, 'wait', 'fail', '115 那边下载失败了'); auto115Finish(t); return null; }
      s.probes = (s.probes || 0) + 1;
      if (s.probes >= AUTO115_PROBE_MAX) { auto115Set(t, 'wait', 'waiting', '已探测 ' + s.probes + ' 次，进度 ' + (info.percent != null ? info.percent + '%' : '未知')); auto115Finish(t); return null; }
      s.msg = '离线中 ' + (info.percent != null ? info.percent + '% ' : '') + '（' + s.probes + '/' + AUTO115_PROBE_MAX + '）';
      pc115RenderAuto(); auto115Save(); auto115ScheduleProbe(t); return null;
    }).catch(function (e) { auto115Set(t, 'wait', 'fail', (e && e.message) ? e.message : '网络错误'); auto115Finish(t); return null; });
  }
  function auto115StepMkdir(t) {
    auto115Set(t, 'mkdir', 'running', '正在定位离线落地的文件夹…');
    return auto115ListDir(C115_DEFAULT_DIR_CID, 'user_ptime').then(function (list) {
      var folders = list.filter(function (it) { return it && it.cid && !it.fid; });
      var files = list.filter(function (it) { return it && it.fid; });
      var dir = null, f = null, i;
      if (t.offlineName) {
        for (i = 0; i < folders.length; i++) { if ((folders[i].n || '') === t.offlineName) { dir = folders[i]; break; } }
      }
      if (!dir) {
        for (i = 0; i < folders.length; i++) { if (auto115ItemTime(folders[i]) >= t.createdAt - AUTO115_DIR_SLACK_MS) { dir = folders[i]; break; } }
      }
      if (dir) {
        var cid = String(dir.cid);
        if (cid === C115_DEFAULT_DIR_CID) { auto115Set(t, 'mkdir', 'fail', '没找到合适的文件夹'); auto115Finish(t); return null; }
        t.offlineDirCid = cid; t.offlineDirName = dir.n || '';
        auto115Set(t, 'mkdir', 'ok', '已定位文件夹：' + (dir.n || ''));
        /* 方案 B：先改容器（第 4 步 cleanup），再整理内容 */
        return auto115StepCleanup(t);
      }
      if (t.offlineName) {
        for (i = 0; i < files.length; i++) { if ((files[i].n || '') === t.offlineName) { f = files[i]; break; } }
      }
      if (!f) {
        for (i = 0; i < files.length; i++) { if (auto115ItemTime(files[i]) >= t.createdAt - AUTO115_DIR_SLACK_MS) { f = files[i]; break; } }
      }
      if (f) {
        t.noFolder = true;
        t.videoFid = String(f.fid); t.videoName = f.n || ''; t.videoSize = Number(f.s) || 0;
        auto115Set(t, 'mkdir', 'ok', '单文件落地（无文件夹）：' + t.videoName);
        /* 方案 B：noFolder 也要过 cleanup 步骤（TV 在此建剧集根；单影片标记跳过） */
        return auto115StepCleanup(t);
      }
      auto115Set(t, 'mkdir', 'fail', '还没找到刚下载的内容，稍等再看看'); auto115Finish(t); return null;
    }).catch(function (e) { auto115Set(t, 'mkdir', 'fail', (e && e.message) ? e.message : '网络错误'); auto115Finish(t); return null; });
  }

  /* ---------- 主视频筛选 / 影片命名 / 批量改名 ----------
     命名/解析纯逻辑单点真相在 Auto115Core，这里仅留转发包装。 */
  function auto115Norm(s) { return Auto115Core.norm(s); }
  function auto115PartBase(name) { return Auto115Core.partBase(name); }
  /* 影片命名规则：始终只取标题，番号仅用于 AV 视频改名（规则在 Auto115Core.movieVideoName） */
  function auto115MovieVideoName() { return Auto115Core.movieVideoName(auto115Doc); }
  function auto115LooksDvd(s) { return Auto115Core.looksDvd(s); }
  function auto115CleanName(s) { return Auto115Core.cleanName(s); }
  function auto115ExternalBaseName(t) { return Auto115Core.externalBaseName(t); }
  function auto115VidSize(it) { return Auto115Core.vidSize(it); }
  function auto115ApplyRenames(t, jobs, targetCid) {
    return jobs.reduce(function (p, job) {
      if (!job || !job.fid) return p;
      return p.then(function () {
        var chain = Promise.resolve();
        if (targetCid) chain = chain.then(function () { return auto115Post('https://webapi.115.com/files/move', 'fid=' + encodeURIComponent(job.fid) + '&pid=' + encodeURIComponent(targetCid)); });
        /* 文件名已符合规则（目标名 === 当前名）→ 跳过改名请求（move 照常执行） */
        if (job.orig != null && job.orig === job.name) return chain;
        return chain.then(function () {
          return auto115Post('https://webapi.115.com/files/edit', 'fid=' + encodeURIComponent(job.fid) + '&file_name=' + encodeURIComponent(job.name));
        }).then(function (res) {
          var d = res.d || {};
          if (!(res.ok && (d.state === true || d.errno === 0))) throw new Error('改名失败');
        });
      });
    }, Promise.resolve());
  }
  /* ============ 剧集（TV）离线分支 ============
     命名/季集解析/字幕语言的纯逻辑单点真相在 Auto115Core，这里仅留转发包装。 */
  function auto115CnNum(s) { return Auto115Core.cnNum(s); }
  function auto115EpisodeOf(name) { return Auto115Core.episodeOf(name); }
  function auto115Ext(name) { return Auto115Core.ext(name); }
  function auto115Pad2(n) { return Auto115Core.pad2(n); }
  function auto115IsSubtitle(name) { return Auto115Core.isSubtitle(name); }
  function auto115SubLang(name) { return Auto115Core.subLang(name); }
  function auto115TvDirName(showTitle) { return Auto115Core.tvDirName(showTitle); }
  function auto115TvVideoName(showTitle, season, ep, ext) { return Auto115Core.tvVideoName(showTitle, season, ep, ext); }
  function auto115TvSubName(showTitle, season, ep, lang, ext) { return Auto115Core.tvSubName(showTitle, season, ep, lang, ext); }
  /* 整理计划（识别季集号、字幕语言、待删清单）单点实现在 Auto115Core.tvPlan。 */
  function auto115TvPlan(showTitle, items) { return Auto115Core.tvPlan(showTitle, items); }
  /* 是否分季（阈值判定）单点实现在 Auto115Core.tvNeedSeasonSplit；阈值常量 SPLIT_MIN_EPISODES 也在 core。 */
  var AUTO115_SPLIT_MIN_EPISODES = Auto115Core.SPLIT_MIN_EPISODES;
  function auto115TvNeedSeasonSplit(plan) { return Auto115Core.tvNeedSeasonSplit(plan); }
  function auto115EnsureSeasonFolder(rootCid, season){
    var name = 'S' + auto115Pad2(season);
    return auto115FindDir(rootCid, name).then(function (d) {
      if (d) return d.cid;
        return auto115Post('https://webapi.115.com/files/add', 'pid=' + encodeURIComponent(rootCid) + '&cname=' + encodeURIComponent(name)).then(function (res) {
          var dd = res.d || {}, ddd = dd.data || {};
          var cid = String(ddd.cid || ddd.file_id || ddd.id || dd.cid || res.cid || '');
          if (!res.ok || !(dd.state === true || dd.errno === 0)) throw new Error(auto115ErrText(dd, res, '创建 ' + name + ' 失败'));
          if (!cid) throw new Error('创建 ' + name + ' 没拿到 cid');
          return cid;
        });
    });
  }
  function auto115EnsureTvRoot(showTitle){
    var name = auto115TvDirName(showTitle);
    return auto115FindDir(C115_DEFAULT_DIR_CID, name).then(function (d) {
      if (d) return d.cid;
      return auto115Post('https://webapi.115.com/files/add', 'pid=' + encodeURIComponent(C115_DEFAULT_DIR_CID) + '&cname=' + encodeURIComponent(name)).then(function (res) {
        var dd = res.d || {}, ddd = dd.data || {};
        var cid = String(ddd.cid || ddd.file_id || ddd.id || dd.cid || res.cid || '');
        if (!res.ok || !(dd.state === true || dd.errno === 0)) throw new Error(auto115ErrText(dd, res, '创建 ' + name + ' 失败'));
        if (!cid) throw new Error('创建 ' + name + ' 没拿到 cid');
        return cid;
      });
    });
  }
  function auto115StepTvGetItems(t){
    if (t.noFolder) return Promise.resolve([{ fid: t.videoFid, name: t.videoName }]);
    return auto115ListDir(t.offlineDirCid).then(function (list) {
      return list.map(function (it) { return { fid: it.fid ? String(it.fid) : null, name: it.n || it.name || '', cid: (it.cid || '').toString() }; }).filter(function (it) { return (it.fid || it.cid) && it.name; });
    });
  }
  function auto115StepTvCleanupFiles(t){
    auto115Set(t, 'move', 'running', '正在识别并清除无关文件…');
    if (!t.offlineDirCid && !t.noFolder){ auto115Set(t, 'move', 'fail', '文件夹没定位到，点「重试」再试一次'); auto115Finish(t); return Promise.resolve(null); }
    return auto115StepTvGetItems(t).then(function (items) {
      var plan = auto115TvPlan(auto115Doc.filmTitle, items);
      if (!plan.renames.length){ auto115Set(t, 'move', 'fail', '没有可识别的视频文件，点「重试」'); auto115Finish(t); return null; }
      t.tvPlan = plan;
      var delIds = plan.deleteFids.filter(Boolean);
      if (!delIds.length){ auto115Set(t, 'move', 'ok', '没有无关文件，保留 ' + plan.renames.length + ' 个文件'); return auto115StepTvMkdirSeasons(t); }
      auto115Set(t, 'move', 'running', '保留 ' + plan.renames.length + ' 个文件，正在删除 ' + delIds.length + ' 项无关文件…');
      var parent = t.noFolder ? C115_DEFAULT_DIR_CID : t.offlineDirCid;
      return auto115DeleteBatch(parent, delIds).then(function (errMsg) {
        if (errMsg){ auto115Set(t, 'move', 'fail', errMsg); auto115Finish(t); return null; }
        auto115Set(t, 'move', 'ok', '已清除 ' + delIds.length + ' 项无关文件，保留 ' + plan.renames.length + ' 个文件');
        return auto115StepTvMkdirSeasons(t);
      });
    }).catch(function (e) { auto115Set(t, 'move', 'fail', (e && e.message) ? e.message : '网络错误'); auto115Finish(t); return null; });
  }
  function auto115StepTvRenameVideos(t){
    auto115Set(t, 'rename', 'running', '正在按 SxxExx 规则重命名视频/字幕…');
    var plan = t.tvPlan;
    if (!plan || !plan.renames.length){ auto115Set(t, 'rename', 'fail', '没有可重命名的文件'); auto115Finish(t); return Promise.resolve(null); }
    var needRename = plan.renames.filter(function (r) { return r.orig !== r.name; }).length;
    return auto115ApplyRenames(t, plan.renames, null).then(function () {
      if (!needRename) auto115Set(t, 'rename', 'ok', '文件名已符合规则，无需改名');
      else auto115Set(t, 'rename', 'ok', '已改名为：' + plan.renames[0].name + (plan.renames.length > 1 ? ' 等 ' + plan.renames.length + ' 个文件' : ''));
      return auto115StepTvMoveVideos(t);
    }).catch(function (e) { auto115Set(t, 'rename', 'fail', (e && e.message) ? e.message : '网络错误'); auto115Finish(t); return null; });
  }
  function auto115StepTvMkdirSeasons(t){
    auto115Set(t, 'mkdir2', 'running', '正在判断是否分季…');
    var plan = t.tvPlan;
    if (!plan || !plan.renames.length){ auto115Set(t, 'mkdir2', 'fail', '没有可整理的文件'); auto115Finish(t); return Promise.resolve(null); }
    var seasons = {};
    plan.renames.forEach(function (r) { var mm = r.name.match(/S(\d{2})E/); if (mm) seasons[mm[1]] = true; });
    var seasonNums = Object.keys(seasons).sort();
    if (!seasonNums.length){ auto115Set(t, 'mkdir2', 'fail', '未能识别季号'); auto115Finish(t); return Promise.resolve(null); }
    var need = auto115TvNeedSeasonSplit(plan);
    var flatName = t.finalDirName || auto115TvDirName(auto115Doc.filmTitle);
    if (!need.split){
      /* 不分季：文件统一放在剧集根文件夹（命名仍带 SxxExx），跳过建季文件夹 */
      t.tvFlat = true;
      t.tvSeasonMap = null;
      auto115Set(t, 'mkdir2', 'skip', need.reason + '，文件统一放在「' + flatName + '」');
      return auto115StepTvRenameVideos(t);
    }
    t.tvFlat = false;
    auto115Set(t, 'mkdir2', 'running', '正在新建季文件夹…');
    var parentPromise;
    if (t.tvRootCid) {
      /* 并入同名剧集夹（cleanup 阶段发现）或单文件剧集：季文件夹建在已确定的剧集根内 */
      parentPromise = Promise.resolve(t.tvRootCid);
    } else if (t.noFolder) {
      parentPromise = auto115EnsureTvRoot(auto115Doc.filmTitle).then(function (cid) { if (!cid) throw new Error('创建剧集根文件夹失败'); t.tvRootCid = cid; return cid; });
    } else {
      if (!t.offlineDirCid) parentPromise = Promise.reject(new Error('父文件夹没定位到'));
      else parentPromise = Promise.resolve(t.offlineDirCid);
    }
    return parentPromise.then(function (parent) {
      var p = Promise.resolve({});
      seasonNums.forEach(function (s) {
        p = p.then(function (map) {
          return auto115EnsureSeasonFolder(parent, parseInt(s, 10)).then(function (cid) {
            if (!cid) throw new Error('创建 S' + s + ' 失败');
            map[s] = cid; return map;
          });
        });
      });
      return p.then(function (map) {
        t.tvSeasonMap = map;
        auto115Set(t, 'mkdir2', 'ok', '已新建 ' + seasonNums.length + ' 个季文件夹：' + seasonNums.map(function (s) { return 'S' + s; }).join('、'));
        return auto115StepTvRenameVideos(t);
      });
    }).catch(function (e) { auto115Set(t, 'mkdir2', 'fail', (e && e.message) ? e.message : '网络错误'); auto115Finish(t); return null; });
  }
  /* 把一批已改好名的文件移入目标文件夹：目标里已有同名文件时——大小相同视为同一文件直接跳过，
     大小不同则目标名加 .2 避免撞名。返回 Promise<{moved, skipped}> */
  function auto115MoveInto(t, jobs, targetCid){
    var res = { moved: 0, skipped: 0 };
    return auto115ListDir(targetCid).then(function (list) {
      /* 冲突决策（同名同大小跳过 / 不同加 .2）单点实现在 Auto115Core.planMoveJobs */
      var plan = Auto115Core.planMoveJobs(jobs, list || []);
      res.skipped = plan.skipped;
      var todo = plan.todo;
      res.moved = todo.length;
      if (!todo.length) return res;
      return auto115ApplyRenames(t, todo, targetCid).then(function () { return res; });
    });
  }
  function auto115StepTvMoveVideos(t){
    auto115Set(t, 'move2', 'running', '正在整理文件位置…');
    var plan = t.tvPlan, map = t.tvSeasonMap;
    if (!plan){ auto115Set(t, 'move2', 'fail', '缺少整理计划'); auto115Finish(t); return Promise.resolve(null); }
    var flatName = t.finalDirName || auto115TvDirName(auto115Doc.filmTitle);
    /* 不分季模式：文件平铺在剧集根文件夹（命名仍带 SxxExx）；
       只有当它们现在不在剧集根里（单文件落地 / 并入同名剧集夹）才需要移动 */
    if (t.tvFlat){
      var curParent = t.noFolder ? C115_DEFAULT_DIR_CID : t.offlineDirCid;
      var flatTarget = t.tvRootCid || curParent;
      if (!flatTarget || flatTarget === curParent || !plan.renames.length){
        auto115Set(t, 'move2', 'skip', '文件已在「' + flatName + '」内，无需移动');
        auto115Finish(t);
        return Promise.resolve(null);
      }
      var flatJobs = plan.renames.map(function (r) { return { fid: r.fid, name: r.name, orig: r.name, size: r.size }; });
      return auto115MoveInto(t, flatJobs, flatTarget).then(function (res) {
        auto115Set(t, 'move2', 'ok', '已把 ' + res.moved + ' 个文件放到「' + flatName + '」'
          + (res.skipped ? ('（跳过 ' + res.skipped + ' 个已存在的相同文件）') : ''));
        auto115Finish(t);
        if (t.tvMergeCid || t.noFolder) return auto115RemoveTmpDir(t).then(function () { return null; });
        return Promise.resolve(null);
      }).catch(function (e) { auto115Set(t, 'move2', 'fail', (e && e.message) ? e.message : '网络错误'); auto115Finish(t); return null; });
    }
    if (!map){ auto115Set(t, 'move2', 'fail', '缺少季文件夹信息'); auto115Finish(t); return Promise.resolve(null); }
    var bySeason = {};
    plan.renames.forEach(function (r) {
      var mm = r.name.match(/S(\d{2})E/);
      if (!mm) return;
      var s = mm[1], cid = map[s];
      if (cid) { (bySeason[s] = bySeason[s] || []).push({ fid: r.fid, name: r.name, orig: r.name, size: r.size }); }
    });
    var seasonKeys = Object.keys(bySeason);
    if (!seasonKeys.length){ auto115Set(t, 'move2', 'fail', '没有可移动的文件'); auto115Finish(t); return Promise.resolve(null); }
    /* 逐季移入：季夹里已有同名文件时——大小相同视为同一文件跳过，大小不同加 .2 避免撞名 */
    var moved = 0, skipped = 0;
    var p = Promise.resolve();
    seasonKeys.forEach(function (s) {
      p = p.then(function () {
        return auto115MoveInto(t, bySeason[s], map[s]).then(function (res) { moved += res.moved; skipped += res.skipped; });
      });
    });
    return p.then(function () {
      auto115Set(t, 'move2', 'ok', '已移入 ' + moved + ' 个文件到对应季文件夹' + (skipped ? ('（跳过 ' + skipped + ' 个已存在的相同文件）') : ''));
      auto115Finish(t);
      /* 并入同名剧集夹场景：临时离线夹里的文件已全部处理，删除临时夹 */
      if (t.tvMergeCid) {
        return auto115RemoveTmpDir(t).then(function () { return null; });
      }
      return Promise.resolve(null);
    }).catch(function (e) { auto115Set(t, 'move2', 'fail', (e && e.message) ? e.message : '网络错误'); auto115Finish(t); return null; });
  }
  /* 「修改标题文件夹」（方案 B 第 4 步）已并入 auto115StepCleanup 的 TV 分支。 */
  function auto115StepMove(t) {
    if (t.noFolder) { auto115Set(t, 'move', 'skip', '单文件落地，无需清理'); return auto115StepRename(t); }
    if (!t.offlineDirCid || t.offlineDirCid === C115_DEFAULT_DIR_CID) { auto115Set(t, 'move', 'fail', '文件夹没定位到，点「重试」再试一次'); auto115Finish(t); return Promise.resolve(null); }
    auto115Set(t, 'move', 'running', '正在扫描文件夹内容…');
    return auto115ListDir(t.offlineDirCid).then(function (list) {
      var vids = list.filter(function (it) { return it && it.fid && auto115IsVideoName(it.n || it.name || ''); });
      if (!vids.length) { auto115Set(t, 'move', 'fail', '这个文件夹里没有视频'); auto115Finish(t); return null; }
      var EXCLUDE = /sample|预告|trailer|preview|特典|extra|花絮|menu|bonus/i;
      var mainCands = vids.filter(function (it) { return !EXCLUDE.test(it.n || it.name || ''); });
      var pool = mainCands.length ? mainCands : vids;
      var normDvd = auto115Norm(auto115Doc.dvdId);
      var normTitles = [auto115Norm(auto115Doc.filmTitle), auto115Norm(auto115Doc.originalTitle)].filter(Boolean);
      function strongHit(it) {
        var nm = auto115Norm(it.n || it.name || '');
        if (normDvd && nm.indexOf(normDvd) >= 0) return true;
        if (!normDvd && normTitles.length) { for (var j = 0; j < normTitles.length; j++) { if (normTitles[j] && nm.indexOf(normTitles[j]) >= 0) return true; } }
        return false;
      }
      var keep;
      var strong = pool.filter(strongHit);
      if (strong.length) keep = strong;
      else {
        var groups = {};
        pool.forEach(function (it) { var b = auto115PartBase(it.n || it.name || ''); (groups[b] = groups[b] || []).push(it); });
        var partKeys = Object.keys(groups).filter(function (b) { return groups[b].length >= 2; });
        if (partKeys.length) { keep = []; partKeys.forEach(function (b) { keep = keep.concat(groups[b]); }); }
        else keep = [pool.slice().sort(function (a, b) { return auto115VidSize(b) - auto115VidSize(a); })[0]];
      }
      keep.sort(function (a, b) { return auto115VidSize(b) - auto115VidSize(a); });
      t.keepFids = keep.map(function (it) { return String(it.fid); });
      var v = keep[0];
      t.videoFid = String(v.fid); t.videoName = v.n || v.name || ''; t.videoSize = auto115VidSize(v);
      var delIds = [];
      for (var i = 0; i < list.length; i++) {
        var it = list[i];
        if (!it) continue;
        if (it.fid) { if (t.keepFids.indexOf(String(it.fid)) < 0) delIds.push(String(it.fid)); }
        else if (it.cid) { if (String(it.cid) !== C115_DEFAULT_DIR_CID) delIds.push(String(it.cid)); }
      }
      if (!delIds.length) { auto115Set(t, 'move', 'ok', '只有 ' + keep.length + ' 个视频，无需清理'); return auto115StepRename(t); }
      auto115Set(t, 'move', 'running', '保留 ' + keep.length + ' 个视频，正在删除其余 ' + delIds.length + ' 项…');
      return auto115DeleteBatch(t.offlineDirCid, delIds).then(function (errMsg) {
        if (errMsg) { auto115Set(t, 'move', 'fail', errMsg); auto115Finish(t); return null; }
        auto115Set(t, 'move', 'ok', '已清理 ' + delIds.length + ' 项，保留 ' + keep.length + ' 个视频（' + auto115Size(t.videoSize) + '）');
        return auto115StepRename(t);
      });
    }).catch(function (e) { auto115Set(t, 'move', 'fail', (e && e.message) ? e.message : '网络错误'); auto115Finish(t); return null; });
  }
  function auto115DeleteBatch(parentCid, ids) {
    var chunks = [];
    for (var i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
    var p = Promise.resolve('');
    chunks.forEach(function (chunk) {
      p = p.then(function (err) {
        if (err) return err;
        var parts = [];
        for (var k = 0; k < chunk.length; k++) parts.push('fid[' + k + ']=' + encodeURIComponent(chunk[k]));
        parts.push('pid=' + encodeURIComponent(parentCid));
        return auto115Post('https://webapi.115.com/rb/delete', parts.join('&')).then(function (res) {
          var d = res.d || {};
          return (res.ok && (d.state === true || d.errno === 0)) ? '' : auto115ErrText(d, res, '删除失败');
        });
      });
    });
    return p;
  }
  function auto115FindMergeTarget(t) {
    var ts = (auto115Doc && auto115Doc.tasks) || [];
    for (var i = 0; i < ts.length; i++) {
      var p = ts[i];
      if (!p || p.id === t.id) continue;
      var dirCid = p.finalDirCid || p.offlineDirCid;
      var dirName = p.finalDirName || p.offlineDirName || '';
      if (p.noFolder || !dirCid || !dirName) continue;
      if (dirCid === t.offlineDirCid || dirCid === C115_DEFAULT_DIR_CID) continue;
      var sc = auto115GetStep(p, 'cleanup');
      if (sc.state === 'ok' || sc.state === 'skip') return { cid: dirCid, name: dirName };
    }
    return null;
  }
  function auto115StepRename(t) {
    if (auto115IsTvTask()) return auto115StepTvRenameVideos(t);
    if (t.external) {
      if (!t.targetName) { auto115Set(t, 'rename', 'skip', '未填目标名称，保留 115 原始文件名'); auto115Finish(t); return Promise.resolve(null); }
    }
    var ext = (/\.[a-z0-9]+$/i.exec(t.videoName || '') || ['.mp4'])[0];
    var baseName = t.external ? auto115ExternalBaseName(t) : (auto115Doc.dvdId ? auto115Doc.dvdId : auto115MovieVideoName());
    if (!baseName) { auto115Set(t, 'rename', 'fail', '缺少名称信息，没法自动改名'); auto115Finish(t); return Promise.resolve(null); }
    var keep = (t.keepFids && t.keepFids.length) ? t.keepFids.slice() : (t.videoFid ? [t.videoFid] : []);
    if (!keep.length) { auto115Set(t, 'rename', 'fail', '未定位到视频文件，请重试'); auto115Finish(t); return Promise.resolve(null); }
    var multi = keep.length > 1;
    var prev = t.external ? null : (t.forcedMergeCid ? { cid: t.forcedMergeCid, name: t.finalDirName } : auto115FindMergeTarget(t));
    if (prev) {
      t.finalDirCid = prev.cid;
      t.finalDirName = prev.name;
      auto115Set(t, 'rename', 'running', '并入文件夹「' + prev.name + '」…');
      return auto115ListDir(prev.cid).then(function (list) {
        var stems = {};
        for (var i = 0; i < list.length; i++) { var nm = String(list[i].n || ''); stems[nm.replace(/\.[a-z0-9]+$/i, '').toLowerCase()] = list[i].s || 0; }
        /* 目标夹已存在同目标名且大小相同的视频 → 同一文件（多为重试），直接清临时夹收尾 */
        if (!multi && keep.length === 1 && t.videoSize != null) {
          var dupSize = stems[(baseName + ext).toLowerCase()];
          if (dupSize != null && Math.abs((t.videoSize || 0) - dupSize) < 1) {
            t.videoName = baseName + ext;
            auto115Set(t, 'rename', 'ok', '视频已在「' + prev.name + '」中，跳过重复文件');
            return auto115RemoveTmpDir(t).then(function () { auto115Finish(t); return null; });
          }
        }
        var jobs = keep.map(function (fid, i) {
          var suffix = multi ? ('.cd' + (i + 1)) : '';
          var cand = baseName + suffix, k = 0;
          while (stems[cand.toLowerCase()] != null) {
            k++;
            if (k > 26) { auto115Set(t, 'rename', 'fail', '同名文件太多啦，去 115 手动整理一下'); auto115Finish(t); return null; }
            cand = baseName + '.' + String.fromCharCode(64 + k) + suffix;
          }
          return { fid: fid, name: cand + ext };
        });
        if (jobs.indexOf(null) >= 0) return null;
        return auto115ApplyRenames(t, jobs, prev.cid).then(function () {
          t.videoName = jobs[0].name;
          auto115Set(t, 'rename', 'ok', '已移入「' + prev.name + '」并改名为：' + jobs[0].name + (multi ? (' 等 ' + jobs.length + ' 个视频') : ''));
          return auto115RemoveTmpDir(t).then(function () { auto115Finish(t); return null; });
        });
      }).catch(function (e) { auto115Set(t, 'rename', 'fail', (e && e.message) ? e.message : '网络错误'); auto115Finish(t); return null; });
    }
    var jobs = keep.map(function (fid, i) {
      var suffix = multi ? ('.cd' + (i + 1)) : '';
      return { fid: fid, name: baseName + suffix + ext };
    });
    if (jobs.length) jobs[0].orig = t.videoName; /* 首个视频的当前名，供同名跳过比对 */
    var needRename = jobs.filter(function (j) { return j.orig == null || j.orig !== j.name; }).length;
    auto115Set(t, 'rename', 'running', needRename ? ('正在改名为：' + jobs[0].name + (multi ? (' 等 ' + jobs.length + ' 个视频') : '')) : '正在核对文件名…');
    return auto115ApplyRenames(t, jobs, null).then(function () {
      t.videoName = jobs[0].name;
      if (!needRename) auto115Set(t, 'rename', 'ok', '文件名已符合规则，无需改名');
      else auto115Set(t, 'rename', 'ok', '已改名为：' + jobs[0].name + (multi ? (' 等 ' + jobs.length + ' 个视频') : ''));
      return auto115RemoveTmpDir(t).then(function () { auto115Finish(t); return null; });
    }).catch(function (e) { auto115Set(t, 'rename', 'fail', (e && e.message) ? e.message : '网络错误'); auto115Finish(t); return null; });
  }
  /* 自动删除已并入的临时离线目录（不显示在 UI，rename 完成后静默触发）。
     失败也不回退——临时目录留着用户可以手动清，不影响主流程。 */
  function auto115RemoveTmpDir(t) {
    if (!t.finalDirCid || t.noFolder) return Promise.resolve();
    if (!t.offlineDirCid || t.offlineDirCid === C115_DEFAULT_DIR_CID || t.offlineDirCid === t.finalDirCid) return Promise.resolve();
    var delBody = 'fid=' + encodeURIComponent(t.offlineDirCid) + '&pid=' + encodeURIComponent(C115_DEFAULT_DIR_CID);
    return auto115Post('https://webapi.115.com/rb/delete', delBody).then(function (res) {
      var d = res.d || {};
      if (!(res.ok && (d.state === true || d.errno === 0))) showToast('临时目录未删，可手动清理：' + (t.offlineDirName || ''), 'info');
      return;
    }).catch(function () { /* 网络错误静默，不影响主流程 */ });
  }
  function auto115StepCleanup(t) {
    if (auto115IsTvTask()) {
      /* 剧集流程第 4 步（方案 B）：先把容器改成剧集标题；改完调 TvCleanupFiles（第 5 步） */
      var showTitle = auto115TvDirName(auto115Doc.filmTitle);
      if (t.noFolder) {
        /* 单文件剧集：离线没有落地文件夹，在这里把剧集根目录建好（后续建季/移入都用它） */
        return auto115EnsureTvRoot(auto115Doc.filmTitle).then(function (cid) {
          if (!cid) { auto115Set(t, 'cleanup', 'fail', '创建剧集根文件夹失败'); auto115Finish(t); return null; }
          t.tvRootCid = cid; t.finalDirCid = cid; t.finalDirName = showTitle;
          auto115Set(t, 'cleanup', 'ok', '剧集根目录「' + showTitle + '」就绪');
          return auto115StepTvCleanupFiles(t);
        }).catch(function (e) {
          auto115Set(t, 'cleanup', 'fail', (e && e.message) ? e.message : '网络错误');
          auto115Finish(t); return null;
        });
      }
      if (!t.offlineDirCid || t.offlineDirCid === C115_DEFAULT_DIR_CID) {
        auto115Set(t, 'cleanup', 'fail', '文件夹没定位到'); auto115Finish(t); return Promise.resolve(null);
      }
      if (t.offlineDirName === showTitle) {
        auto115Set(t, 'cleanup', 'skip', '文件夹名已符合，无需修改');
        return auto115StepTvCleanupFiles(t);
      }
      auto115Set(t, 'cleanup', 'running', '正在把文件夹改名为「' + showTitle + '」…');
      var tvBody = 'fid=' + encodeURIComponent(t.offlineDirCid) + '&file_name=' + encodeURIComponent(showTitle);
      return auto115Post('https://webapi.115.com/files/edit', tvBody).then(function (res) {
        var d = res.d || {};
        if (res.ok && (d.state === true || d.errno === 0)) {
          t.offlineDirName = showTitle;
          auto115Set(t, 'cleanup', 'ok', '文件夹已改名为：' + showTitle);
          return auto115StepTvCleanupFiles(t);
        }
        /* 改名失败（如「该目录名称已存在」）→ 找 115 根下同名剧集文件夹，找到就并入整理 */
        return auto115FindDir(C115_DEFAULT_DIR_CID, showTitle).then(function (hit) {
          if (hit && hit.cid) {
            t.tvMergeCid = hit.cid; t.tvRootCid = hit.cid;
            t.finalDirCid = hit.cid; t.finalDirName = showTitle;
            auto115Set(t, 'cleanup', 'ok', '同名剧集夹已存在，将在「' + showTitle + '」内整理，完成后清理临时夹');
            return auto115StepTvCleanupFiles(t);
          }
          auto115Set(t, 'cleanup', 'fail', auto115ErrText(d, res, '改名失败'));
          auto115Finish(t); return null;
        });
      }).catch(function (e) {
        auto115Set(t, 'cleanup', 'fail', (e && e.message) ? e.message : '网络错误');
        auto115Finish(t); return null;
      });
    }
    /* 单影片流程第 4 步（方案 B）：先把容器改成影片名；改完调 StepMove（第 5 步） */
    if (t.noFolder) { auto115Set(t, 'cleanup', 'skip', '单文件落地，无需改文件夹名'); return auto115StepMove(t); }
    /* 并入任务：同影片已有目标文件夹，离线临时夹稍后整体删除，不改名 */
    var prev = t.external ? null : auto115FindMergeTarget(t);
    if (prev) {
      t.finalDirCid = prev.cid; t.finalDirName = prev.name;
      auto115Set(t, 'cleanup', 'skip', '将并入已有文件夹「' + prev.name + '」');
      return auto115StepMove(t);
    }
    if (!t.offlineDirCid || t.offlineDirCid === C115_DEFAULT_DIR_CID) { auto115Set(t, 'cleanup', 'fail', '文件夹没定位到，点「重试」再试一次'); auto115Finish(t); return Promise.resolve(null); }
    var newName;
    if (t.external) {
      if (!t.targetName) { auto115Set(t, 'cleanup', 'skip', '未填目标名称，保留 115 文件夹名'); return auto115StepMove(t); }
      newName = auto115ExternalBaseName(t);
    } else {
      /* 文件夹命名：始终只取影片标题（AV/影片一致） */
      newName = ((auto115Doc && (auto115Doc.filmTitle || auto115Doc.dvdId)) || t.offlineDirName || '').trim();
    }
    if (!newName) { auto115Set(t, 'cleanup', 'fail', '缺少名称信息，没法改名'); auto115Finish(t); return Promise.resolve(null); }
    if (newName === t.offlineDirName) { auto115Set(t, 'cleanup', 'skip', '文件夹名已符合，无需修改'); return auto115StepMove(t); }
    auto115Set(t, 'cleanup', 'running', '正在把文件夹改名为「' + newName + '」…');
    var body = 'fid=' + encodeURIComponent(t.offlineDirCid) + '&file_name=' + encodeURIComponent(newName);
    return auto115Post('https://webapi.115.com/files/edit', body).then(function (res) {
      var d = res.d || {};
      if (res.ok && (d.state === true || d.errno === 0)) {
        t.offlineDirName = newName;
        auto115Set(t, 'cleanup', 'ok', '文件夹已改名为：' + newName);
        return auto115StepMove(t);
      }
      /* 改名失败（如「该目录名称已存在」）→ 找 115 根下同名文件夹，找到就并入：视频整理进去，最后删临时夹 */
      return auto115FindDir(C115_DEFAULT_DIR_CID, newName).then(function (hit) {
        if (hit && hit.cid) {
          t.forcedMergeCid = hit.cid; t.finalDirCid = hit.cid; t.finalDirName = newName;
          auto115Set(t, 'cleanup', 'ok', '同名文件夹已存在，视频将并入「' + newName + '」');
          return auto115StepMove(t);
        }
        auto115Set(t, 'cleanup', 'fail', auto115ErrText(d, res, '文件夹改名失败'));
        auto115Finish(t); return null;
      });
    }).catch(function (e) {
      auto115Set(t, 'cleanup', 'fail', (e && e.message) ? e.message : '网络错误');
      auto115Finish(t); return null;
    });
  }

  /* ---------- 上传任务（NFO/海报/剧照，开放平台通道） ---------- */
  function auto115UploadDirName() { return pcSanitizeName((auto115Doc && auto115Doc.filmTitle) || '') || ''; }
  function auto115Mkdir(name) {
    return auto115Post('https://webapi.115.com/files/add', 'pid=' + encodeURIComponent(C115_DEFAULT_DIR_CID) + '&cname=' + encodeURIComponent(name))
      .then(function (res) {
        var d = res.d || {}, dd = d.data || d;
        var cid = String((dd && (dd.cid || dd.file_id || dd.id)) || '');
        if (!cid) throw new Error('建文件夹没成功');
        return cid;
      });
  }
  function auto115StepUploadDir(t) {
    var name = auto115UploadDirName();
    if (!name) { auto115Set(t, 'dir', 'fail', '这部影片没有标题，不知道传到哪儿'); auto115Finish(t); return Promise.resolve(null); }
    auto115Set(t, 'dir', 'running', '正在 115 里找「' + name + '」…');
    pc115RenderAuto();
    return auto115ListDir(C115_DEFAULT_DIR_CID).then(function (list) {
      var folders = list.filter(function (it) { return it && it.cid && !it.fid; });
      for (var i = 0; i < folders.length; i++) {
        if ((folders[i].n || '') === name) {
          t.uploadDirCid = String(folders[i].cid); t.uploadDirName = name;
          auto115Set(t, 'dir', 'ok', '已找到「' + name + '」');
          return auto115StepUploadFiles(t);
        }
      }
      auto115Set(t, 'dir', 'running', '没找到，正在创建「' + name + '」…');
      pc115RenderAuto();
      return auto115Mkdir(name).then(function (cid) {
        t.uploadDirCid = cid; t.uploadDirName = name;
        auto115Set(t, 'dir', 'ok', '已创建「' + name + '」');
        return auto115StepUploadFiles(t);
      });
    }).catch(function (e) {
      console.warn('[115上传]', e);
      auto115Set(t, 'dir', 'fail', '文件夹没准备好，点「重试」再来一次');
      auto115Finish(t); return null;
    });
  }
  function auto115StepUploadFiles(t) {
    if (!t.uploadDirCid) { auto115Set(t, 'upload', 'fail', '还没确定传到哪个文件夹'); auto115Finish(t); return Promise.resolve(null); }
    auto115Set(t, 'upload', 'running', '正在准备文件…');
    pc115RenderAuto();
    return loadFilm(auto115Doc.filmId).then(function (film) {
      if (!film) throw new Error('没找到影片信息');
      var d = film.data || {};
      var base = auto115Doc.dvdId || pcSanitizeName(auto115Doc.filmTitle || '') || 'movie';
      var files = [{ name: base + '.nfo', mime: 'application/octet-stream', bytes: new TextEncoder().encode(buildNFOMovieXml(d)) }];
      var pb = (typeof d.poster === 'string') ? dataUrlToBytesSync(d.poster) : null;
      if (pb) files.push({ name: base + '-poster.jpg', mime: 'image/jpeg', bytes: pb });
      var fb = (typeof d.fanart === 'string') ? dataUrlToBytesSync(d.fanart) : null;
      if (fb) files.push({ name: base + '-fanart.jpg', mime: 'image/jpeg', bytes: fb });
      var total = files.length, idx = 0;
      function next() {
        if (idx >= total) return Promise.resolve();
        var f = files[idx];
        auto115Set(t, 'upload', 'running', '上传中 (' + (idx + 1) + '/' + total + ')：' + f.name);
        pc115RenderAuto();
        return c115OpenUploadFile(t.uploadDirCid, f.name, f.bytes, f.mime).then(function () { idx++; return next(); });
      }
      return next().then(function () {
        t.nfoUploaded = auto115Now();
        auto115Set(t, 'upload', 'ok', '已上传 ' + total + ' 个文件到「' + (t.uploadDirName || '') + '」');
        auto115Finish(t);
        showToast('已上传 ' + total + ' 个文件到「' + (t.uploadDirName || '') + '」', 'success');
      });
    }).catch(function (e) {
      console.warn('[115上传]', e);
      auto115Set(t, 'upload', 'fail', '没传成功，点「重试」再来一次');
      auto115Finish(t);
    });
  }
  function auto115AddUploadTask() {
    auto115EnsureDoc().then(function (doc) {
      var ts = doc.tasks || [];
      for (var i = 0; i < ts.length; i++) {
        if (auto115TaskType(ts[i]) === 'upload' && auto115Status(ts[i]).cls === 'ab-run') { showToast('正在上传中，等一下就好', 'info'); return null; }
      }
      var t = { id: 't' + auto115Now().toString(36) + Math.random().toString(36).slice(2, 6), type: 'upload', steps: auto115NewSteps('upload'), createdAt: auto115Now(), fv: AUTO115_FLOW_VERSION };
      ts.unshift(t); doc.tasks = ts;
      auto115Expanded[t.id] = true;
      return auto115Save().then(function () {
        pc115OpenAutoPanel().then(function () { return auto115Run(t); });
      });
    }).catch(function (e) { showToast((e && e.message) || '没能开始上传', 'error'); });
  }

  /* ---------- 探测 / 恢复 ---------- */
  function pc115StopProbe() { if (auto115ProbeTimer) { clearTimeout(auto115ProbeTimer); auto115ProbeTimer = null; } }
  function auto115ProbeDelay(doneProbes) { return Auto115Core.probeDelay(doneProbes); }
  function auto115ScheduleProbe(t) {
    pc115StopProbe();
    var delay = AUTO115_PROBE_GAPS[0];
    if (t) delay = auto115ProbeDelay(auto115GetStep(t, 'wait').probes);
    else {
      var pend = (auto115Doc && auto115Doc.tasks || []).filter(function (x) { return auto115GetStep(x, 'wait').state === 'running'; });
      for (var i = 0; i < pend.length; i++) delay = Math.min(delay, auto115ProbeDelay(auto115GetStep(pend[i], 'wait').probes));
    }
    auto115ProbeTimer = setTimeout(function () {
      auto115ProbeTimer = null;
      if (!auto115Doc) return;
      var pending = (auto115Doc.tasks || []).filter(function (x) { return auto115GetStep(x, 'wait').state === 'running'; });
      if (!pending.length) return;
      ensure115Cookie().then(function (ck) { if (ck) pending.forEach(function (x) { auto115StepWait(x, false); }); });
    }, delay);
  }
  function auto115Resume() {
    if (!auto115Doc) return;
    auto115SweepZombies();
    auto115ClearDirtyLock();
    var hasRunning = !!auto115RunningId || (auto115Doc.tasks || []).some(function (x) { return auto115IsActive(x); });
    if (hasRunning) auto115ScheduleProbe();
    if (!auto115RunningId) auto115KickStuck();
  }

  /* ---------- 添加磁力（popover 内联） ---------- */
  function pc115PasteMagnet() {
    var inp = document.getElementById('pcMagnetInput');
    if (!inp) return;
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(function (txt) { inp.value = (txt || '').trim(); inp.focus(); })
        .catch(function () { showToast('读取剪贴板失败，请手动粘贴', 'error'); });
    } else showToast('当前环境不支持自动粘贴，请手动粘贴', 'info');
  }
  function pc115SubmitAddMagnet() {
    var inp = document.getElementById('pcMagnetInput');
    var magnet = (inp && inp.value || '').trim();
    if (!/^magnet:\?/i.test(magnet)) { showToast('请粘贴有效的磁力链接（以 magnet:? 开头）', 'error'); return; }
    auto115EnsureDoc().then(function (doc) {
      var t = {
        id: 't' + auto115Now().toString(36) + Math.random().toString(36).slice(2, 6),
        type: 'offline',
        magnet: magnet, magnetTitle: auto115Btih(magnet),
        steps: auto115NewSteps(), createdAt: auto115Now(), fv: AUTO115_FLOW_VERSION
      };
      doc.tasks.unshift(t);
      auto115Expanded[t.id] = true;
      return auto115Save().then(function () {
        if (inp) inp.value = '';
        showToast('已加入自动化', 'success');
        pc115OpenAutoPanel().then(function () { return auto115Run(t); });
      });
    }).catch(function (e) { showToast((e && e.message) || '加入失败', 'error'); });
  }

  /* ---------- 任务操作 ---------- */
  function auto115RetryStep(tid, key, force) {
    var t = auto115Task(tid);
    if (!t) return Promise.resolve(null);
    return ensure115Cookie().then(function (ck) {
      if (!ck) { showToast('请先到「设置 → 115 网盘」登录', 'error'); return; }
      if (force) {
        /* 兜底强启：不管队列里有没有别的任务，直接抢锁跑这一条（用户手动点火用） */
        auto115HoldLock(t);
        t.queued = false;
      } else {
        auto115ClearDirtyLock();
        if (auto115RunningId && auto115RunningId !== t.id && auto115Task(auto115RunningId)) {
          t.queued = true;
          var cur2 = auto115Task(auto115RunningId);
          auto115Set(t, key, 'idle', '排队中：等「' + auto115TaskTitle(cur2) + '」完成');
          auto115Save(); pc115RenderAuto(); pc115UpdateBadge();
          return;
        }
        auto115HoldLock(t);
        t.queued = false;
      }
      var defs = auto115StepDefs(t);
      var idx = -1;
      for (var i = 0; i < defs.length; i++) if (defs[i].key === key) idx = i;
      if (idx < 0) return;
      for (var j = idx; j < defs.length; j++) { var s = auto115GetStep(t, defs[j].key); s.state = 'idle'; s.msg = ''; s.probes = 0; s.at = 0; }
      t.aborted = false;
      auto115Save(); pc115RenderAuto();
      if (key === 'dir') return auto115StepUploadDir(t);
      if (key === 'upload') return auto115StepUploadFiles(t);
      if (key === 'submit') return auto115StepSubmit(t);
      if (key === 'wait') return auto115StepWait(t, true);
      if (key === 'mkdir') return auto115StepMkdir(t);
      if (key === 'move') return auto115IsTvTask() ? auto115StepTvCleanupFiles(t) : auto115StepMove(t);
      if (key === 'rename') return auto115IsTvTask() ? auto115StepTvRenameVideos(t) : auto115StepRename(t);
      if (key === 'cleanup') return auto115StepCleanup(t);
      if (key === 'mkdir2') return auto115StepTvMkdirSeasons(t);
      if (key === 'move2') return auto115StepTvMoveVideos(t);
    }).catch(function (e) { showToast((e && e.message) || '重试失败', 'error'); });
  }
  /* 手动点火：任务卡在「待提交 / 排队中」时直接抢锁从第一步开始跑 */
  function auto115ForceStart(tid) {
    var t = auto115Task(tid);
    if (!t) return;
    showToast('立即开始…', 'info');
    return auto115RetryStep(tid, auto115StepDefs(t)[0].key, true);
  }
  function auto115RetryTask(tid) {
    var t = auto115Task(tid);
    if (!t) return;
    var steps = t.steps || [];
    for (var i = 0; i < steps.length; i++) if (steps[i].state === 'fail') return auto115RetryStep(tid, steps[i].key);
    /* 没有失败步骤但整体还没跑起来（待提交/排队中/已中止）→ 直接从头强启，不再干等队列 */
    if (auto115Status(t).cls === 'ab-idle') return auto115ForceStart(tid);
    showToast('没有失败的步骤', 'info');
  }
  function auto115ContinueProbe(tid) {
    var t = auto115Task(tid);
    if (!t) return Promise.resolve(null);
    return ensure115Cookie().then(function (ck) {
      if (!ck) { showToast('请先登录 115', 'error'); return null; }
      return auto115StepWait(t, true);
    });
  }
  function auto115Abort(tid) {
    var t = auto115Task(tid);
    if (!t) return;
    t.aborted = true;
    var w = auto115GetStep(t, 'wait');
    if (w.state === 'running') { w.state = 'idle'; w.msg = '已手动中止'; }
    pc115StopProbe();
    auto115Finish(t);
  }
  function auto115RemoveTask(tid) {
    if (!auto115Doc) return;
    auto115Doc.tasks = (auto115Doc.tasks || []).filter(function (x) { return x.id !== tid; });
    if (auto115RunningId === tid) auto115AdvanceQueue(null);
    auto115Save().then(pc115RenderAuto);
  }
  function auto115ClearDone() {
    if (!auto115Doc) return;
    auto115Doc.tasks = (auto115Doc.tasks || []).filter(function (t) { return auto115Status(t).cls !== 'ab-ok'; });
    auto115Save().then(function () { pc115RenderAuto(); showToast('已清空已完成任务', 'success'); });
  }

  /* ---------- popover 开合 ---------- */
  var pcAutoOpen = false;
  function pc115OpenAutoPanel() {
    return auto115EnsureDoc().then(function () {
      pc115RenderAuto();
      auto115Resume();
    }).catch(function (e) { showToast((e && e.message) || '打开自动化失败', 'error'); });
  }
  function pc115ToggleAutoPanel() {
    var pop = document.getElementById('autoPopover');
    if (!pop) return;
    pcAutoOpen = !pcAutoOpen;
    pop.classList.toggle('show', pcAutoOpen);
    if (pcAutoOpen) pc115OpenAutoPanel();
  }
  function pc115CloseAutoPanel() {
    var pop = document.getElementById('autoPopover');
    if (pop) pop.classList.remove('show');
    pcAutoOpen = false;
  }
  document.addEventListener('click', function (e) {
    if (!pcAutoOpen) return;
    var pop = document.getElementById('autoPopover');
    var btn = document.getElementById('autoBtn');
    if (pop && btn && !pop.contains(e.target) && !btn.contains(e.target)) pc115CloseAutoPanel();
  });

  /* ---------- ui.js 钩子 ---------- */
  function pc115OnDetailOpen() {
    auto115Doc = null;
    auto115ReleaseLock();
    pc115StopProbe();
    pc115UpdateBadge();
    return pc115OpenAutoPanel().then(pc115UpdateBadge);
  }

  /* ---------- 暴露 ---------- */
  /* 任务卡里的内联 onclick 需要这些函数在 window 上可见（IIFE 内部声明不会自动挂全局） */
  global.auto115Toggle = auto115Toggle;
  global.auto115RetryStep = auto115RetryStep;
  global.auto115RetryTask = auto115RetryTask;
  global.auto115ForceStart = auto115ForceStart;
  global.auto115ContinueProbe = auto115ContinueProbe;
  global.auto115Abort = auto115Abort;
  global.auto115RemoveTask = auto115RemoveTask;
  global.auto115ClearDone = auto115ClearDone;
  global.auto115AddUploadTask = auto115AddUploadTask;

  global.PC115 = {
    toggleAutoPanel: pc115ToggleAutoPanel,
    openAutoPanel: pc115OpenAutoPanel,
    closeAutoPanel: pc115CloseAutoPanel,
    onDetailOpen: pc115OnDetailOpen,
    openConfig: pc115OpenSheet,
    startLogin: pc115StartLogin,
    verify: pc115Verify,
    tokenInput: pc115TokenInput,
    copyCookie: pc115CopyCookie,
    authorize: pc115OpenAuthUI,
    refreshOpenStatus: pc115RefreshOpenStatus,
    pasteMagnet: pc115PasteMagnet,
    submitAddMagnet: pc115SubmitAddMagnet,
    addUploadTask: auto115AddUploadTask,
    clearDone: auto115ClearDone,
    offline: c115Offline,
    refreshBadge: pc115UpdateBadge
  };

})(window);
