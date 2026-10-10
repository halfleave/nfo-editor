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

  /* ---------- 115 限流闸（v361：PC 镜像手机端 c115Call，防封号三件套）----------
     ① 串行：所有 115 请求排一条队，任何时刻只有一个在飞（并发本身就是明显特征）；
     ② 最小间隔：写操作（改名/移动/删除/建夹/导出）默认 1.2s，读操作（列目录/轮询）0.35s；
     ③ 熔断：一旦 115 回「操作过于频繁 / 系统检测异常」或 HTTP 403/405/429，立刻冷却 60s，
        期间所有请求自动排队等待 —— 不给「失败后继续猛打」的机会（那正是封号的临界点）。
     注意是「最小间隔」而非「限速」：距上次调用已超过间隔就立即放行。 */
  var C115_THROTTLE_ON = true;  // 总开关（保留给隔离测试：真实等待会打乱按调用次数编排的用例）
  var C115_T_WRITE = 1200;      // 写操作最小间隔（毫秒）
  var C115_T_READ = 350;        // 读操作最小间隔
  var C115_COOLDOWN = 60000;    // 命中风控后的冷却时长
  var C115_RETRY_WAIT = 3000;   // 网络层失败自动重试前的等待（只重试一次）
  var c115LastAt = 0;           // 上一次请求发起时间
  var c115CooldownUntil = 0;    // 冷却截止时间戳
  var c115Queue = [];
  var c115Busy = false;         // 有请求正在飞
  var c115RiskHits = 0;         // 本次会话命中风控的次数
  var c115RiskAt = 0;           // 上次提示时间（30s 内只提示一次，避免刷屏）
  var C115_WRITE_RE = /files\/(edit|add|move|copy|batch_rename|batch_edit|export_dir)|rb\/delete/;
  function c115IsWrite(url){ return C115_WRITE_RE.test(String(url || '')); }
  function c115RiskActive(){ return Date.now() < c115CooldownUntil; }
  /* PC 页面不加载 tidy-core.js → 软风控文案正则本地副本（与 tidy-core RISK_RE 保持一致） */
  var C115_RISK_RE = /(过于频繁|操作频繁|请求频繁|频繁|检测异常|异常行为|风控|访问受限|稍后再试|暂时无法|请求过多|访问速度过快|系统繁忙|请稍候)/;
  /* 命中风控 → 冷却 + 提示（30s 内不重复计数/提示） */
  function c115RiskHit(reason){
    var now = Date.now();
    var fresh = (now - c115RiskAt) > 30000;
    if (fresh){ c115RiskAt = now; c115RiskHits++; }
    c115CooldownUntil = now + C115_COOLDOWN;
    if (fresh){
      var tip = String(reason || '').slice(0, 24);
      showToast('115 提示「' + tip + '」，已自动暂停 60 秒再继续', 'error');
    }
    return fresh;
  }
  /* 排队执行：任何时刻只有一个 115 请求在飞，且两次请求之间至少隔 gap（写/读不同）。
     空闲且无需等待时直接发（微任务里发，不绕 setTimeout），避免给单发请求平白加延迟。 */
  function c115Call(kind, fn){
    if (!C115_THROTTLE_ON){
      try { return Promise.resolve(fn()); } catch (e){ return Promise.reject(e); }
    }
    var gap = (kind === 'write') ? C115_T_WRITE : C115_T_READ;
    var now = Date.now();
    var wait = Math.max(0, c115LastAt + gap - now, c115CooldownUntil - now);
    if (!c115Busy && !c115Queue.length && wait <= 0){
      c115Busy = true; c115LastAt = now;
      return Promise.resolve().then(fn).then(function (v){
        c115Busy = false; c115Pump(); return v;
      }, function (e){
        c115Busy = false; c115Pump(); throw e;
      });
    }
    return new Promise(function (resolve, reject){
      c115Queue.push({ kind: kind, run: fn, resolve: resolve, reject: reject });
      c115Pump();
    });
  }
  function c115Pump(){
    if (c115Busy || !c115Queue.length) return;
    c115Busy = true;
    var job = c115Queue[0];
    var gap = (job.kind === 'write') ? C115_T_WRITE : C115_T_READ;
    var now = Date.now();
    var wait = Math.max(0, c115LastAt + gap - now, c115CooldownUntil - now);
    setTimeout(function (){
      c115Queue.shift();
      c115LastAt = Date.now();
      Promise.resolve().then(job.run).then(function (v){
        c115Busy = false; c115Pump(); job.resolve(v);
      }, function (e){
        c115Busy = false; c115Pump(); job.reject(e);
      });
    }, wait > 0 ? wait + Math.floor(Math.random() * 180) : 0);
  }

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
    /* 限流闸（v361）：写/读分流，全站一条队；软风控文案 + HTTP 403/405/429 触发熔断冷却 */
    return c115Call(c115IsWrite(targetUrl) ? 'write' : 'read', function () {
      var waitMs = c115AdaptiveDelay();
      var pre = waitMs > 0 ? c115Sleep(waitMs) : Promise.resolve();
      return pre.then(function () {
        /* 网络层自动重试（v364）：切后台/锁屏/信号瞬断掐断请求（Load failed）→ 等待后重试一次；
           115 业务报错（有 status）不重试，避免写操作重复执行 */
        function c115FetchOnce(){
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
        /* 115 的「软风控」是 HTTP 200 + {state:false,error:"操作过于频繁…"} —— 必须单独识别，
           否则会被当成一条普通失败吞掉，然后继续猛打（那才是真正会被封号的动作） */
        if (d && d.state === false){
          var msg = String(d.error || d.msg || d.message || '');
          if (msg && C115_RISK_RE.test(msg)) c115RiskHit(msg);
        }
        if (!r.ok) {
          if (r.status === 403 || r.status === 405 || r.status === 429) c115RiskHit('HTTP ' + r.status);
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
      return c115FetchOnce().catch(function (e) {
        if (e && e.network) return c115Sleep(C115_RETRY_WAIT).then(c115FetchOnce);  // 仅网络层失败重试一次
        throw e;
      });
    });
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
    return (name || '').replace(/[\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim() || 'movie'; /* / 不净化（115 支持），与 NfoCore.sanitizeName 同规则 */
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
  /* 回填「应用配置 → 115 网盘」组（Cookie / 代理令牌 / 授权状态）。
     115 配置已并入「应用配置」弹窗，本函数不再自行开弹窗。 */
  function pc115FillConfig() {
    var ta = document.getElementById('c115CookiePc');
    if (ta) ta.value = '';
    pc115RefreshOpenStatus();
    idbGet('kv', C115_COOKIE_KEY).then(function (v) {
      var cookie = (typeof v === 'string') ? v : (v && v.cookie) || '';
      if (ta && cookie) ta.value = cookie;
      state.c115Cookie = cookie;
      pc115SyncAutoEntry();   // Cookie 变了（含被清空）→ 顶栏「自动化」按钮跟着显隐
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
  /* 兼容入口：115 配置已并入「应用配置」弹窗，统一走同一个打开动线（含各输入框回填） */
  function pc115OpenSheet() {
    if (typeof openApiKeySheet === 'function') { openApiKeySheet(); return; }
    if (typeof openSheet === 'function') openSheet('apiSheet');
    pc115FillConfig();
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
  /* 二维码按钮文案单点：展开时「收起二维码」，收起/结束回到「展示二维码」（按钮常驻，可反复开合） */
  function pc115SetQrBtn(text) {
    var btn = document.getElementById('c115ShowQrBtnPc');
    if (btn) { btn.textContent = text; btn.style.display = ''; }
  }
  function pc115ShowQrArea() {
    var wrap = document.getElementById('c115QrWrapPc'); if (wrap) wrap.style.display = '';
    var st = document.getElementById('c115StatusPc'); if (st) { st.style.display = ''; st.textContent = '正在生成二维码…'; }
    var cd = document.getElementById('c115CountdownPc'); if (cd) { cd.style.display = ''; cd.textContent = ''; }
    pc115SetQrBtn('收起二维码');
  }
  function pc115ResetQrButton() {
    if (c115CountdownTimer) { clearInterval(c115CountdownTimer); c115CountdownTimer = null; }
    if (c115QrTimer) { clearTimeout(c115QrTimer); c115QrTimer = null; }
    pc115StopPolling();
    var wrap = document.getElementById('c115QrWrapPc'); if (wrap) wrap.style.display = 'none';
    var st = document.getElementById('c115StatusPc'); if (st) { st.style.display = 'none'; st.textContent = ''; }
    var cd = document.getElementById('c115CountdownPc'); if (cd) { cd.style.display = 'none'; cd.textContent = ''; }
    pc115SetQrBtn('展示二维码');
  }
  /* 「展示二维码」按钮：未展开 → 生成并展开；已展开 → 收起 */
  function pc115ToggleQr() {
    var wrap = document.getElementById('c115QrWrapPc');
    if (wrap && wrap.style.display !== 'none') { pc115ResetQrButton(); return; }
    pc115StartLogin();
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
          pc115SetQrBtn('展示二维码');
        } else if (st === -2) {
          pc115SetStatus('已取消登录', 'err'); pc115StopPolling();
          pc115SetQrBtn('展示二维码');
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
          pc115SetQrBtn('展示二维码');
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
        pc115SyncAutoEntry();   // 登录成功 → 详情页「自动化」按钮随之出现
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
      if (!cookie) { showToast('请先到「设置 → 应用配置」登录 115', 'error'); return null; }
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
  function auto115IsTvTask(doc) { return !!(((doc != null ? doc : auto115Doc) || {}).type === 'tv'); }
  function auto115StepDefs(t, doc) {
    /* 单磁力剧集 6 步新表（期三第 2 刀，iOS 镜像）；多磁力剧集仍 8 步（另有分支判断） */
    if (auto115IsTvTask(doc != null ? doc : auto115TaskDoc(t))) return Auto115Core.STEPS_TV_SINGLE;
    return AUTO115_STEP_TABLE[auto115TaskType(t)] || AUTO115_STEP_DEFS;
  }
  function auto115TaskTitle(t) {
    if (auto115TaskType(t) === 'upload') return '上传 NFO';
    return (t && (t.magnetTitle || auto115OfflineTitle(t && t.magnet))) || '磁力任务';
  }
  var auto115Doc = null;
  var auto115ExecDoc = null;   /* 执行绑定（v327）：正在执行的任务所属影片的文档。执行中途切到别的影片，
                                  执行器仍读写这个文档——影片身份、进度保存都不会串到别人身上 */
  var auto115ProbeTimer = null;
  var auto115Expanded = {};
  var auto115RunningId = '';
  var auto115LockAt = 0;                     // 拿到锁的时刻，用于识别「占着锁但没在跑」的脏锁
  var AUTO115_LOCK_GRACE = Auto115Core.LOCK_GRACE_MS;   // 宽限期：刚拿到锁的头 45s 允许还没跑到 running 步骤
  /* 僵尸步骤清理：某一步卡在 running 超过 10 分钟没动静（关页面/断网/请求挂起会留下这种状态），
     它会被当成「任务还在跑」，导致执行锁不释放、别的任务永远排不上队。这里统一判死，让用户能重试。 */
  var AUTO115_ZOMBIE_MS = Auto115Core.ZOMBIE_MS;
  function auto115SweepZombies() {
    var docs = [];
    if (auto115Doc) docs.push(auto115Doc);
    if (auto115ExecDoc && auto115ExecDoc !== auto115Doc) docs.push(auto115ExecDoc);   /* 执行绑定的文档也要扫（人可能在别的影片页） */
    var now = Date.now(), changed = false;
    for (var di = 0; di < docs.length; di++) {
      var dts = docs[di].tasks || [], docChanged = false;
      for (var i = 0; i < dts.length; i++) {
        var t = dts[i];
        if (!t || t.aborted) continue;
        var steps = t.steps || [];
        for (var j = 0; j < steps.length; j++) {
          var s = steps[j];
          if (Auto115Core.isZombieStep(s, now)) {
            s.state = 'fail'; s.msg = '这一步长时间没响应，点「重试」继续';
            changed = true; docChanged = true;
          }
        }
      }
      if (docChanged) auto115Save(docs[di]);
    }
    if (changed) { pc115RenderAuto(); pc115UpdateBadge(); }
    return changed;
  }
  function auto115HoldLock(t) { auto115RunningId = t.id; auto115LockAt = Date.now(); }
  function auto115ReleaseLock() { auto115RunningId = ''; auto115LockAt = 0; }
  /* 节点级排队（v332）：等待下载期间不再长期占用执行锁。
     ① auto115YieldLock：等待期兜底让锁 + 顺手 kick 排队中的写节点；
     ② auto115EnsureLock：写节点入口抢锁，抢不到标记排队，等对方终态后 auto115KickStuck 拉起续跑；
     ③ auto115WriteEnter：写节点统一入口（带排队提示）。提交/等待/探测不占锁，多任务并行。 */
  function auto115YieldLock(t) {
    if (auto115RunningId === t.id) { auto115ReleaseLock(); auto115KickStuck(); }
  }
  function auto115EnsureLock(t) {
    if (auto115RunningId === t.id) return true;
    if (!auto115RunningId) { auto115HoldLock(t); t.queued = false; return true; }
    if (!t.queued) t.queued = true;   /* 锁被占用：标记排队，等被 kick 续跑（wait 仍 running，探针继续） */
    return false;
  }
  /* v353：节点级排队（PC 镜像 iOS）——执行锁只保护「写节点」（定位/清理/改名/移入等改 115 目录的）。
     提交磁力、等待下载、进度探测不碰目录状态，完全不排队，多任务并行。 */
  function auto115IsWriteKey(key) { return key !== 'submit' && key !== 'wait'; }
  function auto115WriteRunning(t) {
    var steps = (t && t.steps) || [];
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i];
      if (s && s.state === 'running' && auto115IsWriteKey(s.key)) return true;
    }
    return false;
  }
  function auto115WriteEnter(t, key) {
    if (auto115EnsureLock(t)) return true;
    var cur = auto115Task(auto115RunningId);
    auto115Set(t, key, 'idle', '排队中：等「' + ((cur && (cur.magnetTitle || cur.offlineName)) || '其他任务') + '」的整理完成');
    auto115Save(auto115DocOf(t) || auto115Doc); pc115RenderAuto(); pc115UpdateBadge();
    return false;
  }
  /* 脏锁清理：锁指向的任务不存在 / 已中止 / 已终态 / 超过宽限期仍无任何 running 步骤 → 释放。
     最后一条是「卡在待提交」的根因：任务拿到锁后卡在读 Cookie 等异步环节，步骤迟迟不 running。 */
  function auto115ClearDirtyLock() {
    if (!auto115RunningId) return;
    var cur = auto115Task(auto115RunningId);
    if (!cur || cur.aborted) { auto115ReleaseLock(); return; }
    if (auto115IsActive(cur)) return;
    var st = auto115Status(cur, auto115DocOf(cur));
    if (st.cls === 'ab-ok' || st.cls === 'ab-fail') { auto115ReleaseLock(); return; }
    if (Date.now() - auto115LockAt > AUTO115_LOCK_GRACE) auto115ReleaseLock();
  }
  /* 自愈：没有任何任务在跑时，把最早一条待开始（排队中/待提交）的任务拉起来，避免永远停摆 */
  function auto115KickStuck() {
    /* v327：先看执行绑定文档（人在别的影片页时，那边的排队任务也要能接上），再看当前打开的 */
    if (auto115ExecDoc && auto115ExecDoc !== auto115Doc) auto115KickStuckIn(auto115ExecDoc);
    if (auto115Doc) auto115KickStuckIn(auto115Doc);
  }
  function auto115KickStuckIn(doc) {
    if (!doc) return;
    auto115SweepZombies();                          // 先清僵尸（可能把占锁任务的 running 步骤判死）
    if (auto115RunningId) auto115ClearDirtyLock();  // 僵尸清完后锁往往就变脏了，顺带释放
    if (auto115RunningId) return;
    var ts = doc.tasks || [];
    for (var k = 0; k < ts.length; k++) if (auto115WriteRunning(ts[k])) return;  // v353：只有写节点在跑才不抢，防两条写链并发串档
    var target = null;
    for (var i = ts.length - 1; i >= 0; i--) {
      if (ts[i] && ts[i].queued && !ts[i].aborted) { target = ts[i]; break; }
    }
    if (!target) {
      for (var j = ts.length - 1; j >= 0; j--) {
        var x = ts[j];
        if (x && !x.aborted && auto115Status(x, doc).cls === 'ab-idle') { target = x; break; }
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
  function auto115IsOfflineLink(s) { return Auto115Core.isOfflineLink(s); }   /* 磁力 + ed2k 都算（115 云下载均支持） */
  function auto115OfflineTitle(url) { return Auto115Core.offlineTitle(url); } /* 磁力取 btih；ed2k 取文件名 */
  function auto115NewSteps(type) { return Auto115Core.newSteps(type, auto115IsTvTask()); }
  function auto115Size(n) { return Auto115Core.sizeFmt(n); }
  function auto115ErrText(d, res, fallback) { return Auto115Core.errText(d, res, fallback); }
  function auto115EnsureDoc() {
    var film = currentDetailFilm;
    if (!film) return Promise.reject(new Error('未打开影片'));
    var d = film.data || {};
    // 剧集判定：影片自身持久数据优先（v344 镜像）；state.tmdbMediaType 是搜索框残留值，只在影片没标类型时兜底
    var isTv;
    if (d.tmdbMediaType === 'tv' || d.media_type === 'tv') isTv = true;
    else if (d.tmdbMediaType === 'movie' || d.media_type === 'movie') isTv = false;
    else isTv = (state.tmdbMediaType === 'tv');
    // 番号只认显式字段；不再用 originaltitle 做兜底：否则像 "Madrid, 1987" 这种带年份的英文名会被误判为番号，导致普通影片被误判为番号片。
    var dvdId = (d.dvdId || d.content_id || '').toString().trim();
    var year = (d.year || (d.premiered || '').slice(0, 4) || '').toString().trim();
    /* v348：合集 ID——新数据存 data.collectionId；旧数据/直连 TMDB 响应兜底 belongs_to_collection */
    var collId = d.collectionId || ((d.belongs_to_collection && d.belongs_to_collection.id) ? String(d.belongs_to_collection.id) : '');
    /* v327：这部片已有执行绑定文档（正在跑/跑过）→ 直接复用同一对象，保证执行器手里的任务引用
       不被「新建文档 + 库合并」换成反序列化副本（换了引用，进度就会写到孤儿对象上） */
    if (auto115ExecDoc && auto115ExecDoc.filmId === film.id && auto115Doc !== auto115ExecDoc) auto115Doc = auto115ExecDoc;
    if (!auto115Doc) {
      auto115Doc = { filmId: film.id, filmTitle: d.title || '', dvdId: dvdId, originalTitle: d.originaltitle || '', year: year, type: isTv ? 'tv' : 'movie', collectionId: collId, tmdbId: (d.tmdbId || '').toString(), tasks: [] };
    } else {
      auto115Doc.filmId = film.id;
      auto115Doc.filmTitle = d.title || auto115Doc.filmTitle || '';
      // 以当前影片数据为准；旧缓存里的错误番号不再保留，避免普通影片被误判为 AV
      auto115Doc.dvdId = dvdId || '';
      auto115Doc.originalTitle = d.originaltitle || '';
      auto115Doc.year = year || auto115Doc.year || '';
      auto115Doc.type = isTv ? 'tv' : 'movie';   /* v344 镜像：判定已按影片数据优先，直接覆盖清脏值 */
      auto115Doc.collectionId = collId;          /* v347：以影片当前数据为准 */
      auto115Doc.tmdbId = (d.tmdbId || auto115Doc.tmdbId || '').toString();   /* v349：供合集 ID 自愈查询 */
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
        // 以当前影片数据为准；旧缓存里的错误番号不再保留
        auto115Doc.dvdId = dvdId || '';
        auto115Doc.originalTitle = d.originaltitle || v.originalTitle || '';
        auto115Doc.year = year || v.year || auto115Doc.year || '';
        auto115Doc.type = isTv ? 'tv' : (v.type || auto115Doc.type || 'movie');
      }
      return auto115Doc;
    }).catch(function () { return auto115Doc; });
  }
  /* 合并任务列表：单点实现在 Auto115Core.mergeTasks（内存任务保持原引用，只补库里有、内存没有的）。 */
  function auto115MergeTasks(memTasks, savedTasks) { return Auto115Core.mergeTasks(memTasks, savedTasks); }
  function auto115Save(doc) {
    var d = doc || auto115Doc;
    if (!d) return Promise.resolve();
    return idbPut('kv', auto115Key(d.filmId), d).catch(function () {});
  }
  function auto115Task(id) {
    var ts = (auto115Doc && auto115Doc.tasks) || [];
    for (var i = 0; i < ts.length; i++) if (ts[i].id === id) return ts[i];
    /* 当前文档里没有 → 再找执行绑定文档（跑到一半切了影片时，任务在执行文档里） */
    if (auto115ExecDoc && auto115ExecDoc !== auto115Doc) {
      ts = auto115ExecDoc.tasks || [];
      for (var j = 0; j < ts.length; j++) if (ts[j].id === id) return ts[j];
    }
    return null;
  }
  /* 任务归属的文档：优先引用比对（任务对象只会在一个文档的 tasks 数组里）；
     引用失联（被反序列化副本替换）时由 auto115Run 按 filmId 归位。 */
  function auto115DocOf(t) {
    if (!t) return auto115Doc;
    if (auto115ExecDoc && (auto115ExecDoc.tasks || []).indexOf(t) >= 0) return auto115ExecDoc;
    if (auto115Doc && (auto115Doc.tasks || []).indexOf(t) >= 0) return auto115Doc;
    return null;
  }
  /* 执行器读影片身份一律走这里：执行绑定文档优先，没在跑才落到当前打开的文档 */
  function auto115ExecCtx() { return auto115ExecDoc || auto115Doc; }
  function auto115GetStep(t, key) { return Auto115Core.getStep(t, key); }
  function auto115Set(t, key, stt, msg) {
    var s = auto115GetStep(t, key);
    s.state = stt; s.msg = msg || '';
    if (stt !== 'idle' && stt !== 'running') s.at = auto115Now();
    else if (!s.at) s.at = auto115Now();
    pc115RenderAuto(); auto115Save(auto115DocOf(t) || auto115Doc);   /* 进度写回任务归属的文档（防串到别的影片） */
    return s;
  }
  function auto115Finish(t) { t.updatedAt = auto115Now(); pc115RenderAuto(); auto115Save(auto115DocOf(t) || auto115Doc); pc115UpdateBadge(); auto115AdvanceQueue(t); if (auto115ExecDocIdle()) auto115ExecDoc = null; }
  /* 执行绑定文档里还有在跑/排队的任务吗？都没有就解除绑定，避免旧文档被后台续跑 */
  function auto115ExecDocIdle() {
    if (!auto115ExecDoc) return true;
    var ts = auto115ExecDoc.tasks || [];
    for (var i = 0; i < ts.length; i++) {
      var x = ts[i];
      if (!x || x.aborted) continue;
      if (x.queued || auto115IsActive(x)) return false;
    }
    return true;
  }

  /* ---------- 大状态合成（纯逻辑在 Auto115Core.status，isTv 由当前影片详情判定） ---------- */
  function auto115StepLabel(key) { return Auto115Core.stepLabel(key); }
  function auto115Status(t, doc) { return Auto115Core.status(t, auto115IsTvTask(doc)); }
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
    /* v334：卡住的步骤（running 但本会话无定时器驱动）也允许手动重试，避免「一直进行中」无法挽回；wait 的 running 已有「中止」可退出 */
    if (s.state === 'running' && s.key !== 'wait') ops = '<button class="as-op-retry" onclick="auto115RetryStep(\'' + t.id + '\',\'' + s.key + '\',true)">重试</button>';
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
      /* 动态步骤（期三第 1 刀，PC 镜像 iOS）：按实际进度裁剪 + upload 过滤，收口到 core.visibleSteps */
      var renderSteps = Auto115Core.visibleSteps(t);
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
  /* 确保父目录下名为 name 的文件夹存在，返回 cid（v351 合集归夹用，镜像 iOS） */
  function auto115EnsureDir(parentCid, name) {
    return auto115FindDir(parentCid, name).then(function (d) {
      if (d && d.cid) return d.cid;
      return auto115Post('https://webapi.115.com/files/add', 'pid=' + encodeURIComponent(parentCid) + '&cname=' + encodeURIComponent(name)).then(function (res) {
        var dd = res.d || {}, ddd = dd.data || {};
        var cid = String(ddd.cid || ddd.file_id || ddd.id || dd.cid || res.cid || '');
        if (!res.ok || !(dd.state === true || dd.errno === 0)) throw new Error(auto115ErrText(dd, res, '创建 ' + name + ' 失败'));
        if (!cid) throw new Error('创建 ' + name + ' 没拿到 cid');
        return cid;
      });
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
    /* v327 引用兜底（防串档核心）：先把任务归属的文档找对，再在归属文档里按 id 换回活引用。
       此前只认「当前打开影片」的文档——任务跑到一半切到别的影片，任务会被错误收编进别人的文档，
       后续定位/改名全用错影片身份（影片 A 的文件夹被改成影片 B 的名字）。 */
    var doc = auto115DocOf(t);
    if (!doc && t.filmId) {
      if (auto115ExecDoc && auto115ExecDoc.filmId === t.filmId) doc = auto115ExecDoc;
      else if (auto115Doc && auto115Doc.filmId === t.filmId) doc = auto115Doc;
    }
    if (doc) {
      var live = null, dts = doc.tasks || [];
      for (var di = 0; di < dts.length; di++) { if (dts[di] && dts[di].id === t.id) { live = dts[di]; break; } }
      if (live) t = live; else { dts.unshift(t); doc.tasks = dts; }
      auto115ExecDoc = doc;   /* 执行绑定：后续所有身份读取/保存都走这个文档，切走页面也不串 */
    } else if (!t.filmId && auto115Doc) {
      /* 老任务没 filmId：先按 id 在当前文档里找活引用（落库重载后手里是旧引用的场景），
         找不到才收编进去；只在「就是当前这部片」的常规场景成立 */
      var live0 = null, dts0 = auto115Doc.tasks || [];
      for (var di0 = 0; di0 < dts0.length; di0++) { if (dts0[di0] && dts0[di0].id === t.id) { live0 = dts0[di0]; break; } }
      if (live0) t = live0; else auto115Doc.tasks.unshift(t);
      auto115ExecDoc = auto115Doc;
    } else {
      /* 归属不明（带 filmId 但对不上任何文档）→ 宁可不跑也不冒串档风险 */
      showToast('这个任务已和所属影片失去关联，请回到该影片重新操作', 'error');
      return Promise.resolve(null);
    }
    /* v353：不再整条排队（PC 镜像 iOS）。提交/等待/探测节点无需执行锁直接并行跑；
       写节点进函数后各自 auto115WriteEnter 抢锁，抢不到标记排队、等对方终态被踢续跑 */
    if (auto115RunningId && auto115RunningId !== t.id) auto115ClearDirtyLock();
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
        return auto115BeginWait(t);
      }
      auto115Set(t, 'submit', 'fail', auto115ErrText(d, res, '提交失败'));
      auto115Finish(t); return null;
    }).catch(function (e) { auto115Set(t, 'submit', 'fail', (e && e.message) ? e.message : '网络错误'); auto115Finish(t); return null; });
  }
  function auto115BeginWait(t) {
    /* v333：等待阶段启动器（PC 镜像 iOS）。提交 / 恢复 / 重试走到「等待离线」时，首探延迟 PROBE_GAPS[0]=5s，
       不再立即探测——离线后 5s / 10s / 20s 各探一次，共 20s。手动「继续探测」按钮仍走 auto115StepWait 立即版。
       v353：等待/探测不占执行锁（节点级排队），与其他任务的写链互不阻塞。 */
    var s = auto115Set(t, 'wait', 'running', '正在查询离线状态…');
    s.probes = 0;
    auto115YieldLock(t);
    auto115ScheduleProbe(t);
    return Promise.resolve(null);
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
      pc115RenderAuto(); auto115Save(auto115DocOf(t) || auto115Doc); auto115YieldLock(t); auto115ScheduleProbe(t); return null;
    }).catch(function (e) { auto115Set(t, 'wait', 'fail', (e && e.message) ? e.message : '网络错误'); auto115Finish(t); return null; });
  }
  /* v354 期一（iOS 镜像）：统一定位器。级联规则单点真相在 Auto115Core.locatePlan（纯函数）：
     offline：种子名精确 → 时间窗 → 相似度评分兜底（v354 新增 offline 兜底）。 */
  function auto115LocateTarget(t, mode) {
    var _doc = auto115TaskDoc(t) || {};
    return auto115ListDir(C115_DEFAULT_DIR_CID, 'user_ptime').then(function (list) {
      list = list || [];
      return Auto115Core.locatePlan(
        {
          folders: list.filter(function (it) { return it && it.cid && !it.fid; }),
          files: list.filter(function (it) { return it && it.fid; }),
          vids: list.filter(function (it) { return it && it.fid && auto115IsVideoName(it.n || it.name || ''); })
        },
        {
          mode: mode,
          offlineName: t.offlineName || '',
          createdAt: t.createdAt,
          slackMs: AUTO115_DIR_SLACK_MS,
          titles: pc115TidyTitles(_doc),
          year: _doc.year,
          itemTime: auto115ItemTime
        }
      );
    });
  }

  function auto115StepMkdir(t) {
    if (!auto115WriteEnter(t, 'mkdir')) return Promise.resolve(null);
    auto115Set(t, 'mkdir', 'running', '正在定位离线落地的文件夹…');
    return auto115LocateTarget(t, 'offline').then(function (hit) {
      if (hit && hit.kind === 'dir') {
        var cid = String(hit.item.cid);
        if (cid === C115_DEFAULT_DIR_CID) { auto115Set(t, 'mkdir', 'fail', '没找到合适的文件夹'); auto115Finish(t); return null; }
        t.offlineDirCid = cid; t.offlineDirName = hit.item.n || ''; t.tidyScore = hit.score || 0;
        auto115Set(t, 'mkdir', 'ok', '已定位文件夹：' + (hit.item.n || ''));
        /* 方案 B：先改容器（第 4 步 cleanup），再整理内容 */
        return auto115StepCleanup(t);
      }
      if (hit && hit.kind === 'file') {
        t.noFolder = true;
        t.videoFid = String(hit.item.fid); t.videoName = hit.item.n || ''; t.videoSize = Number(hit.item.s) || 0;
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
  function auto115MovieVideoName(videoName, doc) { return Auto115Core.movieVideoName(doc || auto115Doc, videoName ? Auto115Core.qualityTag(videoName) : ''); }
  function auto115LooksDvd(s) { return Auto115Core.looksDvd(s); }
  function auto115CleanName(s) { return Auto115Core.cleanName(s); }
  function auto115ExternalBaseName(t) { return Auto115Core.externalBaseName(t); }
  function auto115VidSize(it) { return Auto115Core.vidSize(it); }
  /* v356 期三收口：与 iOS 同构——补 mode 参数（null=移动+改名合并 / 'rename' 只改名 / 'move' 只移动）
     与逐条 job.pid（优先于 targetCid）。此前 PC 不认 pid，合集归夹靠 targetCid 兜底，现在语义一致。 */
  function auto115ApplyRenames(t, jobs, targetCid, mode) {
    return jobs.reduce(function (p, job) {
      if (!job || !job.fid) return p;
      return p.then(function () {
        var chain = Promise.resolve();
        /* 目标父目录：优先用 job.pid（每条任务可带独立父目录，如季夹/合集夹），否则用统一的 targetCid */
        var pid = job.pid || targetCid;
        if (mode !== 'rename' && pid) {
          chain = chain.then(function () { return auto115Post('https://webapi.115.com/files/move', 'fid=' + encodeURIComponent(job.fid) + '&pid=' + encodeURIComponent(pid)); });
        }
        /* 只移动模式：跳过改名 */
        if (mode === 'move') return chain;
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
  /* v354 期二（iOS 镜像）：统一执行漏斗。计划条目 op 分派——mkdir → EnsureDir；del → DeleteBatch（按 pid 分组）；
     rename/move → ApplyRenames（PC 版暂无 mode 参数，targetCid 直传；PC 无多磁力链）。 */
  function auto115ExecPlan(t, entries, opts) {
    opts = opts || {};
    var plan = Auto115Core.splitPlan(entries);
    var chain = Promise.resolve();
    plan.mkdirs.forEach(function (e) {
      chain = chain.then(function () {
        return auto115EnsureDir(e.pid || opts.targetCid || C115_DEFAULT_DIR_CID, e.name).then(function (cid) { e._cid = cid || ''; return cid; });
      });
    });
    if (plan.dels.length) {
      chain = chain.then(function () {
        var byPid = {};
        plan.dels.forEach(function (e) {
          var p = String(e.pid || opts.targetCid || C115_DEFAULT_DIR_CID);
          (byPid[p] = byPid[p] || []).push(String(e.fid));
        });
        var p = Promise.resolve();
        Object.keys(byPid).forEach(function (pid) {
          p = p.then(function (msg) { return auto115DeleteBatch(pid, byPid[pid]); });
        });
        return p;
      });
    }
    var rest = plan.renames.concat(plan.moves);
    if (rest.length) chain = chain.then(function () { return auto115ApplyRenames(t, rest, opts.targetCid, opts.mode); });
    return chain;
  }
  /* v356 期三收口：散装 job（{fid,name,orig,size,pid}）打 op:'move' 标转计划条目，供 ExecPlan 执行（iOS 镜像） */
  function auto115PlanMoves(jobs) {
    return (jobs || []).filter(Boolean).map(function (j) { j.op = 'move'; return j; });
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
  function auto115TvPlan(showTitle, items, dirSeason) { return Auto115Core.tvPlan(showTitle, items, dirSeason); }
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
      /* 子文件夹穿透：种子套层结构（种子名/内层夹/剧集文件）也要能识别 */
      return auto115FlattenSubDirs(t, list);
    }).then(function (list) {
      /* 相关夹并入（v345，镜像 iOS）：同剧多次离线落在其他夹的内容一并整理 */
      var _doc = auto115TaskDoc(t) || {};
      var exCids = {}; exCids[String(t.offlineDirCid)] = 1;
      var exNames = {}; exNames[auto115TvDirName(_doc.filmTitle || '')] = 1;
      return auto115FindRelatedDirs(_doc.filmTitle, exCids, exNames).then(function (rel) {
        if (!rel.length) return list;
        t._relatedCids = rel.map(function (r) { return r.cid; });
        return Promise.all(rel.map(function (r) {
          return auto115ListDir(r.cid).then(function (l2) { return auto115FlattenSubDirs(t, l2 || []); }).catch(function () { return []; });
        })).then(function (gs) { return list.concat.apply(list, gs); });
      });
    }).then(function (list) {
      /* 体积字段两个名字都给：tvPlan 读 it.s */
      return list.map(function (it) { return { fid: it.fid ? String(it.fid) : null, name: it.n || it.name || '', cid: (it.cid || '').toString(), s: it.s || 0, size: it.s || 0 }; }).filter(function (it) { return (it.fid || it.cid) && it.name; });
    });
  }
  function auto115StepTvCleanupFiles(t){
    if (!auto115WriteEnter(t, 'move')) return Promise.resolve(null);
    auto115Set(t, 'move', 'running', '正在识别并清除无关文件…');
    if (!t.offlineDirCid && !t.noFolder){ auto115Set(t, 'move', 'fail', '文件夹没定位到，点「重试」再试一次'); auto115Finish(t); return Promise.resolve(null); }
    return auto115StepTvGetItems(t).then(function (items) {
      var plan = auto115TvPlan((auto115TaskDoc(t) || {}).filmTitle, items, Auto115Core.seasonOfDir(t.offlineDirName));
      if (!plan.renames.length){ auto115Set(t, 'move', 'fail', '没有可识别的视频文件，点「重试」'); auto115Finish(t); return null; }
      t.tvPlan = plan;
      var delIds = plan.deleteFids.filter(Boolean);
      if (!delIds.length){ auto115Set(t, 'move', 'ok', '没有无关文件，保留 ' + plan.renames.length + ' 个文件'); return auto115StepTvRenameVideos(t); }
      auto115Set(t, 'move', 'running', '保留 ' + plan.renames.length + ' 个文件，正在删除 ' + delIds.length + ' 项无关文件…');
      var parent = t.noFolder ? C115_DEFAULT_DIR_CID : t.offlineDirCid;
      /* v356 期三收口：删除统一走 ExecPlan（op:'del' 条目按 pid 分组批删，返回错误消息；iOS 镜像） */
      return auto115ExecPlan(t, delIds.map(function (f) { return { op: 'del', fid: f, pid: parent }; })).then(function (errMsg) {
        if (errMsg){ auto115Set(t, 'move', 'fail', errMsg); auto115Finish(t); return null; }
        auto115Set(t, 'move', 'ok', '已清除 ' + delIds.length + ' 项无关文件，保留 ' + plan.renames.length + ' 个文件');
        return auto115StepTvRenameVideos(t);
      });
    }).catch(function (e) { auto115Set(t, 'move', 'fail', (e && e.message) ? e.message : '网络错误'); auto115Finish(t); return null; });
  }
  function auto115StepTvRenameVideos(t){
    if (!auto115WriteEnter(t, 'rename')) return Promise.resolve(null);
    /* 期三第 2 刀（iOS 镜像）：本节点 = 判分季 → 建季夹 → 改名 → 冲突感知移入 → 未识别归拢 → 收尾。
       原 mkdir2（建季夹）/ move2（移入季夹）两节点并入此处；两函数保留仅供存量任务兼容分发。 */
    auto115Set(t, 'rename', 'running', '正在整理：判分季、建季夹…');
    var plan = t.tvPlan;
    if (!plan || !plan.renames.length){ auto115Set(t, 'rename', 'fail', '没有可整理的文件'); auto115Finish(t); return Promise.resolve(null); }
    var seasons = {};
    plan.renames.forEach(function (r) { var mm = r.name.match(/S(\d{2})E/); if (mm) seasons[mm[1]] = true; });
    var seasonNums = Object.keys(seasons).sort();
    if (!seasonNums.length){ auto115Set(t, 'rename', 'fail', '未能识别季号'); auto115Finish(t); return Promise.resolve(null); }
    var need = auto115TvNeedSeasonSplit(plan);
    if (!need.split){ t.tvFlat = true; t.tvSeasonMap = null; }
    else t.tvFlat = false;
    var execRenames = function () {
      var needRename = plan.renames.filter(function (r) { return r.orig !== r.name; }).length;
      auto115Set(t, 'rename', 'running', (t.tvFlat ? need.reason + '，' : '') + '正在按 SxxExx 规则重命名视频/字幕…');
      /* v354 期二：改名统一走 ExecPlan（tvPlan 条目补 op:'rename'） */
      return auto115ExecPlan(t, plan.renames.map(function (r) { r.op = 'rename'; return r; }), { mode: 'rename' }).then(function () {
        if (!needRename) auto115Set(t, 'rename', 'running', '文件名已符合规则，正在归位…');
        return auto115TvMovePhase(t, 'rename');
      });
    };
    if (t.tvFlat) return execRenames();
    auto115Set(t, 'rename', 'running', '正在新建季文件夹…');
    var parentPromise;
    if (t.tvRootCid) {
      parentPromise = Promise.resolve(t.tvRootCid);
    } else if (t.noFolder) {
      parentPromise = auto115EnsureTvRoot((auto115TaskDoc(t) || {}).filmTitle).then(function (cid) { if (!cid) throw new Error('创建剧集根文件夹失败'); t.tvRootCid = cid; return cid; });
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
        return execRenames();
      });
    }).catch(function (e) { auto115Set(t, 'rename', 'fail', (e && e.message) ? e.message : '网络错误'); auto115Finish(t); return null; });
  }
  function auto115StepTvMkdirSeasons(t){
    if (!auto115WriteEnter(t, 'mkdir2')) return Promise.resolve(null);
    auto115Set(t, 'mkdir2', 'running', '正在判断是否分季…');
    var plan = t.tvPlan;
    if (!plan || !plan.renames.length){ auto115Set(t, 'mkdir2', 'fail', '没有可整理的文件'); auto115Finish(t); return Promise.resolve(null); }
    var seasons = {};
    plan.renames.forEach(function (r) { var mm = r.name.match(/S(\d{2})E/); if (mm) seasons[mm[1]] = true; });
    var seasonNums = Object.keys(seasons).sort();
    if (!seasonNums.length){ auto115Set(t, 'mkdir2', 'fail', '未能识别季号'); auto115Finish(t); return Promise.resolve(null); }
    var need = auto115TvNeedSeasonSplit(plan);
    var flatName = t.finalDirName || auto115TvDirName((auto115TaskDoc(t) || {}).filmTitle);
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
      parentPromise = auto115EnsureTvRoot((auto115TaskDoc(t) || {}).filmTitle).then(function (cid) { if (!cid) throw new Error('创建剧集根文件夹失败'); t.tvRootCid = cid; return cid; });
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
    /* 兼容壳（期三第 2 刀）：仅供存量任务在 move2 节点续跑；新任务由改名节点内的 auto115TvMovePhase 接力 */
    if (!auto115WriteEnter(t, 'move2')) return Promise.resolve(null);
    return auto115TvMovePhase(t, 'move2');
  }
  /* 移入执行段（原 move2 主体）：stepKey 决定状态写到哪个步骤——新任务写 rename（合并节点），存量任务写 move2 */
  function auto115TvMovePhase(t, stepKey){
    auto115Set(t, stepKey, 'running', '正在整理文件位置…');
    var plan = t.tvPlan, map = t.tvSeasonMap;
    if (!plan){ auto115Set(t, stepKey, 'fail', '缺少整理计划'); auto115Finish(t); return Promise.resolve(null); }
    var flatName = t.finalDirName || auto115TvDirName((auto115TaskDoc(t) || {}).filmTitle);
    var rootCid = t.tvRootCid;
    /* 未识别集号的视频：整条移入「未识别」文件夹，绝不臆造 SxxExx（对齐移动端 v336） */
    var unrecPromise = Promise.resolve(null);
    if (plan.unrecognized && plan.unrecognized.length && rootCid){
      unrecPromise = auto115FindDir(rootCid, Auto115Core.UNRECOGNIZED_DIR).then(function (d) {
        var uncid = d ? d.cid : null;
        if (!uncid) return auto115Post('https://webapi.115.com/files/add', 'pid=' + encodeURIComponent(rootCid) + '&cname=' + encodeURIComponent(Auto115Core.UNRECOGNIZED_DIR)).then(function (res) {
          var dd = res.d || {}, ddd = dd.data || {};
          var cid = String(ddd.cid || ddd.file_id || ddd.id || dd.cid || res.cid || '');
          if (!res.ok || !(dd.state === true || dd.errno === 0) || !cid) throw new Error('创建未识别文件夹失败');
          return cid;
        });
        return uncid;
      }).then(function (uncid) {
        if (!uncid) return null;
        var jobs = plan.unrecognized.map(function (u) { return { fid: u.fid, name: u.name, orig: u.orig || u.name, size: u.size }; });
        return auto115MoveInto(t, jobs, uncid);
      }).catch(function () { return null; });
    }
    return unrecPromise.then(function () {
    /* 不分季模式：文件统一平铺到剧集根文件夹（命名仍带 SxxExx）。
       注意文件可能嵌在根下的子文件夹里（穿透扫描后种子套层很常见），
       所以**不能因为「目标=当前夹」就跳过**——照常发起移动，planMoveJobs 会把
       已在目标里同名同大小的文件自动跳过，只有真正嵌在子夹里的才会搬上来。 */
    if (t.tvFlat){
      var flatTarget = t.tvRootCid || (t.noFolder ? C115_DEFAULT_DIR_CID : t.offlineDirCid);
      if (!flatTarget || !plan.renames.length){
        auto115Set(t, stepKey, 'skip', '没有需要移动的文件');
        auto115Finish(t);
        return Promise.resolve(null);
      }
      if (t.noFolder){
        auto115Set(t, stepKey, 'skip', '文件已在云下载根目录，无需移动');
        auto115Finish(t);
        return Promise.resolve(null);
      }
      var flatJobs = plan.renames.map(function (r) { return { fid: r.fid, name: r.name, orig: r.name, size: r.size }; });
      return auto115MoveInto(t, flatJobs, flatTarget).then(function (res) {
        auto115Set(t, stepKey, 'ok', res.moved
          ? ('已把 ' + res.moved + ' 个文件放到「' + flatName + '」' + (res.skipped ? ('（跳过 ' + res.skipped + ' 个已存在的相同文件）') : ''))
          : ('文件已在「' + flatName + '」内，无需移动' + (res.skipped ? ('（核对 ' + res.skipped + ' 个文件）') : '')));
        auto115Finish(t);
        /* 收尾：把搬空了的老季文件夹（Outlander.S01 等）删掉；里面还有遗留文件的不动 */
        var tidy = auto115RemoveEmptySubDirs(t, t.offlineDirCid);
        /* 并入同名剧集夹：夹里有遗留文件（认不出集号被保留的）→ 临时夹整体保留不动 */
        if (t.tvMergeCid){
          return tidy.then(function () {
            return auto115TvLeftoverJobs(t, plan).then(function (leftJobs) {
              if (leftJobs.length) return null;
              return auto115RemoveTmpDir(t).then(function () { return null; });
            });
          });
        }
        if (t.noFolder) return auto115RemoveTmpDir(t).then(function () { return null; });
        return tidy.then(function () { return null; });
      }).catch(function (e) { auto115Set(t, stepKey, 'fail', (e && e.message) ? e.message : '网络错误'); auto115Finish(t); return null; });
    }
    if (!map){ auto115Set(t, stepKey, 'fail', '缺少季文件夹信息'); auto115Finish(t); return Promise.resolve(null); }
    var bySeason = {};
    plan.renames.forEach(function (r) {
      var mm = r.name.match(/S(\d{2})E/);
      if (!mm) return;
      var s = mm[1], cid = map[s];
      if (cid) { (bySeason[s] = bySeason[s] || []).push({ fid: r.fid, name: r.name, orig: r.name, size: r.size }); }
    });
    var seasonKeys = Object.keys(bySeason);
    if (!seasonKeys.length){ auto115Set(t, stepKey, 'fail', '没有可移动的文件'); auto115Finish(t); return Promise.resolve(null); }
    /* 逐季移入：季夹里已有同名文件时——大小相同视为同一文件跳过，大小不同加 .2 避免撞名 */
    var moved = 0, skipped = 0;
    var p = Promise.resolve();
    seasonKeys.forEach(function (s) {
      p = p.then(function () {
        return auto115MoveInto(t, bySeason[s], map[s]).then(function (res) { moved += res.moved; skipped += res.skipped; });
      });
    });
    return p.then(function () {
      auto115Set(t, stepKey, 'ok', '已移入 ' + moved + ' 个文件到对应季文件夹' + (skipped ? ('（跳过 ' + skipped + ' 个已存在的相同文件）') : ''));
      auto115Finish(t);
      /* 并入同名剧集夹场景：夹里文件已全部处理才删临时夹；
         有遗留文件（认不出集号被保留的）→ 临时夹整体保留不动 */
      if (t.tvMergeCid) {
        return auto115TvLeftoverJobs(t, plan).then(function (leftJobs) {
          if (leftJobs.length) return null;
          return auto115RemoveTmpDir(t).then(function () { return null; });
        });
      }
      return Promise.resolve(null);
    }).catch(function (e) { auto115Set(t, stepKey, 'fail', (e && e.message) ? e.message : '网络错误'); auto115Finish(t); return null; });
    });
  }
  /* 剧集平铺收尾：把「搬空了的子文件夹」删掉（如原有的 Outlander.S01–S05 老季夹——
     里面的视频已全部搬到剧集根）。只删**空夹**：里面还留着文件（遗留/认不出的）一律不动。 */
  function auto115RemoveEmptySubDirs(t, dirCid) {
    if (!dirCid || dirCid === C115_DEFAULT_DIR_CID) return Promise.resolve(null);
    return auto115ListDir(dirCid).then(function (list) {
      var subs = (list || []).filter(function (it) { return it && it.cid && !it.fid; });
      if (!subs.length) return null;
      return Promise.all(subs.map(function (s) {
        return auto115ListDir(s.cid).then(function (inner) {
          if (inner && inner.length) return null;                    // 还有东西 → 保留
          return auto115DeleteBatch(dirCid, [String(s.cid)]).catch(function () { return null; });
        }).catch(function () { return null; });
      })).then(function () { return null; });
    }).catch(function () { return null; });
  }
  /* 剧集并入临时夹删除前的「遗留文件」探测：tvPlan 认不出集号但被保留的视频/字幕
     （v256 起不删不改名）还躺在临时离线夹里 → 并入（tvMergeCid）后删临时夹会带走它们。
     有遗留文件即视为「夹里还有东西」，临时夹整体保留不动。 */
  function auto115TvLeftoverJobs(t, plan) {
    if (!t.offlineDirCid || t.offlineDirCid === C115_DEFAULT_DIR_CID) return Promise.resolve([]);
    return auto115ListDir(t.offlineDirCid).then(function (list) {
      return auto115FlattenSubDirs(t, list);   // 套层结构同样穿透，嵌在子夹里的遗留也要能看到
    }).then(function (left) {
      var done = {};
      (plan.renames || []).forEach(function (r) { done[String(r.fid)] = 1; });
      (plan.deleteFids || []).forEach(function (f) { done[String(f)] = 1; });
      return (left || []).filter(function (it) {
        if (!it || !it.fid || done[String(it.fid)]) return false;
        var nm = it.n || it.name || '';
        return auto115IsVideoName(nm) || auto115IsSubtitle(nm);
      }).map(function (it) {
        var nm = it.n || it.name || '';
        return { fid: String(it.fid), name: nm, orig: nm, size: it.s || 0 };
      });
    });
  }
  /* 子文件夹穿透（对齐移动端 v270/v271）：115 离线的种子常是「种子名/内层夹/视频」的套层结构，
     只扫一层看不到视频。始终下钻（最多 3 层、每层最多 10 个夹），EXCLUDE 名字的子夹（sample/预告…）跳过；
     内容合并进工作列表，后续保留/删除/改名全按 fid，不受层级影响。 */
  function auto115FlattenSubDirs(t, list, depth) {
    depth = depth || 0;
    list = list || [];
    if (depth >= 3) return Promise.resolve(list);
    var EXCL = /sample|预告|trailer|preview|特典|extra|花絮|menu|bonus/i;
    var subs = list.filter(function (it) { return it && it.cid && !it.fid && !EXCL.test(it.n || it.name || ''); });
    if (!subs.length) return Promise.resolve(list);
    return Promise.all(subs.slice(0, 10).map(function (s) {
      return auto115ListDir(s.cid).then(function (inner) { return auto115FlattenSubDirs(t, inner, depth + 1); }).catch(function () { return []; });
    })).then(function (inners) {
      var merged = list.slice();
      inners.forEach(function (inner) { merged = merged.concat(inner || []); });
      return merged;
    });
  }
  /* 「修改标题文件夹」（方案 B 第 4 步）已并入 auto115StepCleanup 的 TV 分支。
     清理步骤（对齐移动端 v262–v269）：保留主视频（多 part 全保留）、字幕、其他视频（合集保护），
     只删明确垃圾——重复副本、第三档以下清晰度、sample/预告类、非视频非字幕杂项、垃圾名子夹。
     绝不因为「没被选为主视频」就删视频文件：合集包里的另一部片（如「赌神 2部全」里的赌神2）删掉就是真丢片。 */
  /* 单磁力电影：保留多条视频（合集/系列）时系列反查（v336，与移动端共用 planMovieNames）。
     把多视频当「伪磁力」传入，命中系列部名则逐条按部名改名；否则不动（沿用默认 .cdN）。 */
  function auto115FetchCollectionParts(collectionId) {
    if (!collectionId) return Promise.resolve(null);
    if (typeof NfoCore === 'undefined' || !NfoCore.tmdbRequest) return Promise.resolve(null);
    /* v347：补 TMDB 请求参数（自填 key 直连 / 无则走 Worker 代理）——此前传空 opts 必报「未配置 TMDB」 */
    return Promise.all([getTMDBKey(), getActivationCode()]).then(function (res) {
      var opts = { ownKey: res[0] || '', workerBase: state.magnetWorker || DEFAULT_WORKER, code: res[1] || '' };
      return NfoCore.tmdbRequest('/collection/' + collectionId, { language: 'zh-CN' }, opts);
    }).then(function (d) {
      if (!d || !d.parts) return null;
      /* v348：带上原文名——磁力文件名常是英文（Police.Academy…），只有中文标题匹配不上 */
      /* v351：同时带回合集名称（d.name）——合集归夹用文件夹名（镜像 iOS） */
      return {
        name: d.name || '',
        parts: (d.parts || []).map(function (p) { return { id: p.id, title: p.title || '', originalTitle: p.original_title || p.original_name || '', release_date: p.release_date || '' }; })
      };
    }).catch(function () { return null; });
  }
  /* v349：合集 ID 自愈（镜像 iOS）——老影片资料缺 collectionId 时按 tmdbId / 标题+年份查 TMDB 补上并落库 */
  function auto115EnsureCollectionId(doc) {
    if (doc.collectionId) return Promise.resolve(doc.collectionId);
    if (doc.type === 'tv') return Promise.resolve('');
    return Promise.all([getTMDBKey(), getActivationCode()]).then(function (res) {
      var opts = { ownKey: res[0] || '', workerBase: state.magnetWorker || DEFAULT_WORKER, code: res[1] || '' };
      if (doc.tmdbId) return NfoCore.tmdbRequest('/movie/' + doc.tmdbId, { language: 'zh-CN' }, opts);
      var params = { language: 'zh-CN', query: doc.filmTitle };
      if (doc.year) params.primary_release_year = doc.year;
      return NfoCore.tmdbRequest('/search/movie', params, opts).then(function (s) {
        var r = (s && s.results && s.results[0]) || null;
        return r ? NfoCore.tmdbRequest('/movie/' + r.id, { language: 'zh-CN' }, opts) : null;
      });
    }).then(function (d) {
      var cid = (d && d.belongs_to_collection && d.belongs_to_collection.id) ? String(d.belongs_to_collection.id) : '';
      if (cid) { doc.collectionId = cid; if (d && d.id) doc.tmdbId = String(d.id); auto115Save(); }
      return cid;
    }).catch(function () { return ''; });
  }
  function auto115MoviePrepMultiParts(t, keep, others) {
    var doc = auto115TaskDoc(t) || {};
    others = others || [];
    /* v347：合集保护留下的其他视频也参与反查（镜像 iOS）。主视频批保持整批语义；其他视频逐条匹配。 */
    if (!((keep && keep.length >= 2) || others.length >= 1)) return Promise.resolve(null);
    /* v349：collectionId 缺失时自愈补查（老影片不用手动刷新） */
    return auto115EnsureCollectionId(doc).then(function (cid) {
      if (!cid) return null;
      var ms = keep.concat(others).map(function (it) { return { dirName: it.n || it.name || '', title: it.n || it.name || '' }; });
      return auto115FetchCollectionParts(cid).then(function (coll) {
      if (!coll || !coll.parts || !coll.parts.length) return null;
      var parts = coll.parts;
      var keepMs = ms.slice(0, keep.length);
      var keepPlan = Auto115Core.planMovieNames(keepMs, { filmTitle: doc.filmTitle, collectionId: cid, parts: parts });
      var nameMap = {}, extMap = {};
      keep.forEach(function (it, i) {
        var fid = String(it.fid);
        var ext = (/\.[a-z0-9]+$/i.exec(it.n || it.name || '') || ['.mp4'])[0];
        nameMap[fid] = keepMs[i].renameTo || doc.filmTitle;
        extMap[fid] = ext;
      });
      /* 其他视频：逐条反查；本片自己的部先占坑——命中的只是本片另一版本，维持保护不搬 */
      var used = {};
      var selfPart = Auto115Core.matchCollectionPart({ dirName: doc.filmTitle, title: doc.filmTitle }, parts, {});
      if (selfPart) used[selfPart.id || selfPart.title] = true;
      var oNameMap = {}, oExtMap = {};
      others.forEach(function (it, j) {
        var m = ms[keep.length + j];
        var part = Auto115Core.matchCollectionPart(m, parts, used);
        if (!part) return;
        used[part.id || part.title] = true;
        var fid = String(it.fid);
        var ext = (/\.[a-z0-9]+$/i.exec(it.n || it.name || '') || ['.mp4'])[0];
        oNameMap[fid] = part.title; oExtMap[fid] = ext;
      });
      t._keepPartNames = nameMap; t._keepExts = extMap;
      t._otherPartNames = oNameMap; t._otherExts = oExtMap;
      /* v351：合集归夹——识别成功（主批按部名 或 有其他部命中）且 TMDB 有合集名时，确保合集名文件夹（镜像 iOS） */
      if (coll.name && (keepPlan.mode === 'series' || Object.keys(oNameMap).length)) {
        var dirName = pcSanitizeName(Auto115Core.stripCollTag(coll.name));
        if (dirName) {
          return auto115EnsureDir(C115_DEFAULT_DIR_CID, dirName).then(function (ccid) {
            if (ccid) { t._collDirCid = String(ccid); t._collDirName = dirName; }
            return null;
          }).catch(function () { return null; });
        }
      }
      return null;
      });
    });
  }
  /* v347：反查命中的合集其他视频 → 按各自部名改名，平铺搬到云下载根目录（镜像 iOS） */
  /* 词干归一：去扩展名、小写、分隔符归一（v350 字幕认领用，镜像 iOS） */
  function auto115SubStem(n) {
    return String(n || '').replace(/\.[a-z0-9]+$/i, '').toLowerCase().replace(/[\s._\-]+/g, ' ').trim();
  }
  function auto115OtherPartJobs(t) {
    var oNameMap = t._otherPartNames || null; t._otherPartNames = null;
    var oExtMap = t._otherExts || null; t._otherExts = null;
    if (!oNameMap || !t.keptOthers || !t.keptOthers.length) return null;
    /* v351：合集归夹——命中的部带 pid 移进合集夹（_collDirCid 在改名函数里先读走主视频用，这里消费掉，镜像 iOS） */
    var collCid = t._collDirCid || null; t._collDirCid = null;
    t._collDirName = null;
    var jobs = [], moved = {};
    var otherSubs = t.otherSubs || []; t.otherSubs = null;
    t.keptOthers.forEach(function (o) {
      var fid = String(o.fid);
      var nm = oNameMap[fid];
      if (!nm) return;
      var ext = (oExtMap && oExtMap[fid]) || (/\.[a-z0-9]+$/i.exec(o.name || '') || ['.mp4'])[0];
      jobs.push({ fid: fid, name: nm + ext, orig: o.name, size: o.size || 0, pid: collCid });
      moved[fid] = true;
      /* v350：该部的字幕跟随搬出（清理阶段按词干认领的 otherSubs，镜像 iOS） */
      for (var si = 0; si < otherSubs.length; si++) {
        var s = otherSubs[si];
        if (String(s.host) !== fid) continue;
        jobs.push({ fid: s.fid, name: Auto115Core.subNameForVideo(nm + ext, s.name), orig: s.name, size: s.size || 0, pid: collCid });
      }
    });
    if (!jobs.length) return null;
    return { jobs: jobs, moved: moved };
  }
  function auto115PruneKeptOthers(t, moved) {
    if (!moved || !t.keptOthers) return 0;
    var rest = t.keptOthers.filter(function (o) { return !moved[String(o.fid)]; });
    var n = t.keptOthers.length - rest.length;
    t.keptOthers = rest;
    t.keptOtherVideos = rest.length;
    return n;
  }
  function auto115StepMove(t) {
    if (!auto115WriteEnter(t, 'move')) return Promise.resolve(null);
    if (t.noFolder) { auto115Set(t, 'move', 'skip', '单文件落地，无需清理'); return auto115StepRename(t); }
    if (!t.offlineDirCid || t.offlineDirCid === C115_DEFAULT_DIR_CID) { auto115Set(t, 'move', 'fail', '文件夹没定位到，点「重试」再试一次'); auto115Finish(t); return Promise.resolve(null); }
    auto115Set(t, 'move', 'running', '正在扫描文件夹内容…');
    return auto115ListDir(t.offlineDirCid).then(function (list) {
      return auto115FlattenSubDirs(t, list);
    }).then(function (list) {
      /* 相关夹并入（v345，镜像 iOS）：同一部片多次离线落在多个夹时一并参选 */
      var _doc = auto115TaskDoc(t) || {};
      var exCids = {}; exCids[String(t.offlineDirCid)] = 1;
      var exNames = {}; exNames[pcSanitizeName(_doc.filmTitle || '')] = 1;
      if (_doc.filmTitle) exNames[_doc.filmTitle] = 1;
      return auto115FindRelatedDirs(_doc.filmTitle, exCids, exNames).then(function (rel) {
        if (!rel.length) return list;
        t._relatedCids = rel.map(function (r) { return r.cid; });
        return Promise.all(rel.map(function (r) {
          return auto115ListDir(r.cid).then(function (l2) { return auto115FlattenSubDirs(t, l2 || []); }).catch(function () { return []; });
        })).then(function (gs) { return list.concat.apply(list, gs); });
      });
    }).then(function (list) {
      var vids = list.filter(function (it) { return it && it.fid && auto115IsVideoName(it.n || it.name || ''); });
      if (!vids.length) { auto115Set(t, 'move', 'fail', '这个文件夹里没有视频'); auto115Finish(t); return null; }
      /* 字幕不删，后续跟随主视频一起规范命名 */
      var subs = list.filter(function (it) { return it && it.fid && !auto115IsVideoName(it.n || it.name || '') && auto115IsSubtitle(it.n || it.name || ''); });
      t.subInfos = subs.map(function (it) { return { fid: String(it.fid), name: it.n || it.name || '', lang: Auto115Core.subLang(it.n || it.name || '') }; });
      var subFids = (t.subInfos || []).map(function (s) { return s.fid; });
      var EXCLUDE = /sample|预告|trailer|preview|特典|extra|花絮|menu|bonus/i;
      var mainCands = vids.filter(function (it) { return !EXCLUDE.test(it.n || it.name || ''); });
      var pool = mainCands.length ? mainCands : vids;
      /* 强信号优先：番号（AV）走归一化子串（番号独特性强）；标题/原始标题走整词边界匹配（v262 修 V2），
         「赌神2.1080p」不再命中「赌神」——标题后紧跟数字/字母视为续集，不算本片。 */
      var normDvd = auto115Norm((auto115TaskDoc(t) || {}).dvdId);
      var _ctx0 = auto115TaskDoc(t) || {};
      var titleList = [_ctx0.filmTitle, _ctx0.originalTitle].filter(Boolean);
      function strongHit(it) {
        var nm = it.n || it.name || '';
        if (normDvd && auto115Norm(nm).indexOf(normDvd) >= 0) return true;
        if (!normDvd && titleList.length && Auto115Core.titleHit(nm, titleList)) return true;
        return false;
      }
      var keep;
      var secondPick = null;   // 次清晰度版本：跟随主视频改名，最多 1 个
      var lowDelFids = {};     // 第三档及以下清晰度（最多保留两个清晰度，其余删）
      var strong = pool.filter(strongHit);
      if (strong.length) {
        keep = strong;
        /* 强命中不止一个：① 全带分碟标记 → 真分碟，维持 .cdN；② 清晰度混档 → 一部片的多个版本，
           最高清当主视频、次清晰度跟随改名，更低清删掉（避免被当成 赌神.cd1/cd2 的两半） */
        if (strong.length > 1) {
          var allParts = strong.every(function (it) { return Auto115Core.partMark(it.n || it.name || ''); });
          if (!allParts) {
            var byRank = {}, bestRank = 0;
            strong.forEach(function (it) {
              var r = Auto115Core.qualityRank(it.n || it.name || '');
              (byRank[r] = byRank[r] || []).push(it);
              if (r > bestRank) bestRank = r;
            });
            var ranks = Object.keys(byRank).map(Number).filter(function (r) { return r > 0; }).sort(function (a, b) { return b - a; });
            if (ranks.length >= 2) {
              keep = byRank[bestRank].slice().sort(function (a, b) { return auto115VidSize(b) - auto115VidSize(a); });
              secondPick = byRank[ranks[1]].slice().sort(function (a, b) { return auto115VidSize(b) - auto115VidSize(a); })[0];
              for (var ri = 2; ri < ranks.length; ri++) {
                byRank[ranks[ri]].forEach(function (it) { lowDelFids[String(it.fid)] = true; });
              }
            }
          }
        }
      } else {
        /* 多 part 分组（cd/disc/part/尾随数字），同组 ≥2 视为一部片的分碟，全部保留 */
        var groups = {};
        pool.forEach(function (it) { var b = auto115PartBase(it.n || it.name || ''); (groups[b] = groups[b] || []).push(it); });
        var partKeys = Object.keys(groups).filter(function (b) { return groups[b].length >= 2; });
        if (partKeys.length) { keep = []; partKeys.forEach(function (b) { keep = keep.concat(groups[b]); }); }
        else { keep = [pool.slice().sort(function (a, b) { return auto115VidSize(b) - auto115VidSize(a); })[0]]; }
        /* 弱命中也能配对次清晰度（修「zjz6 夹里 720p 没识别」）：视频名是缩写、命中不了标题时，
           其余视频名字主干与主视频一致（去掉清晰度/水印后相同）且清晰度更低 → 取最清晰一档跟随改名 */
        if (keep.length === 1) {
          var mainNm = keep[0].n || keep[0].name || '';
          var mainR = Auto115Core.qualityRank(mainNm);
          if (mainR > 0) {
            pool.forEach(function (it) {
              if (keep.indexOf(it) >= 0) return;
              var nm2 = it.n || it.name || '';
              var r2 = Auto115Core.qualityRank(nm2);
              if (r2 > 0 && r2 < mainR && Auto115Core.sameQualityVersion(mainNm, nm2)) {
                if (!secondPick || r2 > Auto115Core.qualityRank(secondPick.n || secondPick.name || '')) secondPick = it;
              }
            });
          }
        }
      }
      keep.sort(function (a, b) { return auto115VidSize(b) - auto115VidSize(a); });
      /* V1 修复：keep 判重——名称归一相同、或体积字节一致（差 < 1）视为重复副本，只留体积最大的 1 个 */
      var dedup = [], dupFids = [];
      for (var di = 0; di < keep.length; di++) {
        var cand = keep[di];
        var candNm = auto115Norm(cand.n || cand.name || '');
        var candSz = auto115VidSize(cand);
        var isDup = false;
        for (var dj = 0; dj < dedup.length; dj++) {
          var d2 = dedup[dj];
          var d2Nm = auto115Norm(d2.n || d2.name || '');
          if ((candNm && d2Nm && candNm === d2Nm) || (candSz > 0 && Math.abs(auto115VidSize(d2) - candSz) < 1)) { isDup = true; break; }
        }
        if (isDup) { if (cand.fid) dupFids.push(String(cand.fid)); }
        else dedup.push(cand);
      }
      keep = dedup;
      t.keepFids = keep.map(function (it) { return String(it.fid); });
      var v = keep[0];
      t.videoFid = String(v.fid); t.videoName = v.n || v.name || ''; t.videoSize = auto115VidSize(v);
      t.secondVersion = secondPick ? { fid: String(secondPick.fid), name: secondPick.n || secondPick.name || '', size: auto115VidSize(secondPick) } : null;
      var adThreshold = Auto115Core.adSizeThreshold(auto115VidSize(keep[0]));   // 动态广告阈值（主视频 × 20%，夹 5MB–50MB）
      var delIds = [], keptVids = 0, keptOthers = [];
      for (var i = 0; i < list.length; i++) {
        var it = list[i];
        if (!it) continue;
        var nmz = it.n || it.name || '';
        if (it.fid) {
          if (t.keepFids.indexOf(String(it.fid)) >= 0 || subFids.indexOf(String(it.fid)) >= 0) continue;
          if (dupFids.indexOf(String(it.fid)) >= 0) { delIds.push(String(it.fid)); continue; }      // 重复副本
          if (lowDelFids[String(it.fid)]) { delIds.push(String(it.fid)); continue; }                // 第三档以下清晰度
          if (t.secondVersion && String(it.fid) === t.secondVersion.fid) continue;                  // 次清晰度跟随改名
          if (auto115IsVideoName(nmz) && !EXCLUDE.test(nmz)) {
            var sz = auto115VidSize(it);
            /* 远小于主视频（< 主视频×20%，夹在 5MB–50MB）→ 大概率是广告/片头 → 删；
               阈值算不出（0）或取不到体积 → 一律保留，不冒险 */
            if (adThreshold > 0 && sz > 0 && sz < adThreshold) { delIds.push(String(it.fid)); continue; }
            keptVids++;
            /* 合集保护：其他视频留在原文件夹不动，rename 看到它就不删临时夹 */
            keptOthers.push({ fid: String(it.fid), name: nmz, size: sz || 0 });
            continue;
          }
          delIds.push(String(it.fid));
        } else if (it.cid) { if (String(it.cid) !== C115_DEFAULT_DIR_CID && EXCLUDE.test(nmz)) delIds.push(String(it.cid)); }
      }
      t.keptOtherVideos = keptVids;
      t.keptOthers = keptOthers;
      /* v350：其他视频的字幕不跟主片走——按词干认领摘出存 t.otherSubs，rename 时随各自视频搬出（镜像 iOS） */
      if (keptOthers.length) {
        var _oStems = {};
        keptOthers.forEach(function (o) { _oStems[auto115SubStem(o.name)] = String(o.fid); });
        var _mainSubs = [];
        t.otherSubs = [];
        (t.subInfos || []).forEach(function (s) {
          var host = _oStems[auto115SubStem(s.name)];
          if (host) t.otherSubs.push({ fid: s.fid, name: s.name, size: s.size || 0, host: host });
          else _mainSubs.push(s);
        });
        t.subInfos = _mainSubs;
      }
      var subCount = (t.subInfos || []).length;
      var keptMsg = keptVids ? ('，另保留 ' + keptVids + ' 个其他视频（可能是合集，未删除）') : '';
      if (!delIds.length) { auto115Set(t, 'move', 'ok', '只有 ' + keep.length + ' 个视频' + (subCount ? '、' + subCount + ' 个字幕' : '') + keptMsg + '，无需清理'); return auto115MoviePrepMultiParts(t, keep, keptOthers).then(function () { return auto115StepRename(t); }); }
      auto115Set(t, 'move', 'running', '保留 ' + keep.length + ' 个视频' + (subCount ? '、' + subCount + ' 个字幕' : '') + keptMsg + '，正在删除其余 ' + delIds.length + ' 项…');
      return auto115DeleteBatch(t.offlineDirCid, delIds).then(function (errMsg) {
        if (errMsg) { auto115Set(t, 'move', 'fail', errMsg); auto115Finish(t); return null; }
        auto115Set(t, 'move', 'ok', '已清理 ' + delIds.length + ' 项，保留 ' + keep.length + ' 个视频（' + auto115Size(t.videoSize) + '）');
        return auto115MoviePrepMultiParts(t, keep, keptOthers).then(function () { return auto115StepRename(t); });
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
    var ts = (auto115TaskDoc(t) && auto115TaskDoc(t).tasks) || [];
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
  /* 次清晰度版本（对齐移动端 v269）：同片第二档清晰度的文件跟随主视频一起改名搬出，
     影片 → 标题.年份.720p / AV → 番号.720p；最多 1 个（第三档及以下已在清理步删掉）。 */
  function auto115SecondVersionJob(t) {
    var sv = t.secondVersion;
    if (!sv || !sv.fid) return null;
    var e = (/\.[a-z0-9]+$/i.exec(sv.name) || ['.mp4'])[0];
    var sq = Auto115Core.qualityTag(sv.name);
    if (auto115Doc && auto115Doc.dvdId) {
      return { fid: sv.fid, name: (auto115TaskDoc(t) || {}).dvdId + (sq ? ('.' + sq) : '') + e, orig: sv.name, size: sv.size || 0 };
    }
    return { fid: sv.fid, name: auto115MovieVideoName(sv.name, auto115TaskDoc(t)) + e, orig: sv.name, size: sv.size || 0 };
  }
  function auto115StepRename(t) {
    if (!auto115WriteEnter(t, 'rename')) return Promise.resolve(null);
    if (auto115IsTvTask(auto115TaskDoc(t))) return auto115StepTvRenameVideos(t);
    if (t.external) {
      if (!t.targetName) { auto115Set(t, 'rename', 'skip', '未填目标名称，保留 115 原始文件名'); auto115Finish(t); return Promise.resolve(null); }
    }
    var ext = (/\.[a-z0-9]+$/i.exec(t.videoName || '') || ['.mp4'])[0];
    var baseName = t.external ? auto115ExternalBaseName(t) : ((auto115TaskDoc(t) || {}).dvdId ? auto115TaskDoc(t).dvdId : auto115MovieVideoName(t.videoName, auto115TaskDoc(t)));
    if (!baseName) { auto115Set(t, 'rename', 'fail', '缺少名称信息，没法自动改名'); auto115Finish(t); return Promise.resolve(null); }
    var keep = (t.keepFids && t.keepFids.length) ? t.keepFids.slice() : (t.videoFid ? [t.videoFid] : []);
    if (!keep.length) { auto115Set(t, 'rename', 'fail', '未定位到视频文件，请重试'); auto115Finish(t); return Promise.resolve(null); }
    /* 单磁力电影多视频系列反查（v336）：命中系列部名的逐条按部名改名；用完即清，避免污染后续单次改名 */
    var partNameMap = t._keepPartNames || null; t._keepPartNames = null;
    var partExtMap = t._keepExts || null; t._keepExts = null;
    /* v351：合集归夹——主视频与命中的其他部一起进合集夹（先读走，OtherPartJobs 里会消费掉，镜像 iOS） */
    var collDirCid = t._collDirCid || null; t._collDirCid = null;
    var collDirName = t._collDirName || null; t._collDirName = null;
    var othersJob = auto115OtherPartJobs(t);   /* v347：反查命中的合集其他视频（按部名改名→平铺云下载根目录） */
    var multi = keep.length > 1;
    var prev = t.external ? null : (t.forcedMergeCid ? { cid: t.forcedMergeCid, name: t.finalDirName }
      : (collDirCid ? { cid: collDirCid, name: collDirName } : auto115FindMergeTarget(t)));
    if (prev) {
      t.finalDirCid = prev.cid;
      t.finalDirName = prev.name;
      auto115Set(t, 'rename', 'running', '并入文件夹「' + prev.name + '」…');
      return auto115ListDir(prev.cid).then(function (list) {
        var stems = {};
        for (var i = 0; i < list.length; i++) { var nm = String(list[i].n || ''); stems[nm.replace(/\.[a-z0-9]+$/i, '').toLowerCase()] = list[i].s || 0; }
        /* 字幕跟随主视频一起并入并规范命名 */
        var subJobs = (t.subInfos || []).map(function (s) { return { fid: String(s.fid), name: Auto115Core.subNameForVideo(baseName + ext, s.name), orig: s.name, size: 0 }; });
        /* 目标夹已存在同目标名且大小相同的视频 → 同一文件（多为重试），直接收尾。
           stems 的 key 是无扩展名词干（冲突循环也是 stem 语义）——此前用全名查永远是 undefined，
           判重从未生效过（v262 修 V3）。夹里还有合集保护留下来的其他视频时，临时夹整体保留不动（v267 约定） */
        if (!multi && keep.length === 1 && t.videoSize != null) {
          var dupSize = stems[baseName.toLowerCase()];
          if (dupSize != null && Math.abs((t.videoSize || 0) - dupSize) < 1) {
            t.videoName = baseName + ext;
            auto115Set(t, 'rename', 'ok', '视频已在「' + prev.name + '」中，跳过重复文件');
            /* 次清晰度版本仍要改名并入；夹里还有合集保留下来的其他视频 → 临时夹整体保留不动 */
            var dupSvJob = auto115SecondVersionJob(t);
            var dupSv = dupSvJob ? auto115ExecPlan(t, auto115PlanMoves([dupSvJob]), { targetCid: prev.cid }) : Promise.resolve(null);
            return dupSv.then(function () {
              var afterDup = function () {
                if (auto115HasKeptOthers(t)) { auto115Finish(t); return null; }
                return auto115RemoveTmpDir(t).then(function () { auto115Finish(t); return null; });
              };
              /* v347：合集其他视频照搬（v351 起带 pid 归入合集夹；失败不阻塞，维持保护） */
              if (othersJob) return auto115ExecPlan(t, auto115PlanMoves(othersJob.jobs), { targetCid: collDirCid || C115_DEFAULT_DIR_CID }).then(function () { auto115PruneKeptOthers(t, othersJob.moved); }).catch(function () { return null; }).then(afterDup);
              return afterDup();
            });
          }
        }
        var jobs = keep.map(function (fid, i) {
          if (partNameMap && partNameMap[fid]) {
            var pe = (partExtMap && partExtMap[fid]) || ext;
            return { fid: fid, name: partNameMap[fid] + pe, size: t.videoSize };
          }
          var suffix = multi ? ('.cd' + (i + 1)) : '';
          var cand = baseName + suffix, k = 0;
          while (stems[cand.toLowerCase()] != null) {
            k++;
            if (k > 26) { auto115Set(t, 'rename', 'fail', '同名文件太多啦，去 115 手动整理一下'); auto115Finish(t); return null; }
            cand = baseName + '.' + String.fromCharCode(64 + k) + suffix;
          }
          return { fid: fid, name: cand + ext, size: t.videoSize };
        });
        if (jobs.indexOf(null) >= 0) return null;
        var svJob = auto115SecondVersionJob(t);
        var allJobs = jobs.concat(subJobs).concat(svJob ? [svJob] : []);
        var conflictPlan = Auto115Core.planMoveJobs(allJobs, list || []);
        allJobs = conflictPlan.todo;
        return auto115ExecPlan(t, auto115PlanMoves(allJobs), { targetCid: prev.cid }).then(function () {
          t.videoName = jobs[0].name;
          var afterMain = function (movedN) {
            auto115Set(t, 'rename', 'ok', '已移入「' + prev.name + '」并改名为：' + jobs[0].name
              + (multi ? (' 等 ' + allJobs.length + ' 个文件') : (subJobs.length ? (' 等 ' + allJobs.length + ' 个文件') : ''))
              + (conflictPlan.skipped ? ('（' + conflictPlan.skipped + ' 个已存在相同文件，跳过）') : '')
              + (movedN ? ('；合集其他 ' + movedN + ' 部已归入合集文件夹') : '')
              + (auto115HasKeptOthers(t) ? ('；' + t.keptOtherVideos + ' 部未识别为合集，保留原夹') : ''));
            /* 反查没命中的其他视频维持保护 → 临时夹也不删 */
            if (auto115HasKeptOthers(t)) { auto115Finish(t); return null; }
            return auto115RemoveTmpDir(t).then(function () { auto115Finish(t); return null; });
          };
          /* v347：合集其他视频按部名搬出（v351 起带 pid 归入合集夹；失败不阻塞主流程，维持保护） */
          if (othersJob) {
            return auto115ExecPlan(t, auto115PlanMoves(othersJob.jobs), { targetCid: collDirCid || C115_DEFAULT_DIR_CID }).then(function () {
              return afterMain(auto115PruneKeptOthers(t, othersJob.moved));
            }).catch(function () { return afterMain(0); });
          }
          return afterMain(0);
        });
      }).catch(function (e) { auto115Set(t, 'rename', 'fail', (e && e.message) ? e.message : '网络错误'); auto115Finish(t); return null; });
    }
    var jobs = keep.map(function (fid, i) {
      if (partNameMap && partNameMap[fid]) {
        var pe = (partExtMap && partExtMap[fid]) || ext;
        return { fid: fid, name: partNameMap[fid] + pe };
      }
      var suffix = multi ? ('.cd' + (i + 1)) : '';
      return { fid: fid, name: baseName + suffix + ext };
    });
    if (jobs.length) jobs[0].orig = t.videoName; /* 首个视频的当前名，供同名跳过比对 */
    /* 字幕跟随主视频一起规范命名（原地改名，不移动） */
    var subJobsFlat = (t.subInfos || []).map(function (s) { return { fid: String(s.fid), name: Auto115Core.subNameForVideo(jobs[0].name, s.name), orig: s.name, size: 0 }; });
    jobs = jobs.concat(subJobsFlat);
    /* 次清晰度版本跟随主视频一起规范命名 */
    var svJobPlain = auto115SecondVersionJob(t);
    if (svJobPlain) jobs = jobs.concat([svJobPlain]);
    var needRename = jobs.filter(function (j) { return j.orig == null || j.orig !== j.name; }).length;
    auto115Set(t, 'rename', 'running', needRename ? ('正在改名为：' + jobs[0].name + (multi ? (' 等 ' + jobs.length + ' 个视频') : '')) : '正在核对文件名…');
    var afterRenameNoPrev = function (movedN) {
      t.videoName = jobs[0].name;
      var movedMsg = movedN ? ('；合集其他 ' + movedN + ' 部已按片名归档') : '';
      var keptTail = auto115HasKeptOthers(t) ? ('；' + t.keptOtherVideos + ' 部未识别为合集，保留原夹') : '';
      if (!needRename) auto115Set(t, 'rename', 'ok', '文件名已符合规则，无需改名' + movedMsg + keptTail);
      else auto115Set(t, 'rename', 'ok', '已改名为：' + jobs[0].name + (multi ? (' 等 ' + jobs.length + ' 个视频') : '') + movedMsg + keptTail);
      /* 夹里还有合集保护留下来的其他视频 → 临时夹整体保留不动 */
      if (auto115HasKeptOthers(t)) { auto115Finish(t); return null; }
      return auto115RemoveTmpDir(t).then(function () { auto115Finish(t); return null; });
    };
    /* v347：主视频改名后，合集其他视频搬出（失败不阻塞，维持保护） */
    return auto115ExecPlan(t, auto115PlanMoves(jobs)).then(function () {
      if (!othersJob) return afterRenameNoPrev(0);
      return auto115ExecPlan(t, auto115PlanMoves(othersJob.jobs), { targetCid: C115_DEFAULT_DIR_CID }).then(function () {
        return afterRenameNoPrev(auto115PruneKeptOthers(t, othersJob.moved));
      }).catch(function () { return afterRenameNoPrev(0); });
    }).catch(function (e) { auto115Set(t, 'rename', 'fail', (e && e.message) ? e.message : '网络错误'); auto115Finish(t); return null; });
  }
  /* 合集保护守卫（v267 约定）：清理时保下来的「其他视频」只要还有一个在临时夹里，
     就绝不删临时夹——否则「保了又扔」，赌神2 会跟着夹子进回收站。
     这些视频一律留在原文件夹不动，只搬主视频与字幕。 */
  function auto115HasKeptOthers(t) { return !!(t.keptOthers && t.keptOthers.length); }
  /* 扫云下载根目录找「标题相关夹」（v345，镜像 iOS）：同一部片/剧分多次离线落在多个夹，
     只整理本任务定位到的夹会漏内容。规则：文件夹名含完整标题（≥2 字）即相关；
     调用方用 exCids/exNames 排除任务已知源夹与目标夹（剧集根夹/影片夹）。失败静默返回空。 */
  function auto115FindRelatedDirs(title, exCids, exNames) {
    var t = (title || '').trim();
    if (!t || t.length < 2) return Promise.resolve([]);
    return auto115ListDir(C115_DEFAULT_DIR_CID).then(function (list) {
      return (list || []).filter(function (it) {
        if (!it || !it.cid || it.fid) return false;
        if (exCids && exCids[String(it.cid)]) return false;
        var nm = it.n || it.name || '';
        if (exNames && exNames[nm]) return false;
        return nm.indexOf(t) >= 0;
      }).map(function (it) { return { cid: String(it.cid), name: it.n || it.name || '' }; });
    }).catch(function () { return []; });
  }
  /* 自动删除已并入的临时离线目录（不显示在 UI，rename 完成后静默触发）。
     失败也不回退——临时目录留着用户可以手动清，不影响主流程。 */
  function auto115RemoveTmpDir(t) {
    /* 相关夹（v345 并入的标题相关离线夹）收尾：搬空的删掉、有遗留的留着——独立于主夹删除执行 */
    var rel = (t && t._relatedCids) ? t._relatedCids : [];
    if (t) t._relatedCids = null;
    var main = Promise.resolve();
    if (t.finalDirCid && !t.noFolder && t.offlineDirCid && t.offlineDirCid !== C115_DEFAULT_DIR_CID && t.offlineDirCid !== t.finalDirCid) {
      var delBody = 'fid=' + encodeURIComponent(t.offlineDirCid) + '&pid=' + encodeURIComponent(C115_DEFAULT_DIR_CID);
      main = auto115Post('https://webapi.115.com/rb/delete', delBody).then(function (res) {
        var d = res.d || {};
        if (!(res.ok && (d.state === true || d.errno === 0))) showToast('临时目录未删，可手动清理：' + (t.offlineDirName || ''), 'info');
        return;
      }).catch(function () { /* 网络错误静默，不影响主流程 */ });
    }
    return main.then(function () {
      if (!rel.length) return null;
      return Promise.all(rel.map(function (cid) {
        return auto115ListDir(cid).then(function (list) {
          if (list && list.length) return null;
          return auto115Post('https://webapi.115.com/rb/delete', 'fid=' + encodeURIComponent(cid) + '&pid=' + encodeURIComponent(C115_DEFAULT_DIR_CID)).catch(function () { return null; });
        }).catch(function () { return null; });
      }));
    });
  }
  function auto115StepCleanup(t) {
    if (!auto115WriteEnter(t, 'cleanup')) return Promise.resolve(null);
    if (auto115IsTvTask(auto115TaskDoc(t))) {
      /* 剧集流程第 4 步（方案 B）：先把容器改成剧集标题；改完调 TvCleanupFiles（第 5 步） */
      var showTitle = auto115TvDirName((auto115TaskDoc(t) || {}).filmTitle);
      if (t.noFolder) {
        /* 单文件剧集：离线没有落地文件夹，在这里把剧集根目录建好（后续建季/移入都用它） */
        return auto115EnsureTvRoot((auto115TaskDoc(t) || {}).filmTitle).then(function (cid) {
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
      /* 文件夹命名：始终只取影片标题；统一走 pcSanitizeName（非法字符 → _，/ 不净化），与上传找夹同一规则 */
      var rawName2 = ((auto115TaskDoc(t) && (auto115TaskDoc(t).filmTitle || auto115TaskDoc(t).dvdId)) || t.offlineDirName || '').trim();
      newName = rawName2 ? pcSanitizeName(rawName2) : '';
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
  function auto115UploadDirName(doc) { var D = doc || auto115Doc; return pcSanitizeName((D && D.filmTitle) || '') || ''; }
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
    if (!auto115WriteEnter(t, 'dir')) return Promise.resolve(null);
    var name = auto115UploadDirName(auto115TaskDoc(t));
    if (!name) { auto115Set(t, 'dir', 'fail', '这部影片没有标题，不知道传到哪儿'); auto115Finish(t); return Promise.resolve(null); }
    auto115Set(t, 'dir', 'running', '正在 115 里找「' + name + '」…');
    pc115RenderAuto();
    return auto115ListDir(C115_DEFAULT_DIR_CID).then(function (list) {
      var folders = list.filter(function (it) { return it && it.cid && !it.fid; });
      for (var i = 0; i < folders.length; i++) {
        var fn = folders[i].n || '';
        /* 精确匹配 + 净化后匹配：旧版整理用原始标题改过夹名（带 / 等），净化后比对才能对上，
           找到后顺手把夹名改成规范名（失败不影响上传） */
        if (fn === name || pcSanitizeName(fn) === name) {
          t.uploadDirCid = String(folders[i].cid); t.uploadDirName = fn;
          auto115Set(t, 'dir', 'ok', '已找到「' + fn + '」');
          if (fn !== name) {
            auto115Post('https://webapi.115.com/files/edit', 'fid=' + encodeURIComponent(folders[i].cid) + '&file_name=' + encodeURIComponent(name))
              .then(function () { t.uploadDirName = name; }).catch(function () { });
          }
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
    if (!auto115WriteEnter(t, 'upload')) return Promise.resolve(null);
    if (!t.uploadDirCid) { auto115Set(t, 'upload', 'fail', '还没确定传到哪个文件夹'); auto115Finish(t); return Promise.resolve(null); }
    auto115Set(t, 'upload', 'running', '正在准备文件…');
    pc115RenderAuto();
    return loadFilm((auto115TaskDoc(t) || {}).filmId).then(function (film) {
      if (!film) throw new Error('没找到影片信息');
      var d = film.data || {};
      // 字幕标记兜底：老记录可能漏标 hasSubtitle → 用持久化磁力列表再判一次（NFO 标签 + 图片角标共用）
      if (!d.hasSubtitle && (d.javbusMagnets || []).some(isSubtitledMagnet)) d.hasSubtitle = true;
      var _upDoc = auto115TaskDoc(t) || {};
      var base = _upDoc.dvdId || pcSanitizeName(_upDoc.filmTitle || '') || 'movie';
      var files = [{ name: base + '.nfo', mime: 'application/octet-stream', bytes: new TextEncoder().encode(buildNFOMovieXml(d)) }];
      // 海报/剧照：带字幕时先烘焙「字幕」角标再上传（与下载元数据 zip 同款，不污染原图）
      var bakeJobs = [];
      if (typeof d.poster === 'string') {
        var upj = Promise.resolve(d.poster);
        if (d.hasSubtitle) upj = upj.then(drawSubtitleBadge);
        bakeJobs.push(upj.then(function (u) { var b = dataUrlToBytesSync(u); if (b) files.push({ name: base + '-poster.jpg', mime: 'image/jpeg', bytes: b }); }));
      }
      if (typeof d.fanart === 'string') {
        var ufj = Promise.resolve(d.fanart);
        if (d.hasSubtitle) ufj = ufj.then(drawSubtitleBadge);
        bakeJobs.push(ufj.then(function (u) { var b = dataUrlToBytesSync(u); if (b) files.push({ name: base + '-fanart.jpg', mime: 'image/jpeg', bytes: b }); }));
      }
      return Promise.all(bakeJobs).then(function () {
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
      var t = { id: 't' + auto115Now().toString(36) + Math.random().toString(36).slice(2, 6), type: 'upload', steps: auto115NewSteps('upload'), createdAt: auto115Now(), fv: AUTO115_FLOW_VERSION, filmId: auto115Doc && auto115Doc.filmId };
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
    function waitRunning(doc) { return ((doc && doc.tasks) || []).filter(function (x) { return auto115GetStep(x, 'wait').state === 'running'; }); }
    if (t) delay = auto115ProbeDelay(auto115GetStep(t, 'wait').probes);
    else {
      /* v327：执行绑定文档里在等待的任务也算（人可能正开在别的影片页） */
      var pend = waitRunning(auto115Doc);
      if (auto115ExecDoc && auto115ExecDoc !== auto115Doc) pend = pend.concat(waitRunning(auto115ExecDoc));
      for (var i = 0; i < pend.length; i++) delay = Math.min(delay, auto115ProbeDelay(auto115GetStep(pend[i], 'wait').probes));
    }
    auto115ProbeTimer = setTimeout(function () {
      auto115ProbeTimer = null;
      var pending = waitRunning(auto115Doc);
      if (auto115ExecDoc && auto115ExecDoc !== auto115Doc) pending = pending.concat(waitRunning(auto115ExecDoc));
      if (!pending.length) return;
      ensure115Cookie().then(function (ck) { if (ck) pending.forEach(function (x) { auto115StepWait(x, false); }); });
    }, delay);
  }
  /* v334：中断重启恢复——重置孤儿 running 步骤（iOS 同名函数说明一致；PC 无方案 A 磁力库，只扫影片文档）。
     仅在 auto115RunningId 为空时由 auto115Resume 调用，后台返回但确有任务在跑时不重置，避免打断进行中的流水线。 */
  function auto115ResetOrphanSteps() {
    var docs = [];
    if (auto115Doc) docs.push(auto115Doc);
    if (auto115ExecDoc && auto115ExecDoc !== auto115Doc) docs.push(auto115ExecDoc);
    var changed = false;
    for (var di = 0; di < docs.length; di++) {
      var dts = docs[di].tasks || [];
      for (var i = 0; i < dts.length; i++) {
        var t = dts[i];
        if (!t || t.aborted) continue;
        var st = auto115Status(t, docs[di]);
        if (st.cls === 'ab-ok' || st.cls === 'ab-fail') continue;
        var steps = t.steps || [];
        for (var j = 0; j < steps.length; j++) {
          if (steps[j].state === 'running') { steps[j].state = 'idle'; steps[j].msg = ''; steps[j].probes = 0; steps[j].at = 0; changed = true; }
        }
      }
    }
    if (changed) { for (var k = 0; k < docs.length; k++) auto115Save(docs[k]); }
    return changed;
  }
  function auto115Resume() {
    if (!auto115Doc) return;
    auto115SweepZombies();
    auto115ClearDirtyLock();
    /* v334：本会话无任何任务在跑 → 上轮遗留的 running 步骤都是孤儿（定时器随关闭丢失），先重置再续跑 */
    if (!auto115RunningId) auto115ResetOrphanSteps();
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
    if (!auto115IsOfflineLink(magnet)) { showToast('请粘贴有效的磁力或 ed2k 链接（magnet:? / ed2k:// 开头）', 'error'); return; }
    auto115EnsureDoc().then(function (doc) {
      var t = {
        id: 't' + auto115Now().toString(36) + Math.random().toString(36).slice(2, 6),
        type: 'offline',
        magnet: magnet, magnetTitle: auto115OfflineTitle(magnet),
        steps: auto115NewSteps(), createdAt: auto115Now(), fv: AUTO115_FLOW_VERSION,
        filmId: doc && doc.filmId   /* v327 归属快照：执行期防串档 */
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
      if (!ck) { showToast('请先到「设置 → 应用配置」登录 115', 'error'); return; }
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
      auto115Save(auto115DocOf(t) || auto115Doc); pc115RenderAuto();
      var isTvExec = auto115IsTvTask(auto115TaskDoc(t));   /* 执行绑定文档的剧集属性，不受「当前打开哪部片」影响 */
      if (key === 'dir') return auto115StepUploadDir(t);
      if (key === 'upload') return auto115StepUploadFiles(t);
      if (key === 'submit') return auto115StepSubmit(t);
      if (key === 'wait') return auto115BeginWait(t);
      if (key === 'mkdir') return auto115StepMkdir(t);
      if (key === 'move') return isTvExec ? auto115StepTvCleanupFiles(t) : auto115StepMove(t);
      if (key === 'rename') return isTvExec ? auto115StepTvRenameVideos(t) : auto115StepRename(t);
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
    /* 没有失败步骤：待提交/排队/已中止/卡在「进行中」→ 直接从头强启（v334：覆盖 ab-run/ab-wait 卡死场景） */
    var st = auto115Status(t);
    if (st.cls !== 'ab-ok' && st.cls !== 'ab-fail') return auto115ForceStart(tid);
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
  /* ---------- 文件整理（对齐移动端） ----------
     云下载里已经有这个片子、只是没归置好 → 跳过离线下载，按标题定位文件夹（或散装视频），
     从「修改文件夹名称」这一步开始跑既有的离线流水线（cleanup → move → rename）。 */
  function pc115TidyTitles(doc) {
    var out = [];
    var a = (doc && (doc.filmTitle || doc.dvdId)) || '';
    var b = (doc && doc.originalTitle) || '';
    var c = (doc && doc.dvdId) || '';
    if (a && out.indexOf(a) < 0) out.push(a);
    if (b && out.indexOf(b) < 0) out.push(b);
    if (c && out.indexOf(c) < 0) out.push(c);
    return out;
  }
  var pcTidyDirPending = [];
  function pc115ClearTidyPick() {
    var box = document.getElementById('pcTidyPick');
    if (box) { box.style.display = 'none'; box.innerHTML = ''; }
    pcTidyDirPending = [];
  }
  function pc115StartTidy(dir) {
    pc115ClearTidyPick();
    return auto115EnsureDoc().then(function (doc) {
      var t = {
        id: 't' + auto115Now().toString(36) + Math.random().toString(36).slice(2, 6),
        type: 'offline', tidy: true,
        steps: auto115NewSteps('offline'), createdAt: auto115Now(), fv: AUTO115_FLOW_VERSION,
        filmId: auto115Doc && auto115Doc.filmId   /* v327 归属快照：执行期防串档 */
      };
      /* 整理任务复用离线步骤表，但前两步（提交/等待）不走，标记为跳过 */
      auto115Set(t, 'submit', 'skip', '已有文件，跳过离线下载');
      auto115Set(t, 'wait', 'skip', '已有文件，跳过离线下载');
      if (dir && dir.fid) {
        /* 选中散装视频：没有文件夹，后续只改名（需要文件夹的片会在 cleanup 阶段建好再并入） */
        t.noFolder = true;
        t.videoFid = String(dir.fid);
        t.videoName = dir.n || '';
        t.videoSize = Number(dir.size) || 0;
        t.keepFids = [t.videoFid];
      } else {
        t.offlineDirCid = String((dir && dir.cid) || '');
        t.offlineDirName = (dir && dir.n) || '';
      }
      t.tidyScore = (dir && dir.score) || 0;
      doc.tasks.unshift(t);
      auto115Expanded[t.id] = true;
      return auto115Save().then(function () {
        pc115RenderAuto();
        showToast('已定位「' + (t.noFolder ? t.videoName : t.offlineDirName) + '」，开始整理', 'success');
        return auto115RetryStep(t.id, 'cleanup', true);
      });
    }).catch(function (e) { showToast((e && e.message) || '整理失败', 'error'); });
  }
  function pc115OpenTidy() {
    return ensure115Cookie().then(function (ck) {
      if (!ck) { showToast('请先到「设置 → 应用配置」登录 115', 'error'); return null; }
      return auto115EnsureDoc().then(function () {
        showToast('正在云下载里查找…', 'info');
        return auto115ListDir(C115_DEFAULT_DIR_CID, 'user_ptime');
      }).then(function (list) {
        /* 两种形态都要能整理：① 装在文件夹里 ② 散在云下载根目录、名字不规范的单视频 */
        var folders = (list || []).filter(function (it) { return it && it.cid && !it.fid; });
        var vids = (list || []).filter(function (it) { return it && it.fid && auto115IsVideoName(it.n || it.name || ''); });
        var titles = pc115TidyTitles(auto115Doc);
        if (!titles.length) { showToast('缺少影片标题，没法匹配', 'error'); return null; }
        var m = Auto115Core.matchTidyDir(folders, titles, auto115Doc && auto115Doc.year);
        var mv = Auto115Core.matchTidyDir(vids, titles, auto115Doc && auto115Doc.year);
        /* 文件夹与散装视频同场竞技，分高者赢 */
        var bestF = (m.ok && m.best) ? m.best : null;
        var bestV = (mv.ok && mv.best) ? mv.best : null;
        if (bestF && (!bestV || bestF.score >= bestV.score)) return pc115StartTidy(bestF);
        if (bestV) return pc115StartTidy(bestV);
        var cands = m.candidates.concat(mv.candidates);
        if (!cands.length) { showToast('云下载里没找到和「' + titles[0] + '」相似的文件夹或视频', 'error'); return null; }
        pc115ShowTidyPick(cands);
        return null;
      });
    }).catch(function (e) { showToast((e && e.message) || '查找失败', 'error'); });
  }
  /* 分数不够自动采用、但确有相近候选时，列出来让用户自己挑一个 */
  function pc115ShowTidyPick(cands) {
    pcTidyDirPending = cands.slice(0, 8);
    var box = document.getElementById('pcTidyPick');
    if (!box) { showToast('云下载里有 ' + cands.length + ' 个相近的文件夹，去 115 手动确认一下吧', 'info'); return; }
    box.innerHTML = pcTidyDirPending.map(function (c, i) {
      return '<button type="button" class="auto-tidy-cand" onclick="PC115.pickTidy(' + i + ')">'
        + '<span class="atc-n">' + escapeHtml(c.n || '') + '</span>'
        + '<span class="atc-s">' + (c.score || 0) + ' 分</span></button>';
    }).join('');
    box.style.display = '';
  }
  function pc115PickTidy(i) {
    var dir = pcTidyDirPending[i];
    pc115ClearTidyPick();
    if (!dir) return;
    return pc115StartTidy(dir);
  }
  /* 面板底部图标：磁力 / 字幕仅高级档可见（HTML 里默认 display:none，命中高级才显形） */
  function pc115SyncAutoIcons() {
    var full = false;
    try { full = (typeof state !== 'undefined' && state && (state.tier || '') === 'full'); } catch (e) { full = false; }
    var m = document.getElementById('pcAutoIconMagnet');
    var s = document.getElementById('pcAutoIconSub');
    if (m) m.style.display = full ? '' : 'none';
    if (s) s.style.display = full ? '' : 'none';
  }
  function pc115OpenAutoPanel() {
    return auto115EnsureDoc().then(function () {
      pc115ClearTidyPick();   // 换片/重开面板时，上一轮的整理候选不再保留
      pc115SyncAutoIcons();   // 磁力/字幕按钮按档位显隐
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
    pc115ClearTidyPick();   // 关面板时收掉「待挑选的整理候选」
  }
  document.addEventListener('click', function (e) {
    if (!pcAutoOpen) return;
    var pop = document.getElementById('autoPopover');
    var btn = document.getElementById('autoBtn');
    if (pop && btn && !pop.contains(e.target) && !btn.contains(e.target)) pc115CloseAutoPanel();
  });

  /* ---------- ui.js 钩子 ---------- */
  /* 详情页顶栏「自动化」按钮：没登录 115 就整体不显示（进去也什么都做不了） */
  function pc115SyncAutoEntry() {
    var btn = document.getElementById('autoBtn');
    if (!btn) return Promise.resolve(false);
    return ensure115Cookie().then(function (ck) {
      btn.style.display = ck ? '' : 'none';
      if (!ck && pcAutoOpen) pc115CloseAutoPanel();   // 登录掉了：面板一并收掉，别留个孤儿浮层
      return !!ck;
    }).catch(function () { btn.style.display = 'none'; return false; });
  }
  function pc115OnDetailOpen() {
    auto115Doc = null;
    /* v327：有任务真在跑就不放锁、不停探测——以前切影片就放锁+停探测，
       容易出现两条流水线并发、或等待中的任务没人继续探测；脏锁由 ClearDirtyLock 自愈 */
    var _cur = auto115Task(auto115RunningId);
    if (!_cur || !auto115IsActive(_cur)) auto115ReleaseLock();
    if (!(auto115ExecDoc && (auto115ExecDoc.tasks || []).some(auto115IsActive))) pc115StopProbe();
    pc115SyncAutoEntry();
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
    syncAutoEntry: pc115SyncAutoEntry,
    openConfig: pc115OpenSheet,
    fillConfig: pc115FillConfig,
    startLogin: pc115StartLogin,
    toggleQr: pc115ToggleQr,
    verify: pc115Verify,
    tokenInput: pc115TokenInput,
    copyCookie: pc115CopyCookie,
    authorize: pc115OpenAuthUI,
    refreshOpenStatus: pc115RefreshOpenStatus,
    pasteMagnet: pc115PasteMagnet,
    submitAddMagnet: pc115SubmitAddMagnet,
    openTidy: pc115OpenTidy,
    pickTidy: pc115PickTidy,
    addUploadTask: auto115AddUploadTask,
    clearDone: auto115ClearDone,
    offline: c115Offline,
    refreshBadge: pc115UpdateBadge,
    /* 限流闸测试钩子（仅供隔离测试用；下划线前缀=非业务 API） */
    _gate: {
      call: c115Call,
      isWrite: c115IsWrite,
      riskHit: c115RiskHit,
      riskActive: c115RiskActive,
      setThrottle: function (v){ C115_THROTTLE_ON = !!v; },
      snap: function (){ return { lastAt: c115LastAt, cooldownUntil: c115CooldownUntil, queued: c115Queue.length, busy: c115Busy, riskHits: c115RiskHits }; }
    }
  };

})(window);
