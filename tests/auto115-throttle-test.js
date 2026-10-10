/* PC 端 115 限流闸隔离测试（v361）—— 只测闸门本身，不打真实网络 */
const fs = require('fs');
const vm = require('vm');
const SRC = '/Users/leavehalf/Downloads/work/NFO/nfo-editor/src/';
const assert = (cond, msg) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + msg); if (!cond) process.exitCode = 1; };

/* ---- 最小全局桩 ---- */
const ctx = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Promise, Error, Object, String, Number, Boolean, RegExp, Array,
  encodeURIComponent, decodeURIComponent,
  TextEncoder, TextDecoder,
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  fetch: () => Promise.reject(new Error('no net'))
};
const mkEl = () => ({
  style: {}, dataset: {}, textContent: '', innerHTML: '', value: '',
  classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
  addEventListener(){}, removeEventListener(){}, appendChild(){}, removeChild(){},
  querySelector(){ return null; }, querySelectorAll(){ return []; },
  setAttribute(){}, getAttribute(){ return null; }, closest(){ return null; }
});
ctx.document = {
  getElementById: () => mkEl(), querySelectorAll: () => [], querySelector: () => null,
  addEventListener(){}, createElement: mkEl, body: mkEl(), documentElement: mkEl()
};
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
ctx.addEventListener = () => {}; ctx.removeEventListener = () => {};
ctx.navigator = { userAgent: 'test' };
ctx.localStorage = { getItem: () => null, setItem(){}, removeItem(){} };
ctx.showToast = () => {};
ctx.state = { magnetWorker: 'http://stub.worker', c115Cookie: 'ck=1' };
ctx.NfoCore = new Proxy({}, { get: () => () => ({}) });
const noop = () => ({});
ctx.currentDetailFilm = null; ctx.idbGet = noop; ctx.idbPut = noop;
ctx.openSheet = noop; ctx.closeAllSheets = noop; ctx.DEFAULT_WORKER = '';
ctx.escapeHtml = (s) => String(s || ''); ctx.escapeAttr = ctx.escapeHtml;
ctx.buildNFOMovieXml = noop; ctx.dataUrlToBytesSync = noop;
ctx.loadFilm = noop; ctx.copyText = noop;
vm.createContext(ctx);

try { vm.runInContext(fs.readFileSync(SRC + 'auto115-core.js', 'utf8'), ctx, { filename: 'auto115-core.js' }); } catch (e) { console.log('[DBG] core 加载异常:', e.message); }
try { vm.runInContext(fs.readFileSync(SRC + 'auto115.js', 'utf8'), ctx, { filename: 'auto115.js' }); }
catch (e) { console.log('LOAD WARN:', e.message); }

const gate = ctx.PC115 && ctx.PC115._gate;
assert(!!gate, 'PC115._gate 测试钩子已暴露');
if (!gate) { console.log('\n❌ 闸门钩子缺失，无法继续'); process.exit(1); }

/* ---- ① 写/读分类 ---- */
assert(gate.isWrite('https://webapi.115.com/files/batch_rename') === true, 'isWrite：batch_rename → 写');
assert(gate.isWrite('https://webapi.115.com/rb/delete') === true, 'isWrite：rb/delete → 写');
assert(gate.isWrite('https://webapi.115.com/files/move') === true, 'isWrite：files/move → 写');
assert(gate.isWrite('https://webapi.115.com/files?cid=0&limit=200') === false, 'isWrite：列目录 → 读');
assert(gate.isWrite('https://115.com/web/lixian/?ct=lixian&ac=task_lists') === false, 'isWrite：离线列表 → 读');

/* ---- ② 节流关闭：两次调用零等待 ---- */
gate.setThrottle(false);
const t0 = Date.now();
gate.call('write', () => Promise.resolve()).then(() => gate.call('write', () => Promise.resolve())).then(() => {
  const gapOff = Date.now() - t0;
  assert(gapOff < 200, '节流关闭：两次写调用无等待（' + gapOff + 'ms < 200ms）');

  /* ---- ③ 节流开启：写间隔 ≥1.2s、带随机抖动 ---- */
  gate.setThrottle(true);
  const t1 = Date.now();
  return gate.call('write', () => Promise.resolve('a')).then(() => gate.call('write', () => Promise.resolve('b'))).then((v) => {
    const gapOn = Date.now() - t1;
    assert(v === 'b', '闸门透传返回值');
    assert(gapOn >= 1150, '节流开启：两次写调用间隔 ≥1.2s（实测 ' + gapOn + 'ms）');
    assert(gapOn < 4000, '节流开启：间隔未失控（' + gapOn + 'ms < 4s）');

    /* ---- ④ 读间隔比写短 ---- */
    const t2 = Date.now();
    return gate.call('read', () => Promise.resolve()).then(() => gate.call('read', () => Promise.resolve())).then(() => {
      const gapRead = Date.now() - t2;
      assert(gapRead >= 300 && gapRead < 1200, '读间隔 ≥0.35s 且远小于写间隔（实测 ' + gapRead + 'ms）');

      /* ---- ⑤ 熔断：命中风控 → 冷却期内 riskActive 为真，冷却截止 ≈60s 后 ---- */
      const before = gate.snap().riskHits;
      const fresh = gate.riskHit('操作过于频繁，请稍后再试');
      assert(fresh === true, '首次风控命中返回 fresh');
      assert(gate.riskActive() === true, '命中后 riskActive 为真');
      const remain = gate.snap().cooldownUntil - Date.now();
      assert(remain > 55000 && remain <= 60000, '冷却时长 ≈60s（剩余 ' + Math.round(remain / 1000) + 's）');
      gate.riskHit('又频繁了');   // 30s 内第二次：不重复计数
      assert(gate.snap().riskHits === before + 1, '30s 内重复命中不重复计数');

      /* ---- ⑥ 冷却期内发起请求：必须排队等待（不放行）----
         不真等 60s：再 hit 一次后立即改写冷却截止为 +1.2s（走 snap 只读拿不到写入口，
         改用「读操作在冷却中至少排到冷却结束」的语义验证——直接观察排队数），这里验证排队能挂起 */
      let released = false;
      const p = gate.call('read', () => { released = true; return Promise.resolve(); });
      const s = gate.snap();
      assert(s.queued >= 1 || !released, '冷却期内请求进入排队（未放行）');
      /* 把冷却期清掉没有公开入口、真等 60s 不可取 → 校验「冷却没过时绝不提前放行」：
         排队挂起，150ms 后仍未执行即通过；该 promise 悬挂不 await（进程收尾时直接退出） */
      return new Promise((res) => setTimeout(res, 150)).then(() => {
        assert(released === false, '冷却未结束时请求不放行（150ms 后仍挂起）');
      });
    });
  });
}).then(() => {
  console.log(process.exitCode ? '\n❌ 有用例失败' : '\n✅ auto115-throttle 全部通过');
  process.exit(process.exitCode || 0);
}, (e) => {
  console.log('FAIL  测试链异常：' + (e && e.message));
  process.exit(1);
});
