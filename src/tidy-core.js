/* ===================================================================
 * 文件整理 · 纯逻辑层（水印清洗 + 规则注册表）
 * -------------------------------------------------------------------
 * 配套文档：115/115文件整理规则.md（v0.3）
 * 铁律：本文件不读 state、不碰 DOM、不发请求，所有输入由参数传入。
 *       浏览器挂 window.TidyCore；Node 环境挂 module.exports.TidyCore。
 * 本层只产「op 列表」（改了哪个名字 → 改成什么），执行/预览由 UI 层负责。
 * =================================================================== */
(function (global) {
  'use strict';

  /* ================= 一、水印清洗 ================= */

  /* 内置水印（一律全局匹配，不再分前缀/后缀 —— 水印、广告、站点文本不管出现在哪都要删）
     条目模型：{ id, label, src(正则源码) }。第 4 条要求括注形如「域名」：点号后必须是
     2-8 位纯字母后缀，因此全局匹配也不会误删 `【4k】`『【中文字幕】』『【1080p.x264】』这类标注。 */
  /* on: 是否启用（默认 true）。关掉的条目保留在列表里但不参与清洗。 */
  var WATERMARK_DEFAULT = [
    { id: 'w98t',  label: '98T 站点指纹',    on: true, src: 'u?www\\.98t\\.la@' },
    { id: 'wfuli', label: 'fulidao 站点指纹', on: true, src: 'fulidao\\.xyz@' },
    { id: 'w7d68', label: '7d68 站点括注',    on: true, src: '【7d68\\.xyz】' },
    { id: 'wdom',  label: '域名式括注',       on: true, src: '【[a-z0-9.-]+\\.[a-z]{2,8}】\\s*' },
    { id: 'wtail', label: '含 www 的站名括注', on: true, src: '\\s*【[^】]*www[^】]*】' },
    { id: 'wmeta', label: '通用 www 站名@',   on: true, src: '[A-Za-z0-9.-]*www\\.[A-Za-z0-9.-]+@' }
  ];

  /* 深拷贝内置水印（避免调用方直接改到常量表） */
  function defaultWatermarks() {
    return WATERMARK_DEFAULT.map(function (w) {
      return { id: w.id, label: w.label, on: w.on !== false, src: w.src };
    });
  }

  /* 单个条目 → 正则（一律全局匹配：水印/广告不管出现在开头、中间还是结尾都要删）
     非法正则返回 null，不抛错，避免用户手滑写坏让整页炸掉 */
  function watermarkRegExp(w) {
    if (!w || typeof w.src !== 'string' || !w.src) return null;
    try { return new RegExp(w.src, 'gi'); }
    catch (e) { return null; }
  }

  /* 清洗后的收尾：收敛空格、去掉残留的首尾分隔符，但**保住扩展名**。
     例：`www.98T.la@ 66.zip` → `66.zip`；`- 标题 .mp4` → `标题.mp4` */
  function finalizeName(s) {
    return String(s == null ? '' : s)
      .replace(/\s{2,}/g, ' ')            // 连续空格收敛
      .trim()
      .replace(/^[\s\-_.、]+/, '')        // 去掉开头残留的分隔符
      .replace(/[\s\-_]+(?=\.[A-Za-z0-9]+$)/, '') // 扩展名前的残留分隔符
      .trim();
  }

  /* 路径短显：层级多时把中间折叠掉，永远保住「首级 + 末几级」，避免长路径把一行撑爆。
     例（maxSeg=2）：'影视/云下载/2024/合集/名字很长很长' → '影视 / … / 名字很长很长'
     例（maxSeg=3）：同上一串 → '影视 / … / 合集 / 名字很长很长'
     段数不足就直接原样 join；空路径返回空串。 */
  function pathBrief(path, maxSeg) {
    var segs = String(path == null ? '' : path).split('/')
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return !!s; });
    if (!segs.length) return '';
    var n = parseInt(maxSeg, 10);
    if (!n || n < 2) n = 2;
    if (segs.length <= n) return segs.join(' / ');
    return segs[0] + ' / … / ' + segs.slice(-(n - 1)).join(' / ');
  }

  /* 对单个文件名套用整张水印表 → 清洗后的名字（可能为空串，交给上层判空） */
  function applyWatermarks(name, list) {
    var out = String(name == null ? '' : name);
    (list || []).forEach(function (w) {
      if (w && w.on === false) return;          // 关掉的条目跳过（默认 on 视为开启）
      var re = watermarkRegExp(w);
      if (re) out = out.replace(re, '');
    });
    return finalizeName(out);
  }

  /* 预览：对一整批条目逐个算「清洗后」，结果**逐条保留**（含未变化的，供 UI 灰显） */
  function previewWatermark(items, list) {
    return (items || []).map(function (it) {
      var orig = (it && (it.name || it.n)) || '';
      var clean = applyWatermarks(orig, list);
      return { fid: (it && it.fid) || '', cid: (it && it.cid) || '', orig: orig, clean: clean, changed: !!clean && clean !== orig };
    });
  }

  /* 计划：只保留「会变化」的条目 → op 列表（供执行器消费） */
  function planWatermark(items, list) {
    return previewWatermark(items, list).filter(function (p) { return p.changed; })
      .map(function (p) {
        return { op: 'rename', fid: p.fid, orig: p.orig, name: p.clean, why: '水印清洗' };
      });
  }

  /* ================= 一点五、命名规则实现（A 组 9 条 + 导入组） =================
     全部是「目录快照 → op 列表」的纯函数：输入条目数组，输出 rename op 数组。
     共同约定：
       · 条目 name 取 it.name || it.n；目录判定 it.cid && !it.fid；id 取 it.fid || it.cid
       · 只返回「真的会变」的条目；同样输入永远同样输出（幂等）
       · 名字写不动的场景一律返回 null（宁可不动，不可误伤） */

  function nameOf(it){ return String((it && (it.name || it.n)) || ''); }
  function isDirItem(it){ return !!(it && it.cid && !it.fid); }
  function idOf(it){ return String((it && (it.fid || it.cid)) || ''); }

  /* 主名 + 扩展名（扩展名只认最后一个点后的 1–6 位字母数字） */
  function splitExt(name){
    var s = String(name == null ? '' : name);
    var m = s.match(/^(.*)\.([A-Za-z0-9]{1,6})$/);
    if (!m) return { base: s, ext: '' };
    return { base: m[1], ext: m[2] };
  }
  function joinExt(base, ext){ return ext ? (base + '.' + ext) : base; }

  function mkRename(it, orig, name, why){
    return { op: 'rename', fid: idOf(it), orig: orig, name: name, oldDir: '', newDir: '', why: why };
  }

  /* 通用推进：逐条算新名，变了才产 op */
  function planByMap(items, fn, why){
    var ops = [];
    (items || []).forEach(function (it){
      var orig = nameOf(it);
      if (!orig) return;
      var next = fn(orig, it);
      if (next && next !== orig) ops.push(mkRename(it, orig, next, why));
    });
    return ops;
  }

  /* A2 扩展名小写：`.MP4` → `.mp4` */
  function planExtLower(items){
    return planByMap(items, function (n){
      var p = splitExt(n);
      if (!p.ext) return null;
      var low = p.ext.toLowerCase();
      return (low === p.ext) ? null : joinExt(p.base, low);
    }, '扩展名小写');
  }

  /* A3 番号大写化：只认「名字开头」的 字母 + 可选分隔 + 数字（opud-008 → OPUD-008） */
  var DVD_HEAD = /^(\s*)([A-Za-z]{2,6})([-_]?)(\d{2,5})(?![0-9])/;
  function planDvdUpper(items){
    return planByMap(items, function (n){
      var p = splitExt(n);
      var m = p.base.match(DVD_HEAD);
      if (!m) return null;
      var head = m[2] + m[3] + m[4];
      if (head === head.toUpperCase()) return null;       // 已经大写，不动
      var nb = p.base.replace(DVD_HEAD, function (all, sp, a, sep, num){
        return sp + a.toUpperCase() + sep + num;
      });
      return joinExt(nb, p.ext);
    }, '番号大写化');
  }

  /* A4 番号归一：剥离 `24H` 前缀、`_` → `-`、去掉分碟/无码后缀（SDDE_045 → SDDE-045） */
  function planDvdNormalize(items){
    return planByMap(items, function (n){
      var p = splitExt(n);
      var b = p.base, nb = b;
      nb = nb.replace(/^(\s*)24H(?=[A-Za-z])/i, '$1');                                        // 24H 前缀
      nb = nb.replace(/^(\s*[A-Za-z]{2,6})_(\d{2,5})(?![\d_])/, '$1-$2');                     // 下划线 → 连字符
      nb = nb.replace(/^(\s*[A-Za-z]{2,6}[-_]\d{2,5})[-_]?(?:P\d|UC|UP|U)(?![0-9A-Za-z])/i, '$1'); // 分碟/无码后缀
      nb = nb.replace(/\s{2,}/g, ' ').trim();
      return (nb === b) ? null : joinExt(nb, p.ext);
    }, '番号归一');
  }

  /* A5 非法字符清理：115 + Kodi 双保留字 @ \ / : * ? " < > | */
  var ILLEGAL_RE = /[\\/:*?"<>|@]/g;
  function planIllegalChar(items){
    return planByMap(items, function (n){
      var p = splitExt(n);
      var nb = p.base.replace(ILLEGAL_RE, '').replace(/\s{2,}/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '');
      if (!nb || nb === p.base) return null;
      return joinExt(nb, p.ext);
    }, '非法字符清理');
  }

  /* A6 超长截断：目录 ≤60 字、文件 ≤100 字（默认值，可在设置里改） */
  function planLengthCap(items, opts){
    opts = opts || {};
    var dirMax = opts.dirMax || 60, fileMax = opts.fileMax || 100;
    return planByMap(items, function (n, it){
      var max = isDirItem(it) ? dirMax : fileMax;
      if (n.length <= max) return null;
      var p = splitExt(n);
      var keep = max - (p.ext ? p.ext.length + 1 : 0);
      if (keep < 8) keep = 8;
      var base = p.base.slice(0, keep).replace(/[\s._-]+$/, '');
      if (!base) return null;
      return joinExt(base, p.ext);
    }, '超长截断');
  }

  /* A7 发布标签剥离：删掉「含发布/规格词」的括注，保留内容类标签（【中文字幕】不动） */
  var REL_WORDS = /(1080p|720p|2160p|480p|4k|8k|fhd|uhd|bdrip|bluray|blu-ray|web-?dl|webrip|hdtv|dvdrip|h\.?26[45]|x26[45]|hevc|avc|aac|ac3|dts|flac|10bit|8bit|hdr|remux|repack|proper|字幕组|字幕社|汉化组|压制|熟肉|生肉)/i;
  var TAG_RE = /[[【]([^\]】]{1,40})[\]】]/g;
  function planPrefixClean(items){
    return planByMap(items, function (n){
      var p = splitExt(n);
      var nb = p.base.replace(TAG_RE, function (all, inner){
        return REL_WORDS.test(inner) ? '' : all;
      });
      nb = nb.replace(/\s{2,}/g, ' ').replace(/^[\s._-]+|[\s._-]+$/g, '');
      if (!nb || nb === p.base) return null;
      return joinExt(nb, p.ext);
    }, '发布标签剥离');
  }

  /* A8 季夹归一（只作用在文件夹）：Season 1 / S1 / 第1季 → S01 */
  var SEASON_RE = /^(?:season|s|第)\s*0*(\d{1,2})\s*季?$/i;
  function planSeasonFolder(items){
    var ops = [];
    (items || []).forEach(function (it){
      if (!isDirItem(it)) return;
      var n = nameOf(it);
      var m = n.match(SEASON_RE);
      if (!m) return;
      var num = parseInt(m[1], 10);
      if (!(num >= 1 && num <= 99)) return;
      var next = 'S' + (num < 10 ? '0' + num : '' + num);
      if (next === n) return;                              // 已是 S01 则不动（幂等）
      ops.push(mkRename(it, n, next, '季夹归一'));
    });
    return ops;
  }

  /* A9 图片序号化（只作用在图片）：去掉 `001 (1).jpg` 里的重复标记、去掉「微信图片_」前缀 */
  var IMG_DUP_RE = /\s*[（(]\s*\d{1,3}\s*[)）]\s*$/;
  var IMG_EXT_RE = /^(jpe?g|png|gif|bmp|webp|heic|tiff?)$/i;
  function planImageSeq(items){
    return planByMap(items, function (n, it){
      if (isDirItem(it)) return null;
      var p = splitExt(n);
      if (!IMG_EXT_RE.test(p.ext)) return null;
      var nb = p.base.replace(IMG_DUP_RE, '').replace(/\s{2,}/g, ' ').trim();
      if (!nb || nb === p.base) return null;
      return joinExt(nb, p.ext);
    }, '图片序号化');
  }

  /* —— 导入组：JSON 整理 ——
     条目四字段（新规范）：{ 旧文件路径, 旧名, 新文件路径, 新名 }
       旧文件路径 / 新文件路径 = 文件所在的【父目录】（相对目标文件夹）；
                               也接受填完整路径（含文件名），会自动剥掉末尾文件名当目录。
       旧名 / 新名           = 文件原名 / 改后名（必填；若路径里已含文件名，可只填路径）。
     兼容旧三字段：{ dir, from, to }（等同 旧文件路径=dir、旧名=from、新文件路径=dir、新名=to）。
     新字段别名：旧路径 oldPath|sourcePath|fromPath|srcPath|path；旧名 oldName|fromName|name|from|old；
                 新路径 newPath|targetPath|toPath|destPath；新名 newName|toName|to|new。
     只做「校验 + 归一化」，定位到真实文件由执行器负责（要查 115）。 */
  function pickField(e, keys){
    for (var i = 0; i < keys.length; i++){
      var v = e[keys[i]];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return '';
  }
  /* 把「可能是完整路径、也可能只是目录」的串规整成 { dir, name }。
     若已显式给了 name 且路径末尾正好是它 → 剥掉当目录；否则路径整体当目录，name 取末尾段。 */
  function splitPath(path, name){
    path = String(path || '').replace(/^\/+|\/+$/g, '');
    var idx = path.lastIndexOf('/');
    var base = idx >= 0 ? path.slice(idx + 1) : path;
    if (name != null && String(name) && base === String(name)){
      return { dir: idx >= 0 ? path.slice(0, idx) : '', name: String(name) };
    }
    if (name == null || !String(name).trim()){
      return { dir: idx >= 0 ? path.slice(0, idx) : '', name: base };
    }
    return { dir: path, name: String(name) };
  }
  function normalizeDir(dir, root){
    var d = String(dir || '').replace(/^\/+|\/+$/g, '');
    if (root){
      if (d === root) d = '';
      else if (d.indexOf(root + '/') === 0) d = d.slice(root.length + 1);
    }
    return d;
  }
  /* 从 AI 回复里剥掉 ```json … ``` 代码块 —— 聊天气泡只留人话，清单另以卡片呈现。
     未闭合的围栏尾巴也一并清掉，免得半截 JSON 露在聊天里。 */
  function stripJsonBlock(text){
    var s = String(text == null ? '' : text);
    s = s.replace(/```[a-zA-Z]*\s*[\s\S]*?```/g, '\n');
    s = s.replace(/```[\s\S]*$/, '\n');
    return s.replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
  }

  /* 清单 → 可导出 / 留档的 JSON 文本（固定四字段顺序，便于外部 AI 复用） */
  function planToJson(plan){
    var items = ((plan && plan.items) || []).map(function (en){
      return {
        '旧文件路径': String(en.oldDir || ''),
        '旧名': String(en.oldName || ''),
        '新文件路径': String(en.newDir == null ? (en.oldDir || '') : en.newDir),
        '新名': String(en.newName || '')
      };
    });
    var out = { root: String((plan && plan.root) || '') };
    var total = (plan && plan.total) ? Number(plan.total) : 0;
    if (total && total > items.length) out.total = total;
    out.items = items;
    return JSON.stringify(out, null, 2);
  }

  function parseTidyJson(text){
    var raw;
    try { raw = (typeof text === 'string') ? JSON.parse(text) : text; }
    catch (e) { return { ok: false, reason: 'JSON 格式有误，无法解析', root: '', items: [] }; }
    var root = '', arr = null;
    if (Array.isArray(raw)) arr = raw;
    else if (raw && typeof raw === 'object'){
      root = pickField(raw, ['root', 'base']);
      arr = raw.items || raw.list || raw.ops || null;
    }
    if (!Array.isArray(arr) || !arr.length){
      return { ok: false, reason: '没读到条目：需要 { items:[…] } 或直接给一个数组', root: root, items: [] };
    }
    var out = [], skipped = 0;
    for (var i = 0; i < arr.length; i++){
      var e = arr[i] || {};
      var oldPath = pickField(e, ['旧文件路径', 'oldPath', 'sourcePath', 'fromPath', 'srcPath', 'path']);
      var oldName = pickField(e, ['旧名', 'oldName', 'fromName', 'name', 'from', 'old']);
      var newPath = pickField(e, ['新文件路径', 'newPath', 'targetPath', 'toPath', 'destPath']);
      var newName = pickField(e, ['新名', 'newName', 'toName', 'to', 'new']);
      var dir = pickField(e, ['dir', 'folder']);                // 兼容旧三字段
      if (!oldPath && !newPath && dir){ oldPath = dir; newPath = dir; }
      var od = splitPath(oldPath, oldName), nd = splitPath(newPath, newName);
      if (!oldName && od.name) oldName = od.name;
      if (!newName && nd.name) newName = nd.name;
      oldName = String(oldName || '').trim(); newName = String(newName || '').trim();
      if (!oldName || !newName){ skipped++; continue; }
      out.push({ oldDir: od.dir, oldName: oldName, newDir: nd.dir, newName: newName });
    }
    if (!out.length) return { ok: false, reason: '条目的「原名称 / 改后名称」不完整', root: root, items: [] };
    return { ok: true, reason: '', root: root, items: out, skipped: skipped };
  }

  /* JSON 条目 + 实际目录快照 → rename / move op（名字在目录里找不到就记为 skipped）
     op 形态：
       { op:'rename', fid, orig, name }            同目录改名
       { op:'move',   fid, orig, name, toDir, toCid }  跨目录移动（可同时改名：name!==orig） */
  function planJsonItems(entries, opts){
    opts = opts || {};
    var byDir = opts.byDir || {};          // { dirKey: [条目,…] }
    var dirCid = opts.dirCid || {};        // { dirKey: cid|null }（移动目标必须存在）
    var root = String(opts.root || '').replace(/\/+$/, '');
    var ops = [], miss = [];
    (entries || []).forEach(function (en){
      var oldDir = normalizeDir(en.oldDir, root);
      var newDir = normalizeDir(en.newDir, root);
      var oname = String(en.oldName || ''), nname = String(en.newName || '');
      if (!oname || !nname){ miss.push((oldDir ? oldDir + '/' : '') + oname); return; }
      if (oldDir === newDir && oname === nname) return;          // 无变化，跳过（幂等）
      var pool = byDir[oldDir] || byDir['*'] || [];
      var hit = null;
      for (var i = 0; i < pool.length; i++){
        if (nameOf(pool[i]) === oname){ hit = pool[i]; break; }
      }
      if (!hit){ miss.push((oldDir ? oldDir + '/' : '') + oname); return; }
      if (oldDir === newDir){
        ops.push({ op: 'rename', fid: idOf(hit), orig: oname, name: nname, oldDir: oldDir, newDir: oldDir, why: 'JSON 整理' });
      } else {
        var tcid = dirCid[newDir];
        if (!tcid){ miss.push('→ ' + (newDir ? newDir + '/' : '') + nname + '（目标目录不存在）'); return; }
        ops.push({ op: 'move', fid: idOf(hit), orig: oname, name: nname, oldDir: oldDir, newDir: newDir, toDir: newDir, toCid: tcid, why: 'JSON 整理' });
      }
    });
    return { ops: ops, miss: miss };
  }

  /* 目录树 → 纯文本（给 AI 看；node = { name, children:[{name, dir, children}] }） */
  function renderTreeText(node, opts){
    opts = opts || {};
    var maxLines = opts.maxLines || 3000, lines = [];
    function walk(n, prefix){
      var kids = (n && n.children) || [];
      for (var i = 0; i < kids.length; i++){
        if (lines.length >= maxLines){ return; }
        var k = kids[i], last = (i === kids.length - 1);
        lines.push(prefix + (last ? '└─ ' : '├─ ') + k.name + (k.dir ? '/' : '') + (k.note ? ('　' + k.note) : ''));
        if (k.dir) walk(k, prefix + (last ? '   ' : '│  '));
      }
    }
    walk(node, '');
    if (lines.length >= maxLines) lines.push('…（目录过大，已截断）');
    return lines.join('\n');
  }

  /* ================= 一点八、官方「导出目录树」txt 解析（路子 A） =================
     115 官方「导出目录树」的产物格式（已用真实 20 万行导出实测）：
       · 编码 UTF-16LE + BOM（ff fe），换行是 \n
       · 根行  `|——<名字>`（`——` 是两个 U+2014 长破折号）；其余行 `<缩进>|-<名字>`
       · 缩进每层 2 个字符；一行里 `|-` 的下标 ÷ 2 = 该行的深度
       · 名字里带换行的会被折成「续行」（不含 `|-` 的行），要拼回上一条
       · **不区分文件/文件夹、也没有体积** —— 本层用「有没有子节点」反推目录
         （空目录会被误判为文件，这是导出格式的固有限制，导出产物里无法区分）
     本函数不发请求、不读全局，输入文本 → 输出树，便于 Node 侧单测。 */

  /* 字节 → 文本。优先看 BOM；没有 BOM 时按「奇数位（每个 UTF-16LE 字符的高字节）大量为 0x00」判定 UTF-16LE。
     为什么用奇数位而不是全部字节：中文为主的目录树里，ASCII 标记（| - / 数字 扩展名）少、中文多，
     若按「全部字节 0x00 占比」算，中文多时会低于阈值被误判成 UTF-8，解出来 | 与 - 之间夹着 NUL → 解析不到标记 → 空树。
     而 UTF-16LE 下 ASCII 字符一定是 <字节> 00，奇数位必为 0x00；UTF-8 文本几乎不出现 0x00，因此奇数位 0x00 占比是稳的判别信号。 */
  function decodeTreeBytes(buf) {
    var u8;
    if (buf && buf.buffer) u8 = new Uint8Array(buf.buffer, buf.byteOffset || 0, buf.byteLength);
    else if (buf instanceof Uint8Array) u8 = buf;
    else u8 = new Uint8Array(0);
    /* 1) BOM 优先（115 真实导出是 UTF-16LE + BOM；代理若把字节重新编码可能丢 BOM，落到下面的无 BOM 分支） */
    if (u8.length >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF)
      return String(new TextDecoder('utf-8').decode(u8.subarray(3))).replace(/^\uFEFF/, '');
    if (u8.length >= 2 && u8[0] === 0xFE && u8[1] === 0xFF)
      return String(new TextDecoder('utf-16be').decode(u8)).replace(/^\uFEFF/, '');
    if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE)
      return String(new TextDecoder('utf-16le').decode(u8)).replace(/^\uFEFF/, '');
    /* 2) 无 BOM：奇数位 0x00 占比高 → UTF-16LE（阈值 0.2 给中文为主的目录树留出空间） */
    var oddZero = 0, probe = Math.min(u8.length, 600);
    for (var i = 1; i < probe; i += 2) { if (u8[i] === 0) oddZero++; }
    var enc = (probe > 0 && oddZero > probe * 0.2) ? 'utf-16le' : 'utf-8';
    var txt = '';
    try { txt = new TextDecoder(enc).decode(u8); }
    catch (e) {
      /* 环境没有 TextDecoder 时的兜底：手工按 UTF-16LE 拼（够解析 ASCII/常用中文） */
      var out = [];
      for (var j = 0; j + 1 < u8.length; j += 2) out.push(String.fromCharCode(u8[j] | (u8[j + 1] << 8)));
      txt = out.join('');
    }
    /* 3) 兜底：解出来没有任何目录树标记、且奇数位 0x00 偏多（疑似被当 UTF-8 解坏的 UTF-16LE），改用 UTF-16LE 再解一次 */
    if (txt.indexOf('|——') < 0 && txt.indexOf('|-') < 0 && enc === 'utf-8' && oddZero > probe * 0.08) {
      try { txt = new TextDecoder('utf-16le').decode(u8); } catch (e2) {}
    }
    return String(txt).replace(/^\uFEFF/, '');
  }

  /* 递归统计后代节点数（折叠提示用） */
  function countNodes(n) {
    var kids = (n && n.children) || [], n2 = 0;
    for (var i = 0; i < kids.length; i++) n2 += 1 + countNodes(kids[i]);
    return n2;
  }

  /* 导出 txt → 树。返回 { ok, name(根名), count, tree }
     容错：跳级的坏数据按「挂到已知最深父级」处理，不抛错。 */
  function parseExportTree(text) {
    var lines = String(text == null ? '' : text).split(/\r?\n/);
    var root = { name: '', dir: true, children: [] };
    var stack = [root], count = 0, lastNode = null;
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      if (!raw) continue;
      var name = '', depth = -1;
      if (raw.indexOf('|——') === 0) { name = raw.slice(3); depth = 0; }
      else {
        var idx = raw.indexOf('|-');
        if (idx >= 0) { name = raw.slice(idx + 2); depth = idx / 2; }
        else {
          /* 续行：名字里带换行被折下来的，拼回上一条 */
          if (lastNode) lastNode.name += '\n' + raw;
          continue;
        }
      }
      if (depth <= 0) { root.name = name || root.name; stack = [root]; lastNode = null; continue; }
      if (depth > stack.length) depth = stack.length;      // 跳级坏数据 → 挂到最深已知父级
      stack = stack.slice(0, depth);
      var node = { name: name, dir: false, children: [] };
      (stack[depth - 1] || root).children.push(node);
      stack.push(node);
      lastNode = node;
      count++;
    }
    (function mark(n) {
      var k = n.children || [];
      n.dir = k.length > 0;
      for (var m = 0; m < k.length; m++) mark(k[m]);
    })(root);
    return { ok: count > 0, name: root.name, count: count, tree: root };
  }

  /* 剪枝：只保留前 maxDepth 层、最多 maxNodes 个节点，被折叠的节点挂 note 说明。
     目的：把可能上万行的目录树压成「AI 能一次读完」的规模。 */
  function trimTree(root, opts) {
    opts = opts || {};
    var maxDepth = typeof opts.maxDepth === 'number' ? opts.maxDepth : 4;
    var budget = typeof opts.maxNodes === 'number' ? opts.maxNodes : 1500;
    var used = 0;
    function walk(n, d) {
      var out = { name: n.name, dir: !!n.dir, children: [] };
      var kids = n.children || [];
      if (!kids.length) return out;
      if (d >= maxDepth) { out.note = '共 ' + countNodes(n) + ' 项，已折叠'; return out; }
      for (var i = 0; i < kids.length; i++) {
        if (used >= budget) { out.note = '还有 ' + (kids.length - i) + ' 项已折叠'; break; }
        used++;
        out.children.push(walk(kids[i], d + 1));
      }
      return out;
    }
    return walk(root, 0);
  }

  /* ================= 二、规则注册表 ================= */
  /* 分组见文档 §4.1；done=false 的规则在规则页显示为「即将上线」，不可勾选。
     已实现：全部 A 组（9 条，纯改名）+ 导入组「JSON 整理」。B/C/D 组待执行器支持 mkdir/move/delete 后接入。 */
  var RULE_GROUPS = [
    {
      id: 'J', name: '导入', risk: 'low', riskLabel: '外部方案 · 按清单改名',
      rules: [
        { id: 'jsonPlan', name: 'JSON 整理', risk: 'low', done: true }
      ]
    },
    {
      id: 'A', name: '命名规范', risk: 'low', riskLabel: '低风险 · 只改名，可逆',
      rules: [
        { id: 'watermark',     name: '水印清洗',     risk: 'low', done: true },
        { id: 'extLower',      name: '扩展名小写',   risk: 'low', done: true },
        { id: 'dvdUpper',      name: '番号大写化',   risk: 'low', done: true },
        { id: 'dvdNormalize',  name: '番号归一',     risk: 'low', done: true },
        { id: 'illegalChar',   name: '非法字符清理', risk: 'low', done: true },
        { id: 'lengthCap',     name: '超长截断',     risk: 'low', done: true },
        { id: 'prefixClean',   name: '发布标签剥离', risk: 'low', done: true },
        { id: 'seasonFolder',  name: '季夹归一',     risk: 'low', done: true },
        { id: 'imageSeq',      name: '图片序号化',   risk: 'low', done: true }
      ]
    },
    {
      id: 'B', name: '结构整理', risk: 'mid', riskLabel: '中风险 · 建夹 / 移动',
      rules: [
        { id: 'splitSeason',   name: '多季分夹',   risk: 'mid', done: false },
        { id: 'flatMovie',     name: '电影去套壳', risk: 'mid', done: false },
        { id: 'groupDvdMulti', name: '分碟归一',   risk: 'mid', done: false },
        { id: 'episodeNaming', name: '剧集命名',   risk: 'mid', done: false },
        { id: 'subtitlePair',  name: '字幕配对',   risk: 'mid', done: false },
        { id: 'dvdDirNaming',  name: '番号目录规范', risk: 'mid', done: false }
      ]
    },
    {
      id: 'C', name: '清理', risk: 'high', riskLabel: '高风险 · 删除 / 归档',
      rules: [
        { id: 'dedupArchive', name: '重复归档',   risk: 'high', done: false },
        { id: 'junkArchive',  name: '无意义名归档', risk: 'high', done: false },
        { id: 'snapshotDel',  name: '快照图清理', risk: 'high', done: false },
        { id: 'sampleDel',    name: '样品预告清理', risk: 'high', done: false },
        { id: 'adVideoDel',   name: '广告视频清理', risk: 'high', done: false },
        { id: 'emptyDirDel',  name: '空目录清理', risk: 'high', done: false }
      ]
    },
    {
      id: 'D', name: '归属', risk: 'highest', riskLabel: '最高风险 · 跨库移动（默认关闭）',
      rules: [
        { id: 'toYule',    name: '归位到 娱乐/番号',  risk: 'highest', done: false },
        { id: 'toYingshi', name: '归位到 影视/*',     risk: 'highest', done: false },
        { id: 'toManYing', name: '归位到 漫影/写真集', risk: 'highest', done: false }
      ]
    }
  ];

  /* 预设包（文档 §4.6）：一键勾选若干原子规则的组合。当前仅登记，UI 未接。 */
  var PRESETS = [
    { id: 'quickFix',   name: '安全快修',     risk: 'low',     rules: ['watermark', 'extLower', 'dvdUpper', 'illegalChar'] },
    { id: 'dvdNorm',    name: '番号片规范',   risk: 'mid',     rules: ['watermark', 'extLower', 'dvdUpper', 'illegalChar', 'dvdNormalize', 'dvdDirNaming', 'groupDvdMulti', 'dedupArchive'] },
    { id: 'tvAnime',    name: '剧集/动漫整理', risk: 'mid',     rules: ['watermark', 'extLower', 'dvdUpper', 'illegalChar', 'prefixClean', 'seasonFolder', 'splitSeason', 'episodeNaming', 'subtitlePair'] },
    { id: 'photoSet',   name: '图片集整理',   risk: 'mid',     rules: ['extLower', 'illegalChar', 'imageSeq', 'dedupArchive'] },
    { id: 'deepClean',  name: '深度清理',     risk: 'high',    rules: ['snapshotDel', 'sampleDel', 'adVideoDel', 'junkArchive', 'emptyDirDel'] },
    { id: 'toLibrary',  name: '归位入库',     risk: 'highest', rules: ['toYule', 'toYingshi', 'toManYing'] }
  ];

  function findRule(id) {
    for (var i = 0; i < RULE_GROUPS.length; i++) {
      var g = RULE_GROUPS[i];
      for (var j = 0; j < g.rules.length; j++) {
        if (g.rules[j].id === id) return { group: g, rule: g.rules[j] };
      }
    }
    return null;
  }

  /* 规则 id → op 列表的总入口（当前只实现水印清洗，其余返回空并给出原因） */
  function planRule(ruleId, items, options) {
    options = options || {};
    if (ruleId === 'watermark')    return { ok: true, ops: planWatermark(items, options.watermarks || defaultWatermarks()), reason: '' };
    if (ruleId === 'extLower')     return { ok: true, ops: planExtLower(items), reason: '' };
    if (ruleId === 'dvdUpper')     return { ok: true, ops: planDvdUpper(items), reason: '' };
    if (ruleId === 'dvdNormalize') return { ok: true, ops: planDvdNormalize(items), reason: '' };
    if (ruleId === 'illegalChar')  return { ok: true, ops: planIllegalChar(items), reason: '' };
    if (ruleId === 'lengthCap')    return { ok: true, ops: planLengthCap(items, options), reason: '' };
    if (ruleId === 'prefixClean')  return { ok: true, ops: planPrefixClean(items), reason: '' };
    if (ruleId === 'seasonFolder') return { ok: true, ops: planSeasonFolder(items), reason: '' };
    if (ruleId === 'imageSeq')     return { ok: true, ops: planImageSeq(items), reason: '' };
    if (ruleId === 'jsonPlan') {
      if (!options.entries || !options.entries.length) return { ok: false, ops: [], reason: '还没有导入 JSON 清单' };
      var jr = planJsonItems(options.entries, options);
      return { ok: true, ops: jr.ops, reason: '', miss: jr.miss };
    }
    var hit = findRule(ruleId);
    if (!hit) return { ok: false, ops: [], reason: '未知规则' };
    return { ok: false, ops: [], reason: '即将上线' };
  }

  /* ================= 三、任务步骤模板 ================= */

  /* 任务卡展开时按步骤显示进度（对应 UI 层任务列表的展开体）。
     步骤状态：idle 未开始 / running 进行中 / ok 完成 / fail 失败 / skip 跳过
     模板只定 key + label；时间与文案(msg) 由执行方逐步写入。 */

  var TASK_STEPS = {
    /* 规则整理：选规则 → 读目录 → 出计划 → 预览确认 → 执行 */
    rule: [
      { key: 'scan', label: '读取文件夹' },
      { key: 'plan', label: '匹配规则生成计划' },
      { key: 'exec', label: '执行改名' }
    ],
    /* JSON 整理：上传清单 → 逐条定位 → 预览确认 → 执行 */
    json: [
      { key: 'read',   label: '读取 JSON 清单' },
      { key: 'locate', label: '定位原文件' },
      { key: 'exec',   label: '执行改名' }
    ],
    /* AI 整理：先手动取目录树 → 对话 → 出清单 → 执行 */
    ai: [
      { key: 'tree', label: '获取目录树' },
      { key: 'chat', label: '与 AI 对话确定方案' },
      { key: 'plan', label: '生成整理清单' },
      { key: 'exec', label: '确认并执行' }
    ]
  };

  function newSteps(kind){
    var tpl = TASK_STEPS[kind] || [];
    var out = [];
    for (var i = 0; i < tpl.length; i++){
      out.push({ key: tpl[i].key, label: tpl[i].label, state: 'idle', msg: '', at: 0 });
    }
    return out;
  }

  /* 就地更新某一步；找不到 key 时原样返回，不抛错 */
  function stepSet(steps, key, patch){
    var list = steps || [];
    for (var i = 0; i < list.length; i++){
      if (list[i].key === key){
        for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) list[i][k] = patch[k];
        break;
      }
    }
    return list;
  }

  /* ================= 五、批量改名与风控识别（防风控） =================
     115 官方有「批量改名」接口 files/batch_rename：一次请求改多条，
       body 形如 files_new_name[<fid>]=<新名>（jQuery 表单序列化风格，键值都编码）
       回包 {state:true,errno:0,data:{"<fid>":"<新名>"}}
     把「N 次请求」压成「ceil(N/100) 次」——这是防风控里最有效的一步；
     剩下的靠调用侧的串行 + 最小间隔 + 风控熔断（见 ui-ios 的 c115Gate / c115RiskHit）。 */
  var RENAME_BATCH = 100;  // 单次最多带多少条（中文名约 200 字节/条，100 条约 20KB body，安全）
  var RISK_RE = /(过于频繁|操作频繁|请求频繁|频繁|检测异常|异常行为|风控|访问受限|稍后再试|暂时无法|请求过多|访问速度过快|系统繁忙|请稍候)/;

  /* 计划 → 分批（每批最多 size 条） */
  function chunkPlan(ops, size){
    var n = size || RENAME_BATCH, out = [];
    ops = ops || [];
    for (var i = 0; i < ops.length; i += n) out.push(ops.slice(i, i + n));
    return out;
  }
  /* 一批 → files/batch_rename 的 body（键值都编码，中英文/括号/空格都安全） */
  function batchRenameBody(ops){
    return (ops || []).filter(function (o){ return o && o.fid; }).map(function (o){
      return encodeURIComponent('files_new_name[' + o.fid + ']') + '=' + encodeURIComponent(o.name || '');
    }).join('&');
  }
  /* 回包 → 这批的成败：data 里出现该 fid 即成功；没有 data 时退化为看 state/errno */
  function readRenameResult(d, chunk){
    var map = (d && d.data && typeof d.data === 'object') ? d.data : null;
    var ok = 0, fail = 0, failed = [];
    (chunk || []).forEach(function (o){
      var hit = map ? Object.prototype.hasOwnProperty.call(map, String(o.fid))
                    : !!(d && (d.state === true || d.errno === 0));
      if (hit) ok++; else { fail++; failed.push(o); }
    });
    return { ok: ok, fail: fail, failed: failed };
  }
  /* 115 的「软风控」：HTTP 200 但 {state:false,error:"…"}。返回命中的原文；没命中返回 '' */
  function riskText(d){
    if (!d || d.state !== false) return '';
    var msg = String(d.error || d.msg || d.message || '');
    return RISK_RE.test(msg) ? msg : '';
  }

  var api = {
    RENAME_BATCH: RENAME_BATCH,
    chunkPlan: chunkPlan,
    batchRenameBody: batchRenameBody,
    readRenameResult: readRenameResult,
    riskText: riskText,
    WATERMARK_DEFAULT: WATERMARK_DEFAULT,
    defaultWatermarks: defaultWatermarks,
    watermarkRegExp: watermarkRegExp,
    finalizeName: finalizeName,
    pathBrief: pathBrief,
    applyWatermarks: applyWatermarks,
    previewWatermark: previewWatermark,
    planWatermark: planWatermark,
    RULE_GROUPS: RULE_GROUPS,
    PRESETS: PRESETS,
    findRule: findRule,
    planRule: planRule,
    nameOf: nameOf,
    isDirItem: isDirItem,
    idOf: idOf,
    splitExt: splitExt,
    planExtLower: planExtLower,
    planDvdUpper: planDvdUpper,
    planDvdNormalize: planDvdNormalize,
    planIllegalChar: planIllegalChar,
    planLengthCap: planLengthCap,
    planPrefixClean: planPrefixClean,
    planSeasonFolder: planSeasonFolder,
    planImageSeq: planImageSeq,
    parseTidyJson: parseTidyJson,
    planJsonItems: planJsonItems,
    stripJsonBlock: stripJsonBlock,
    planToJson: planToJson,
    renderTreeText: renderTreeText,
    decodeTreeBytes: decodeTreeBytes,
    parseExportTree: parseExportTree,
    trimTree: trimTree,
    countNodes: countNodes,
    TASK_STEPS: TASK_STEPS,
    newSteps: newSteps,
    stepSet: stepSet
  };

  global.TidyCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports.TidyCore = api;
})(typeof window !== 'undefined' ? window : this);
