/* 最小复现：4.0 上传全链路（mock 服务端），打印完整堆栈 */
const fs = require('fs'); const vm = require('vm');
const src = fs.readFileSync('/Users/leavehalf/Downloads/work/NFO/nfo-editor/src/ui-ios.js', 'utf8');
const mkEl = () => ({ style:{}, dataset:{}, textContent:'', innerHTML:'', value:'', classList:{ add(){},remove(){},toggle(){},contains(){return false;} }, addEventListener(){}, removeEventListener(){}, appendChild(){}, removeChild(){}, querySelector(){return null;}, querySelectorAll(){return [];}, setAttribute(){}, getAttribute(){return null;}, closest(){return null;} });
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame:(f)=>setTimeout(f,0), cancelAnimationFrame(){} };
const elCache = {};
ctx.document = { getElementById:(id)=>(elCache[id]||(elCache[id]=mkEl())), querySelectorAll:()=>[], querySelector:()=>null, addEventListener(){}, createElement:mkEl, body:mkEl(), documentElement:mkEl() };
Object.assign(ctx, { addEventListener(){}, removeEventListener(){}, navigator:{userAgent:'test'}, localStorage:{getItem:()=>null,setItem(){},removeItem(){}}, fetch:()=>Promise.reject(new Error('no net')), crypto:require('crypto').webcrypto, TextEncoder, TextDecoder, btoa:(s)=>Buffer.from(s,'binary').toString('base64'), atob:(s)=>Buffer.from(s,'base64').toString('binary'), BigInt, Uint8Array, Uint32Array, DataView, ArrayBuffer, URLSearchParams, Promise, Date, Math, JSON, Error, Array, Object, String, Number, Boolean, RegExp, encodeURIComponent, decodeURIComponent });
ctx.NfoCore = new Proxy({}, { get: () => function(){ return {}; } });
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
try { vm.runInContext(src, ctx, { filename:'ui-ios.js' }); } catch(e){ console.log('LOAD WARN:', e.message); }
try { vm.runInContext('state.countries = state.countries || []; state.genres = state.genres || [];', ctx); } catch(e){}
const store = {};
ctx.idbGet = (s,k)=>Promise.resolve(store[k]);
ctx.idbPut = (s,k,v)=>{ store[k]=JSON.parse(JSON.stringify(v)); return Promise.resolve(); };
ctx.showToast = ()=>{}; ctx.escapeHtml=(s)=>String(s==null?'':s); ctx.switchPage=()=>{};
ctx.state = { c115Cookie:'UID=1;CID=2;SEID=3', countries:[], genres:[] };
const script = {
  '/app/uploadinfo': { user_id: 1, userkey: 'USERKEY123' },
  '4.0/initupload': async (n, url, opts) => {
    const e = await ctx.c115EcdhGet(); const v = e.variants[e.active];
    const plain = new TextDecoder().decode(await ctx.c115AesCbc(v.key, v.iv, ctx.c115B64ToBytes(opts.body), false));
    console.log('[MOCK] 解出表单:', plain.slice(0, 120));
    const resp = { status: 1, statuscode: 0, bucket: 'BKT115', object: 'OBJ/123', callback: { callback: 'cfg', callback_var: 'vars' } };
    const json = new TextEncoder().encode(JSON.stringify(resp));
    const out = []; out.push(json.length << 4); for (const b of json) out.push(b);
    const body = new Uint8Array(2 + out.length); body[0]=out.length & 0xFF; body[1]=(out.length>>8)&0xFF; body.set(out, 2);
    return { __bin: ctx.c115BytesToB64(await ctx.c115AesCbc(v.key, v.iv, body, true)) };
  },
  'getuploadinfo': { endpoint: 'https://oss-cn-test.aliyuncs.com', gettokenurl: 'https://uplb.115.com/3.0/gettoken.php' },
  'gettoken': { StatusCode: '200', AccessKeyId: 'AKID', AccessKeySecret: 'AKSEC', SecurityToken: 'STSTOK' },
  'oss-cn-test': () => ({ state: true, code: 0 })
};
ctx.c115ProxyFetch = async function(url, opts){
  const hit = Object.keys(script).find(k => url.indexOf(k) >= 0);
  const r = hit ? script[hit] : { state: true };
  const d = await (typeof r === 'function' ? r(1, url, opts||{}) : r);
  if (d && d.__bin != null) return { ok:true, status:200, d:{}, raw:'', bin:d.__bin };
  return { ok:true, status:200, d, raw: JSON.stringify(d) };
};
(async () => {
  try {
    const bytes = new TextEncoder().encode('hello nfo');
    const r = await ctx.c115UploadFileAsync('DIR888', 'IPX-486.nfo', bytes, 'application/xml');
    console.log('OK:', JSON.stringify(r));
  } catch(e){ console.log('ERR:', e.message); console.log(e.stack); }
  process.exit(0);
})();
