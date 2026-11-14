/* nfo-editor 共享核心（模式 B）——纯逻辑层，不碰 DOM
 * 由两端（PC 多文件 / 手机单文件+引用）通过 <script src="src/core-shared.js"> 加载，
 * 暴露全局 window.NfoCore。所有函数不读全局 state、不访问 document，依赖通过参数传入。
 * 演进由主线 AI 全权控；边缘 AI 仅按接口契约填空，不得另写近似实现。
 */
(function (global) {
  'use strict';

  function escapeXml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function sanitizeName(name) {
    /* 2026-09-14 起 / 不再视为非法字符（115 夹名支持 /，用户拍板），仅净化 \ : * ? " < > | */
    return (name || '')
      .replace(/[\\:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim() || 'movie';
  }

  // 统一 NFO（<movie>）生成：覆盖 PC 端 buildNFOMovieXml 与手机端两处 NFO 的全部字段，
  // actor 含 <thumb> 头像名（Kodi 可定位演员图，比纯对象版更全）。
  // d 为 film.data 或等价字段对象；空字段不输出标签。
  function buildMovieXml(d) {
    d = d || {};
    var title = d.title || '', originaltitle = d.originaltitle || '',
        year = d.year || '', premiered = d.premiered || '',
        runtime = d.runtime || '', plot = d.plot || '', rating = d.rating || '',
        mpaa = d.mpaa || '';
    var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<movie>\n';
    if (title) xml += '    <title>' + escapeXml(title) + '</title>\n';
    if (originaltitle) xml += '    <originaltitle>' + escapeXml(originaltitle) + '</originaltitle>\n';
    if (year) xml += '    <year>' + escapeXml(year) + '</year>\n';
    if (premiered) xml += '    <premiered>' + escapeXml(premiered) + '</premiered>\n';
    if (runtime) xml += '    <runtime>' + escapeXml(runtime) + '</runtime>\n';
    if (rating) xml += '    <rating>' + escapeXml(rating) + '</rating>\n';
    if (plot) xml += '    <plot>' + escapeXml(plot) + '</plot>\n';
    (d.genres || []).forEach(function (g) { if (g) xml += '    <genre>' + escapeXml(g) + '</genre>\n'; });
    (d.countries || []).forEach(function (c) { if (c) xml += '    <country>' + escapeXml(c) + '</country>\n'; });
    if (mpaa) xml += '    <mpaa>' + escapeXml(mpaa) + '</mpaa>\n';
    (d.directors || []).forEach(function (dir) { if (dir && dir.name) xml += '    <director>' + escapeXml(dir.name) + '</director>\n'; });
    (d.actors || []).forEach(function (a, i) {
      if (!a || !a.name) return;
      xml += '    <actor>\n';
      xml += '      <name>' + escapeXml(a.name) + '</name>\n';
      if (a.role) xml += '      <role>' + escapeXml(a.role) + '</role>\n';
      xml += '      <thumb>' + escapeXml(sanitizeName(a.name) + '-actor.jpg') + '</thumb>\n';
      xml += '      <order>' + (i + 1) + '</order>\n';
      xml += '    </actor>\n';
    });
    if (d.hasSubtitle) xml += '    <subtitles>字幕</subtitles>\n';
    xml += '</movie>\n';
    return xml;
  }

  // 剧集 NFO（<tvshow>，Kodi 命名规范）生成：与 buildMovieXml 同风格（4 空格缩进、空字段不输出）。
  // 剧集专属：<status>（连载中/已完结）、<season> 季号、<episode> 总集数；无番号/制作商/发行商/系列。
  function buildTvShowXml(d) {
    d = d || {};
    var title = d.title || '', originaltitle = d.originaltitle || '',
        year = d.year || '', premiered = d.premiered || '',
        runtime = d.runtime || '', plot = d.plot || '', rating = d.rating || '',
        mpaa = d.mpaa || '', status = d.status || '',
        season = d.season || '', episode = d.episode || '';
    var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<tvshow>\n';
    if (title) xml += '    <title>' + escapeXml(title) + '</title>\n';
    if (originaltitle) xml += '    <originaltitle>' + escapeXml(originaltitle) + '</originaltitle>\n';
    if (year) xml += '    <year>' + escapeXml(year) + '</year>\n';
    if (premiered) xml += '    <premiered>' + escapeXml(premiered) + '</premiered>\n';
    if (runtime) xml += '    <runtime>' + escapeXml(runtime) + '</runtime>\n';
    if (rating) xml += '    <rating>' + escapeXml(rating) + '</rating>\n';
    if (status) xml += '    <status>' + escapeXml(status) + '</status>\n';
    if (plot) xml += '    <plot>' + escapeXml(plot) + '</plot>\n';
    (d.genres || []).forEach(function (g) { if (g) xml += '    <genre>' + escapeXml(g) + '</genre>\n'; });
    (d.countries || []).forEach(function (c) { if (c) xml += '    <country>' + escapeXml(c) + '</country>\n'; });
    if (mpaa) xml += '    <mpaa>' + escapeXml(mpaa) + '</mpaa>\n';
    if (season) xml += '    <season>' + escapeXml(season) + '</season>\n';
    if (episode) xml += '    <episode>' + escapeXml(episode) + '</episode>\n';
    (d.directors || []).forEach(function (dir) { if (dir && dir.name) xml += '    <director>' + escapeXml(dir.name) + '</director>\n'; });
    (d.actors || []).forEach(function (a, i) {
      if (!a || !a.name) return;
      xml += '    <actor>\n';
      xml += '      <name>' + escapeXml(a.name) + '</name>\n';
      if (a.role) xml += '      <role>' + escapeXml(a.role) + '</role>\n';
      xml += '      <thumb>' + escapeXml(sanitizeName(a.name) + '-actor.jpg') + '</thumb>\n';
      xml += '      <order>' + (i + 1) + '</order>\n';
      xml += '    </actor>\n';
    });
    if (d.hasSubtitle) xml += '    <subtitles>字幕</subtitles>\n';
    // v404 每集简介（详情页选集功能的缓存 d.tvSeasons）：Kodi 规范允许 tvshow.nfo 内嵌
    // <episodedetails> 块，上传/导出 zip 共用此生成器，两条链路自动带上。
    // 只写已加载过的季（没打开过的季没有缓存，不阻塞上传）；空简介集只输出序号/标题。
    var dsPacks = d.tvSeasons || {};
    var dsEps = [];
    Object.keys(dsPacks).forEach(function (k) {
      var pack = dsPacks[k] || {};
      var n = (pack.n != null) ? pack.n : Number(k);
      (pack.episodes || []).forEach(function (e) {
        if (e && e.ep) dsEps.push({ n: n, ep: e.ep, name: e.name || '', plot: e.overview || '', air: e.air || '', runtime: Number(e.runtime) || 0, vote: Number(e.vote) || 0 });
      });
    });
    dsEps.sort(function (a, b) { return (a.n - b.n) || (a.ep - b.ep); });
    dsEps.forEach(function (e) {
      xml += '    <episodedetails>\n';
      xml += '        <season>' + escapeXml(String(e.n)) + '</season>\n';
      xml += '        <episode>' + escapeXml(String(e.ep)) + '</episode>\n';
      xml += '        <title>' + escapeXml(e.name || ('第 ' + e.ep + ' 集')) + '</title>\n';
      if (e.plot) xml += '        <plot>' + escapeXml(e.plot) + '</plot>\n';
      if (e.air) xml += '        <aired>' + escapeXml(e.air) + '</aired>\n';
      if (e.runtime > 0) xml += '        <runtime>' + e.runtime + '</runtime>\n';
      if (e.vote > 0) xml += '        <rating>' + e.vote + '</rating>\n';
      xml += '    </episodedetails>\n';
    });
    xml += '</tvshow>\n';
    return xml;
  }

  // ===== 翻译模块（纯逻辑，不碰 DOM/state）=====
  // 提示语：成人影视元数据 → 简体中文；含 8 条硬性规则（番号原样、含假名才翻、JSON 输出）
  var TRANSLATE_SYSTEM_PROMPT = [
    '你是将影视元数据译为简体中文的翻译专家。请把下方「标题」与「简介」翻译为简体中文。',
    '源语言不确定：可能是日文、英文、韩文、法文、德文、西班牙文、俄文、泰文等任意语言，请先自动判断再翻译，不要假设一定是日文。',
    '硬性规则：',
    '1. 仅做等值翻译，不增删、不概括、不改写语气。',
    '2. 专有名词保留原文并附中文：人名、片商、系列名。',
    '3. 番号/型号代码（如 SONE-456、ABC-123）一律原样输出，绝不翻译或改写。',
    '4. 语种差异要照顾：日文汉字按简体中文习惯转写；韩文/泰文等先音译再意译；英文标题优先用通行中文译名，没有则直译。',
    '5. 不雅化也不净化原文本措辞，保持原营销/直述风格。',
    '6. 已是简体中文的内容原样输出，不要改写或翻译。',
    '7. 严格输出 JSON，不要任何多余文字、不要 markdown 代码块包裹。格式：{"title":"简体中文标题","summary":"简体中文简介"}'
  ].join('\n');

  /* ===== AI 通用底座（v502 架构收敛）=====
     同一个 OpenAI 兼容 LLM，换 system prompt 就是不同功能。
     AI_PROMPTS = 提示词表；callLLM = 客户端唯一的请求出口
     （endpoint 补全 / Bearer / 超时 / 取 content 全在这里）。
     各功能只负责「挑 prompt + 拼输入 + 解析结果」；服务端代理路径由各功能自己发。 */
  var AI_PROMPTS = {
    translate: TRANSLATE_SYSTEM_PROMPT,
    /* v504：文件整理提示词由 Worker 搬入，客户端成为唯一真相（Worker 只透传 prompt） */
    tidy: [
      '你是「115 网盘文件整理助手」，帮用户把网盘里的文件名整理规范。',
      '',
      '【怎么对话】',
      '1. 用简体中文，回答简短（一般 3 句以内），不要复述整棵树。',
      '2. 不确定就问，不要臆测。目录树里没有文件体积、也不区分文件夹和文件，',
      '   只能靠扩展名和上下文推断；拿不准就说明你的假设。',
      '3. 平时只讨论「怎么改名字、放哪个文件夹」，给出建议方案（改什么、为什么），',
      '   并且**不要输出任何 JSON 或代码块**。',
      '4. 只有收到「出清单」类指令（用户说「出清单 / 确认结果 / 就这样 / 可以了 / 开始 / 执行」，',
      '   或收到「【出清单】」这样的指令）时，才输出整理清单。',
      '',
      '【命名规范 —— 必须遵守】',
      '- 统一格式：同一作品 / 同一系列的文件，命名风格要一致（分隔符、大小写、集数写法）。',
      '- 保留关键信息：番号、年份、季号集数、分辨率、版本后缀一个都不能丢；扩展名原样保留（连 . 一起）。',
      '- 清掉噪声：站点 / 论坛水印（形如 www.xxx.com、[xxx论坛]、@xxx 这类推广标记）、',
      '  重复的方括号标签、连续分隔符、首尾空格与多余的点。',
      '- 番号统一大写（例如 abc-123 → ABC-123），数字部分不要动。',
      '- 精简长度：整理后的名字建议不超过 120 个字符；过长时先砍描述性文字，保住番号与集数。',
      '- 合法字符：新名里不能出现 \\ / : * ? " < > | 这九个字符。',
      '- 只允许出现目录树里真实存在的名字，不要编造、不要翻译或改写作品名（除非用户明确要求）。',
      '- 宁少勿错：拿不准的条目不要列进清单，并在回复里说明哪些没处理。',
      '',
      '【目录与移动】',
      '- 允许移动：可以把文件放进更合适的子文件夹（例如按剧集分季、按作品建夹）。',
      '- 新文件路径必须落在目录树里**已经存在**的文件夹（相对目标文件夹）；',
      '  需要新建文件夹时不要擅自写进清单，先在回复里告诉用户要建哪个夹。',
      '- 只改名（不换目录）时，新文件路径 与 旧文件路径 填成一样即可。',
      '',
      '【输出清单时】',
      '回复里只能有**唯一一个 ```json 代码块**，不要有别的内容：',
      '```json',
      '{',
      '  "root": "<目标文件夹名>",',
      '  "total": <总共需要整理的条数（数字）>,',
      '  "items": [',
      '    { "旧文件路径": "<原文件所在目录，相对目标文件夹；就在目标文件夹根下就留空字符串>",',
      '      "旧名": "<原文件名，必须与目录树里的名字逐字一致>",',
      '      "新文件路径": "<整理后文件所在目录，只改名就填和「旧文件路径」一样>",',
      '      "新名": "<整理后的文件名>" }',
      '  ]',
      '}',
      '```',
      '',
      '硬性要求：',
      '- 一次最多列 200 条（items 上限 200）。需要整理的超过 200 条时，只列前 200 条，',
      '  total 照实写总数；用户说「继续」时接着列后面的，不要重复已经列过的条目。',
      '- 不要自行分批：能一次列完就必须全部列出。只有上面那种真的超过 200 条没列完的情况，',
      '  total 才允许大于你实际列出的条数（列的条数 = total 就表示已经列完，不会再输出第二批）。',
      '- 旧名 必须逐字复制目录树里的名字（连扩展名一起），一个字都不能改。',
      '- 旧文件路径 / 新文件路径 用 / 分隔、相对目标文件夹、不以 / 开头、末尾不带 /。',
      '- 没有需要整理的：不要输出清单，直接用一句话说明。'
    ].join('\n'),
    /* v504：精彩评论 —— 8~15 条不同角度的短评，如实反映影片，不预设褒贬 */
    review: [
      '你是一位阅片量很大的影视评论人。请根据给出的【片名】【原始名称】【上映日期】，自行查阅公开资料，判断这是一部什么样的影片、精不精彩、值不值得花时间看。',
      '请模拟不同身份、不同视角的观众，写出 8~15 条彼此不重复的简体中文短评，像一部片子下方真实存在的观众评论。',
      '最重要的是如实反映这部影片本身：不预设立场，不为凑平衡硬写好话或坏话，也不刻意褒贬。一条评论可以是喜欢、可以是不适、可以只是冷静说出一个特点和观感；整体合起来让人看清这片子真实的样子。',
      '角度尽量分散：类型与气质、故事讲法与节奏、影像/配乐/美术、演员表现、印象最深的细节、明显的局限、适合什么人看、适合什么心情看、在同类片里的位置、看完之后剩下什么、一句话直觉等。',
      '风格也要分散：克制专业的影评人、普通观众的直白感受、谨慎推荐、略带调侃但不刻薄、真心喜欢、只做冷静描述的人。不要每条都是同一种腔调。',
      '每条 15~40 字，独立成句，读完能让人对这片子多一点判断；不要全是空泛的夸奖，也不要为了显得客观而硬挑毛病。',
      '不剧透关键情节，不臆造演员、奖项、评分等未证实信息，不照抄资料原文，不用「神作」「烂片」「必看」这类空泛情绪词。',
      '不要出现引用编号、来源链接、「据某某报道」等溯源字样，不要 Markdown、标题、项目符号、序号。',
      '严格输出单个 JSON 对象，不要代码块、不要任何多余文字。格式：{"comments":["评论一","评论二",...]}，数组长度 8~15，每个元素都是字符串。'
    ].join('\n'),
    /* v508：AV（有码番号片）专用评论 —— 输入只有一个番号，风格胆大、轻松、成人向。
       普通影片与 AV 的 prompt 完全分开，互不影响；输出结构仍是 comments 数组，UI 全复用。 */
    avReview: [
      '你是一位熟悉日本商业成人影片的老观众，正在为成人影片资料库写观众短评。用户只给你一个番号（品番），请自行查阅公开资料，判断这是什么路数的片子。',
      '写出 8~15 条彼此不重复的简体中文短评，语气像论坛 / 社群里真实存在的老司机留言。',
      '风格要胆大、轻松、直白：别端着写正经影评，也别写成温吞的官方简介；可以用圈内用语、行话和带点颜色的调侃，敢说题材类别、企划套路、尺度大小、氛围、节奏拖不拖、看点在哪、值不值得留着、适合什么心情看。',
      '如实反映：不预设褒贬，不为凑平衡硬夸硬踩；查不到资料就老实说「这个番号资料少」，不臆造演员、剧情、评分。',
      '角度尽量分散：第一眼的封面印象、题材与企划、主演表现、节奏与剪辑、氛围与质感、亮点、明显短板、在同类里的位置、适合谁看、一句话直觉等。',
      '每条 15~40 字，独立成句，读完能让人对这片子多一点判断。',
      '边界：只讨论成年演员出演的合法商业成人影片，用观感与圈内用语点到为止；不描写具体性行为过程、不写身体细节、不出现任何未成年人相关内容、不涉及非自愿或违法行为。',
      '不要引用编号、来源链接、「据某某报道」等溯源字样，不要 Markdown、标题、项目符号、序号。',
      '严格输出单个 JSON 对象，不要代码块、不要任何多余文字。格式：{"comments":["评论一","评论二",...]}，数组长度 8~15，每个元素都是字符串。'
    ].join('\n')
  };

  // 调用 OpenAI 兼容接口，返回模型回复纯文本；失败 reject Error。
  // cfg = { baseUrl, apiKey, model }；opts = { temperature, timeoutMs, configError }
  function callLLM(messages, cfg, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var base = ((cfg && cfg.baseUrl) || '').trim().replace(/\/+$/, '');
      var key = (cfg && cfg.apiKey) || '';
      var model = (cfg && cfg.model) || '';
      if (!base || !key || !model) { reject(new Error(opts.configError || 'AI 未配置')); return; }
      var endpoint = /\/chat\/completions$/i.test(base) ? base : base + '/chat/completions';
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, opts.timeoutMs || 30000) : null;
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({
          model: model,
          temperature: (opts.temperature == null ? 0.3 : opts.temperature),
          messages: messages
        }),
        signal: ctrl ? ctrl.signal : undefined
      }).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error('HTTP ' + r.status + '：' + t.slice(0, 200)); });
        return r.json();
      }).then(function (d) {
        if (timer) clearTimeout(timer);
        var c = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
        if (!c) throw new Error('AI 返回为空');
        resolve(String(c));
      }).catch(function (err) {
        if (timer) clearTimeout(timer);
        reject(err);
      });
    });
  }

  // 影评清洗：去 ``` 包裹、Markdown 标题/加粗/项目符号、引用角标与来源链接、多余空行，限长
  function cleanAiReviewText(s) {
    var t = String(s || '').trim();
    // 围栏单独成行时整行删掉（模型常在正文前后各放一行 ```），再兜住首尾内联围栏
    t = t.replace(/^[ \t]*```[a-zA-Z]*[ \t]*$/gm, '');
    t = t.replace(/^```[a-zA-Z]*[ \t]*/i, '').replace(/[ \t]*```$/, '');
    t = t.replace(/^\s*#{1,6}\s+/gm, '').replace(/\*\*/g, '');
    t = t.replace(/^\s*[-*]\s+/gm, '').replace(/\n{3,}/g, '\n\n');
    // 联网模型爱带 [1] / 【1,2】 角标与 markdown 链接：链接保留文字，纯数字角标整段删
    t = t.replace(/\[([^\]]+)\]\((?:https?:\/\/|www\.)[^)]+\)/g, '$1');
    t = t.replace(/[\[【]\s*\d+(?:\s*[,，]\s*\d+)*\s*[\]】]/g, '');
    t = t.replace(/[ \t]{2,}/g, ' ');
    return t.trim().slice(0, 80);   // v504：单条短评，防止模型写成长段
  }

  /* v504：精彩评论改为严格 JSON 数组，这里统一取 comments 字段并逐条清洗。
     解析失败 / 条数不足一律抛错，由状态机按「没获取到」静默处理（不退回纯文本）。
     自填配置直连与 Worker 兜底两条链路都走这里，结果完全一致。 */
  function parseAiReviewText(raw) {
    var obj;
    try { obj = extractJsonObject(raw); }
    catch (e) { throw new Error('评论返回非 JSON'); }
    var arr = obj && obj.comments;
    if (!Array.isArray(arr)) throw new Error('评论返回非数组');
    var seen = {}, list = [];
    for (var i = 0; i < arr.length; i++){
      var t = cleanAiReviewText(typeof arr[i] === 'string' ? arr[i] : '');
      if (!t || seen[t]) continue;
      seen[t] = 1;
      list.push(t);
      if (list.length >= 15) break;
    }
    if (list.length < 3) throw new Error('评论条数不足');
    return list;
  }

  // 是否需要翻译：仅当含日文假名（平/片假名）判定为日文；纯汉字/英文/番号不翻（避免误翻中文）
  function needsTranslation(text) {
    if (!text || !String(text).trim()) return false;
    return /[ぁ-んァ-ヶ]/.test(String(text));
  }

  /* 是否「已经是中文」（v439：详情页简介弹窗的「翻译」按钮据此显隐）。
     与 needsTranslation 的分工：这个是「判定语言种类」，供用户手动选择翻译；
     那个是自动链路「要不要偷偷帮你翻」（只认日文假名，尽量不打扰中文/英文用户）。
     判定顺序：假名/谚文 → 直接外语；西里尔/阿拉伯/泰文占比不低 → 外语；
     一个汉字都没有 → 外语；汉字数 ≥ 拉丁字母数 → 中文（中英夹杂的技术描述仍算中文）。 */
  function isChineseText(text) {
    var s = String(text == null ? '' : text).trim();
    if (!s) return true;
    if (/[ぁ-んァ-ヶ]/.test(s)) return false;
    if (/[가-힣]/.test(s)) return false;
    var cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length;
    var latin = (s.match(/[A-Za-z]/g) || []).length;
    var other = (s.match(/[\u0400-\u04ff\u0600-\u06ff\u0e00-\u0e7f]/g) || []).length;
    if (other > 0 && other * 4 >= (cjk + latin)) return false;
    if (cjk === 0) return false;
    return cjk >= latin;
  }

  // 从模型返回解析 JSON：兼容 ```json 包裹 / 首尾空白 / 噪音文字；失败抛错由调用方保留原文
  function extractJsonObject(s) {
    s = String(s || '').trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    var a = s.indexOf('{'); var b = s.lastIndexOf('}');
    if (a === -1 || b === -1 || b < a) throw new Error('翻译返回非 JSON');
    return JSON.parse(s.slice(a, b + 1));
  }

  // 按字段独立判定是否需要翻译（含日文假名才翻，已有中文/英文/番号跳过）
  function computeTranslateNeed(film) {
    var title = (film.data && film.data.title) || film.title || '';
    var plot = (film.data && film.data.plot) || '';
    return { title: needsTranslation(title), plot: needsTranslation(plot) };
  }

  // 清理翻译结果里的 HTML 标签：LLM 常返回带 <br>/<p> 的简介，
  // 若原样存进 plot 会被详情页 textContent 当成字面文字显示成「<br>」。
  // 块级标签转换行、行内标签剥离、HTML 实体解码；单点真相，两端 translateMeta 共用
  function cleanTranslatedText(s) {
    if (typeof s !== 'string' || !s) return s;
    return s
      .replace(/<br\s*\/?>/gi, '\n')                        // <br> / <br/> → 换行
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')          // 块级结束 → 换行
      .replace(/<(p|div|li|tr|h[1-6])(\s[^>]*)?>/gi, '\n')  // 块级开始 → 换行
      .replace(/<[^>]+>/g, '')                              // 其余标签（<b>/<span> 等）剥离
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&#0?39;/gi, "'")
      .replace(/&quot;/gi, '"')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  // 去掉翻译标题里的括号注释及内容（全角（）与半角 ()）：
  // 「泉まりん（泉玛丽恩） 日高ゆりあ（日高百合亚）」→「泉まりん 日高ゆりあ」。
  // 仅用于 title（括号内容多为演员罗马音等注释）；简介 plot 不做此清理
  function stripTitleParens(s) {
    if (typeof s !== 'string' || !s) return s;
    return s
      .replace(/[（(][^（）()]*[）)]/g, '')   // 逐层剥最内层括号（不支持嵌套，翻译标题无此场景）
      .replace(/[ \t\u3000]{2,}/g, ' ')      // 剥离后可能残留连续空格，收敛为一个
      .trim();
  }

  /* 「标题.年份」→ { title, year }（搜索增强，v398）。
     只在年份前有明确分隔（空白 / . _ - / 括号）时拆，「请回答1988」「机动战士高达00」这类
     片名本身带数字的不会被误切；纯年份（如「2019」）也不拆，按原词搜。
     year 为 0 表示没识别到年份，调用方不要传 year 参数。 */
  function parseTitleYear(q) {
    var s = String(q == null ? '' : q).trim();
    if (!s) return { title: '', year: 0 };
    var m = /^(.+?)(?:[\s._-]+|[（(])((?:19|20)\d{2})[)）]?$/.exec(s);
    if (!m) return { title: s, year: 0 };
    var title = m[1].replace(/[\s._-]+$/, '').trim();
    if (!title) return { title: s, year: 0 };
    return { title: title, year: Number(m[2]), raw: s };
  }

  /* 搜索结果排序（v398）：把「标题对 + 年份也对」的精准项提到最上方，其次标题对，
     再次年份对，其余保持 TMDB 原顺序（sort 稳定，同档不乱序）。py 来自 parseTitleYear。 */
  function rankTitleYearResults(list, py) {
    list = Array.isArray(list) ? list.slice() : [];
    if (!py || !py.year || list.length < 2) return list;
    var q = String(py.title || '').trim().toLowerCase();
    function key(r) {
      var tl = String(r.title || r.name || '').trim().toLowerCase();
      var og = String(r.original_title || r.original_name || '').trim().toLowerCase();
      var d = String(r.release_date || r.first_air_date || '');
      var yHit = (Number(d.slice(0, 4)) || 0) === py.year;
      var tHit = q && (tl === q || og === q);
      if (tHit && yHit) return 0;
      if (tHit) return 1;
      if (yHit) return 2;
      return 3;
    }
    return list.sort(function (a, b) { return key(a) - key(b); });
  }

  // 翻译：挑 translate prompt + 拼输入 + 解析 JSON；请求本身交给通用 callLLM。
  // 返回 Promise<{title, summary}>（30s 超时）；cfg = { baseUrl, apiKey, model }
  function translateMeta(title, plot, cfg) {
    var userMsg = '【标题】\n' + (title || '') + '\n\n【简介】\n' + (plot || '');
    return callLLM([
      { role: 'system', content: AI_PROMPTS.translate },
      { role: 'user', content: userMsg }
    ], cfg, { configError: '翻译未配置' }).then(function (c) {
      var res;
      try { res = extractJsonObject(c); }
      catch (e) { throw new Error('翻译结果解析失败'); }
      if (typeof res.title === 'string') res.title = stripTitleParens(cleanTranslatedText(res.title));
      if (typeof res.summary === 'string') res.summary = cleanTranslatedText(res.summary);
      return res;
    });
  }

  /* 精彩评论（v504 起）：
     普通影片 info = { title, originaltitle, date } → AI_PROMPTS.review；
     AV 影片 info = { av:true, dvdId } → AI_PROMPTS.avReview，只发番号（v508）。
     自填配置完整 → 直连 LLM；否则 → Worker /ai/review（提示词随请求体带过去）。
     两条链路都拿到模型原文，统一由 parseAiReviewText 取 comments → 评论数组。 */
  function reviewRequest(info, opts) {
    opts = opts || {};
    info = info || {};
    var av = !!info.av;
    var sysPrompt = av ? AI_PROMPTS.avReview : AI_PROMPTS.review;
    var payload = av
      ? { dvdId: String(info.dvdId || '').slice(0, 60), prompt: sysPrompt }
      : {
          title: String(info.title || '').slice(0, 200),
          originaltitle: String(info.originaltitle || '').slice(0, 200),
          date: String(info.date || '').slice(0, 20),
          prompt: sysPrompt
        };
    if (av ? !payload.dvdId.trim() : !payload.title.trim()) {
      return Promise.reject(new Error(av ? '缺少番号' : '缺少片名'));
    }
    var userMsg = av
      ? '【番号】' + payload.dvdId
      : '【片名】' + payload.title
        + '\n【原始名称】' + (payload.originaltitle || '未知')
        + '\n【上映日期】' + (payload.date || '未知');
    var own = opts.ownCfg || {};
    if (own.baseUrl && own.apiKey && own.model) {
      return callLLM([
        { role: 'system', content: sysPrompt },
        { role: 'user', content: userMsg }
      ], own, { temperature: 0.7 }).then(parseAiReviewText);
    }
    var base = (opts.workerBase || '').replace(/\/+$/, '');
    if (!base) return Promise.reject(new Error('未配置精彩评论：请填写 AI 配置或升级高级档'));
    var url = base + '/ai/review' + (opts.code ? ('?code=' + encodeURIComponent(opts.code)) : '');
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().then(function (d) {
        if (d && d.error) throw new Error(d.error);
        return d;
      });
    }).then(function (d) { return parseAiReviewText(d && d.raw); });
  }

  // ===== JAV 解析（纯逻辑，不碰 DOM/state；两端逐字一致的映射表合并为单点真相）=====
function javStr(v){
  if (v == null || v === '') return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(javStr).filter(Boolean).join(', ');
  if (typeof v === 'object') return javStr(v.name_ja || v.name_kanji || v.name_en || v.name_romaji || v.name || v.title || v.text || '');
  return String(v);
}
function javName(v){
  if (!v) return '';
  if (typeof v === 'string') return v;
  return javStr(v.name_ja || v.name_en || v.name || v);
}
var GENRE_EN2ZH = {
  'IDOL': '偶像', 'SF': '科幻', 'VR': 'VR', 'VRSION': 'VR', '4HR+': '4小时以上',
  'Acme': '高潮', 'Amateur': '素人', 'Anal': '肛交', 'Anal Play': '肛交', 'Anime': '动画',
  'Ass Lover': '美臀', 'Bakunyu': '爆乳', 'BDSM': 'BDSM', 'Beautiful Girl': '美少女',
  'Big Breasts': '巨乳', 'Big Pennis': '大屌', 'Big Tits': '巨乳', 'Black': '黑人',
  'BL': '耽美', 'Blow': '口交', 'Bodysuit': '紧身衣', 'Bukkake': '潮吹颜射',
  'Costume': '角色扮演', 'Creampie': '中出', 'Cuckold': '不贞', 'Dildo': '按摩棒',
  'DocPro': '医生', 'Documentary': '纪录片', 'Drink': '饮尿', 'Dream': '梦幻',
  'Embarrassment': '羞辱', 'Exclusive Distribution': '独家', 'Fetish': '恋物',
  'Fingering': '指交', 'Foot Job': '足交', 'Ganimen': '假阳具', 'Glasses': '眼镜',
  'Golden Shower': '饮尿', 'Hand Job': '手交', 'Hi-Def': '高清', 'Huge Butt': '巨臀',
  'Idol': '偶像', 'Incest': '乱伦', 'JAV': '国产', 'Lady': '人妻',
  'Lesbian': '女同', 'Lotion': '润滑剂', 'Married Woman': '人妻', 'Masturbation': '自慰',
  'Mature': '熟女', 'Miscellaneous': '其他', 'Nampa': '逆搭讪', 'Naughty': '恶作剧',
  'Nurse': '护士', 'OL': '女职员', 'Onanie': '自慰', 'Orgy': '乱交', 'Other': '其他',
  'Outdoor': '户外', 'Pantyhose': '丝袜', 'Pervert': '变态', 'Piss Drinking': '饮尿',
  'School': '校园', 'Series': '系列', 'Slender': '苗条', 'Small Breasts': '贫乳',
  'Sm': '调教', 'Soap': '泡泡浴', 'Sweat': '汗液', 'Swim': '泳装', 'Threesome': '3P',
  'Titty Fuck': '乳交', 'Tokudai': '特大', 'Training': '调教', 'Variety': '综合',
  'Virgin': '处女', 'Wife': '人妻', 'Yariman': '荡妇', 'Bishojo': '美少女',
  'Featured': '精选', 'Best': '精选', 'Compilation': '合集', 'Solo': '单人',
  'Couple': '情侣', 'Fetishism': '恋物', 'Girl': '少女', 'Hard': '凌辱',
  'Humiliation': '羞辱', 'Interracial': '跨种族', 'Maid': '女仆', 'Nurse': '护士'
};
function mapGenreEnToZh(en){
  if (!en) return en;
  if (GENRE_EN2ZH[en]) return GENRE_EN2ZH[en];
  var lower = String(en).toLowerCase();
  for (var k in GENRE_EN2ZH){ if (k.toLowerCase() === lower) return GENRE_EN2ZH[k]; }
  return en; // 未命中保留英文
}
var ACTRESS_LIST = [
  ['Yua Mikami', '三上悠亜'], ['Arina Hashimoto', '橋本有菜'], ['Miku Abeno', '阿部乃みく'],
  ['Eimi Fukada', '深田えいみ'], ['Yui Hatano', '波多野結衣'], ['Maria Ozawa', '小澤マリア'],
  ['Sora Aoi', '蒼井そら'], ['Akiho Yoshizawa', '吉沢明歩'], ['Rio', '柚木ティナ'],
  ['Jessica Kizaki', '希崎ジェシカ'], ['Yu Shinoda', '篠田ゆう'], ['Minori Hatsune', '初音みのり'],
  ['Anri Okita', '沖田杏梨'], ['Rin Aoki', '青木りん'], ['Nao Oikawa', '及川奈央'],
  ['Hitomi Tanaka', '田中ヒトミ'], ['Bunko Kanazawa', '金沢文子'], ['Risa Kasumi', '霞リカ'],
  ['Tsukasa Aoi', '葵つかさ'], ['JULIA', 'じゅりあ'], ['Aika', '愛珂'], ['Rion', 'りおん'],
  ['Mana Sakura', '桜まな'], ['Chihiro Hara', '原ちひろ'], ['Nao Jinguji', '神宮寺ナオ'],
  ['Minami Kojima', '小島みなみ'], ['Hibiki Otsuki', '大槻ひびき'], ['Aoi Tsukino', '月野あおい'],
  ['Mei Washio', '鷲尾めい'], ['Nanami Matsumoto', '松本菜奈実'], ['Shiori Tsukada', '塚田詩織'],
  ['Nene Tanaka', '田中ねね'], ['Hana Himesaki', '姫咲はな'], ['Moe Amatsuka', '天使もえ'],
  ['Rara Yoshikawa', '吉川らら'], ['Sakura Kirishima', '霧島さくら'], ['Shoko Takahashi', '高橋しょう子'],
  ['Aimi Yoshikawa', '吉川あいみ'], ['Riona Hirose', '広瀬りおな'], ['Airi Kijima', '木島愛里'],
  ['Maria Nagai', '永井マリア'], ['Aino Kori', '越智ありな'], ['Honoka', 'ほのか'],
  ['Ruka Kanae', '香苗るか'], ['Yuma Asami', '麻美ゆま'], ['Rola Takizawa', '竹田ろら'],
  ['Akari Hoshino', '星野明'], ['Asahi Mizuno', '水野朝陽'], ['Ena Satsuki', '紗月えな'],
  ['Yui Obata', '小幡ゆい'], ['Yume Nishimiya', '西山ゆめ'], ['Shizuku Hoshino', '星乃せあら'],
  ['Ai Uehara', '上原亜衣'], ['Saki Hatsumi', '初美沙希'], ['Mao Hamasaki', '浜崎真緒'],
  ['Maki Tomoda', '友田真希'], ['Risa Onodera', '小野瀬りさ'], ['Ayumi Shinoda', '篠田あゆみ'],
  ['Tsubasa Hachimitsu', 'ハチミツ翼'], ['Kaho Imai', '今井かほい'], ['Shion Utsunomiya', '宇都宮しをん'],
  ['Natsuki Iori', '伊織なつき'], ['Kaede Hondo', '楓ふうあ'], ['Rei Mizuna', '水菜麗'],
  ['AIKA', '愛花'], ['Miki', '美希'], ['Mirai', 'みらい'], ['Choco', 'ちょこ'], ['Mako', 'まこ'],
  ['Yuri Oshikawa', '押川ゆり'], ['Riko Honda', '本田りこ'], ['Kurea Hasumi', '蓮実クレア'],
  ['Yui Nishikawa', '西川ゆい'], ['Hotaru Akane', '紅音ほたる'], ['Yua Aida', '愛田ゆあ'],
  ['Ayane Asakura', '朝倉あやね'], ['Ruka', 'るか'], ['Marin', 'まりん'], ['Sana', 'さな'],
  ['Hime', 'ひめ'], ['Nami', 'なみ'], ['Rena', 'れな'], ['Hina', 'ひな'], ['Yuki', 'ゆき'],
  ['Nanami', 'ななみ'], ['Ria', 'りあ'], ['Erika', 'えりか'], ['Ayaka', 'あやか'],
  ['Saki Kozina', '小篠恵奈'], ['Aoi', 'あおい'], ['Yui', 'ゆい'], ['Miku', 'みく'],
  ['Hibiki', 'ひびき'], ['Sakura', 'さくら'], ['Mei', 'めい'], ['Rara', 'らら'], ['Moe', 'もえ'],
  ['Nene', 'ねね'], ['Hana', 'はな'], ['Saki', 'さき'], ['Yuma', 'ゆま'], ['Nao', 'なお'],
  ['Yua', 'ゆあ']
];
var ACTRESS_EN2ZH = {};
ACTRESS_LIST.forEach(function(p){
  var parts = String(p[0]).toLowerCase().split(/\s+/).filter(Boolean);
  ACTRESS_EN2ZH[parts.join(' ')] = p[1];
  if (parts.length === 2) ACTRESS_EN2ZH[parts[1] + ' ' + parts[0]] = p[1]; // 反序索引，兼容「姓 名」
});
function mapActressEnToZh(en){
  if (!en) return '';
  var key = String(en).toLowerCase().replace(/\s+/g, ' ').trim();
  return ACTRESS_EN2ZH[key] || en; // 未命中原样返回英文
}

/* ===== v444：AV 搜索的「区」顺序（有码 / 无码）=====
   背景：搜索框不再让用户预先选有码/无码。v443 曾按输入猜起始区（番号→有码、片名/女优名→无码），
   v444 按用户要求简化：**无论输入什么一律先搜有码区**，有码 0 结果再搜无码区，都空才兜底 / 未找到。
   有码区片量大，先试它命中率最高，也避免猜错区白烧一次配额。 */
function javZoneOrder(){
  return ['masked', 'uncensored'];
}

/* 图片代理：DMM 图床（pics.dmm.co.jp）经 Worker /img 代理绕跨域；workerBase 为空则直连 */
function javCoverUrl(raw, workerBase){
  if (raw && workerBase && raw.indexOf('pics.dmm.co.jp') > -1){
    return workerBase.replace(/\/+$/, '') + '/img?url=' + encodeURIComponent(raw);
  }
  return raw;
}
/* 通用图片代理（JavBus 图床 / 剧照）：dataURL 或空直返，否则走 /img */
function proxyImgUrl(raw, workerBase){
  if (!raw) return raw;
  if (raw.indexOf('data:') === 0) return raw;
  if (!workerBase) return raw;
  return workerBase.replace(/\/+$/, '') + '/img?url=' + encodeURIComponent(raw);
}
/* 归一化 r18.dev 详情 → 标准字段对象（纯逻辑，不碰 DOM/state）。
 * opts.workerBase：图片代理 Worker 地址；封面/女优头像/剧照经其代理。
 * 返回全量 actors（显示上限由 UI 控制 slice），galleryLinks 为去重后的代理 URL 全量列表。 */
function normalizeJavFilm(d, opts){
  opts = opts || {}; d = d || {};
  var w = opts.workerBase || '';
  var title = javStr(d.title_ja || d.title_en || d.title || d.name) || '';
  var dvdId = javStr(d._dvdId || d.dvd_id || d.dvdId || d.content_id || d.id) || '';
  var date = javStr(d.release_date || d.releaseDate || d.date) || '';
  var year = (date || '').slice(0, 4);
  var runtime = javStr(d.runtime_mins || d.runtime_minutes || d.runtime || d.length) || '';
  var overview = javStr(d.plot || d.plot_ja || d.comment_ja || d.comment_en || d.comment || d.overview) || '';
  var rating = '';
  var countries = ['日本'];
  var genres = (d.categories || []).map(function(c){ return javStr(c && (c.name_en || c.en || c.name_ja || c.ja || c.name)); }).filter(Boolean).map(mapGenreEnToZh);
  var actors = (d.actresses || []).map(function(a){
    var n = mapActressEnToZh(javStr(a)) || javStr(a);
    var photo = (a && a.image_url) ? javCoverUrl(a.image_url, w) : null;
    return { name: n, role: '', photo: photo };
  });
  var dirSrc = d.directors;
  if (!dirSrc && d.director) dirSrc = (typeof d.director === 'string') ? [d.director] : (Array.isArray(d.director) ? d.director : [d.director]);
  var directors = (dirSrc || []).map(function(a){ return javStr(a); }).filter(Boolean).map(function(n){ return { name: n, role: '', photo: null }; });
  var studio = javName(d.maker_name_ja || d.maker_name_en || d.maker || d.studio);
  var label = javName(d.label_name_ja || d.label_name_en || d.label || d.publisher || d.distributor);
  var series = javName(d.series_name_ja || d.series_name_en || d.series || d.seriesName);
  var trailer = javStr(d.sample_url || (d.sample && d.sample.high) || (typeof d.sample === 'string' ? d.sample : '') || d.trailer) || '';
  var coverRaw = javStr(d.jacket_full_url || d.jacket_thumb_url);
  if (!coverRaw && d.images && d.images.jacket_image) coverRaw = d.images.jacket_image.large2 || d.images.jacket_image.large || '';
  var cover = javCoverUrl(coverRaw, w);
  var galleryLinks = [];
  if (cover) galleryLinks.push(cover);
  (d.gallery || []).map(function(g){
    if (typeof g === 'string') return javCoverUrl(g, w);
    return g && (g.image_full || g.image) ? javCoverUrl(g.image_full || g.image, w) : '';
  }).filter(Boolean).forEach(function(url){ if (galleryLinks.indexOf(url) < 0) galleryLinks.push(url); });
  return { title: title, dvdId: dvdId, date: date, year: year, runtime: runtime, overview: overview,
    rating: rating, countries: countries, genres: genres, actors: actors, directors: directors,
    studio: studio, label: label, series: series, trailer: trailer, cover: cover, galleryLinks: galleryLinks };
}
/* 归一化 JavBus 详情 → 标准字段对象（纯逻辑）。
 * 女优头像保留原始 s.photo（代理由 UI loadJavbusActorPhoto 处理）；封面/剧照经 proxyImgUrl 代理。 */
function normalizeJavbusFilm(d, opts){
  opts = opts || {}; d = d || {};
  var w = opts.workerBase || '';
  var title = (d.title || d.id || '').trim();
  var dvdId = (d.id || '').trim();
  var date = (d.date || '').trim();
  var year = (date || '').slice(0, 4);
  var runtime = (d.videoLength ? String(d.videoLength) : '') || '';
  var overview = d.plot || '';
  var rating = (d.rating != null && d.rating !== '') ? String(d.rating) : '';
  var countries = ['日本'];
  var genres = (d.genres || []).map(function(g){ return (g && g.name) || ''; }).filter(Boolean);
  var actors = (d.stars || []).map(function(s){ return { name: (s && s.name) || '', role: '', photo: (s && s.photo) || null }; });
  var directors = (d.director && d.director.name) ? [{ name: d.director.name, role: '', photo: null }] : [];
  var studio = (d.producer && d.producer.name) || '';
  var label = (d.publisher && d.publisher.name) || '';
  var series = (d.series && d.series.name) || '';
  var cover = proxyImgUrl(d.img || '', w);
  var galleryLinks = [];
  if (cover) galleryLinks.push(cover);
  (d.samples || []).map(function(s){ return s && (s.src || s.thumbnail); }).filter(Boolean).map(function(u){ return proxyImgUrl(u, w); })
    .forEach(function(url){ if (url && galleryLinks.indexOf(url) < 0) galleryLinks.push(url); });
  return { title: title, dvdId: dvdId, date: date, year: year, runtime: runtime, overview: overview,
    rating: rating, countries: countries, genres: genres, actors: actors, directors: directors,
    studio: studio, label: label, series: series, cover: cover, galleryLinks: galleryLinks };
}

  // ===== TMDB 解析（纯逻辑，不碰 DOM/state）=====
  // 图片基址：image.tmdb.org 自带 Access-Control-Allow-Origin:*，浏览器可直连 fetch+blob+canvas 转 dataURL 存 IndexedDB，无需 Worker 代理
  var TMDB_IMG_BASE = 'https://image.tmdb.org/t/p';
  // 拼 TMDB 图片地址（纯函数；size 如 w780/w1280/w500/w154）
  function tmdbImgUrl(path, size){
    return TMDB_IMG_BASE + '/' + size + (path || '');
  }
  // ISO 3166-1 → 中文国名（两端逐字一致，合并为单点真相）
  var CC_MAP = {
    US:'美国', GB:'英国', CN:'中国大陆', HK:'香港', TW:'台湾', JP:'日本', KR:'韩国',
    FR:'法国', DE:'德国', IN:'印度', TH:'泰国', CA:'加拿大', AU:'澳大利亚',
    IT:'意大利', ES:'西班牙', RU:'俄罗斯', NZ:'新西兰', NL:'荷兰', SE:'瑞典',
    CH:'瑞士', BR:'巴西', MX:'墨西哥', DK:'丹麦', NO:'挪威', FI:'芬兰',
    BE:'比利时', AT:'奥地利', IE:'爱尔兰', PT:'葡萄牙', PL:'波兰', CZ:'捷克',
    HU:'匈牙利', GR:'希腊', TR:'土耳其', IL:'以色列', ZA:'南非',
    AR:'阿根廷', CL:'智利', CO:'哥伦比亚', PH:'菲律宾', SG:'新加坡', MY:'马来西亚',
    ID:'印度尼西亚', VN:'越南', EG:'埃及', AE:'阿联酋', SA:'沙特阿拉伯'
  };
  /* 华语片判定（v274）：原产语言 zh，或原产国家/地区落在 CN/HK/TW/SG */
  function tmdbIsChinese(d){
    d = d || {};
    if (d.original_language === 'zh') return true;
    var oc = d.origin_country || [];
    for (var i = 0; i < oc.length; i++){
      if (oc[i] === 'CN' || oc[i] === 'HK' || oc[i] === 'TW' || oc[i] === 'SG') return true;
    }
    return false;
  }
  /* 从 alternative_titles 里挑英文标题（v274）：美/英/澳/新优先级，movie 用 titles、tv 用 results */
  function tmdbEnTitle(d){
    var at = (d && d.alternative_titles) || {};
    var titles = at.titles || at.results || [];
    var ccs = ['US', 'GB', 'AU', 'NZ'];
    for (var i = 0; i < ccs.length; i++){
      for (var j = 0; j < titles.length; j++){
        var t = titles[j];
        if (t && t.iso_3166_1 === ccs[i] && t.title && t.title.trim()) return t.title.trim();
      }
    }
    return '';
  }
  /* 归一化 TMDB 详情（movie/tv）→ 标准字段对象（纯逻辑，不碰 DOM/state）。
   * opts.isTV：当前是否为剧集详情（决定 name/first_air_date/episode_run_time/created_by/content_ratings）；不读全局 state。
   * opts.actorLimit：演员显示上限（手机端 5 / PC 端 11，分叉保留，由 UI 经 opts 传入）。
   * 图片仅返回 TMDB 原始 file_path（posterPaths/backdropPaths/logoPath）与已拼好的 galleryLinks（w1280 直连 URL）；
   * 实际的 fetch→blob→dataURL 与 <img> DOM 由两端 UI 各自处理（不碰共享核心）。
   * 原始标题规则（v274）：华语片一律取英文标题——TMDB 的 original_title 对华语片就是中文，
   * 与标题重复无信息量；d.alternative_titles（由 UI 预先拉取挂上）有英文区标题时改用它，
   * 拉不到或非华语保持原行为（PC 端未挂 alternative_titles，行为不变）。 */
  function normalizeTmdbFilm(d, opts){
    opts = opts || {}; d = d || {};
    var isTV = !!opts.isTV;
    var actorLimit = opts.actorLimit || 5;
    var title = d.title || (isTV ? d.name : '') || d.original_title || (isTV ? d.original_name : '') || '';
    var orig = d.original_title || (isTV ? d.original_name : '') || d.title || (isTV ? d.name : '') || '';
    if (tmdbIsChinese(d)){
      var en = tmdbEnTitle(d);
      if (en) orig = en;
    }
    var date = d.release_date || d.first_air_date || '';
    var year = (date || '').slice(0, 4);
    var runtime = d.runtime || (d.episode_run_time && d.episode_run_time[0]) || '';
    var overview = d.overview || '';
    var rating = (typeof d.vote_average === 'number') ? d.vote_average.toFixed(1) : '';
    var countries = (d.production_countries && d.production_countries.length)
      ? d.production_countries.map(function(c){ return CC_MAP[c.iso_3166_1] || c.name; })
      : (d.origin_country || []).map(function(code){ return CC_MAP[code] || code; });
    var genres = (d.genres || []).map(function(g){ return g.name; });
    var cert = '';
    if (d.release_dates && d.release_dates.results){
      var us = (d.release_dates.results || []).find(function(r){ return r.iso_3166_1 === 'US'; });
      if (us){ var c = (us.release_dates || []).find(function(x){ return x.certification; }); cert = c ? c.certification : ''; }
    } else if (d.content_ratings && d.content_ratings.results){
      // 剧集（TV）无 release_dates，分级在 content_ratings 里
      var usTv = (d.content_ratings.results || []).find(function(r){ return r.iso_3166_1 === 'US'; });
      if (usTv) cert = usTv.rating || '';
    }
    var directors = [], actors = [];
    if (d.credits){
      var crew = d.credits.crew || [];
      var dir = crew.find(function(p){ return p.job === 'Director'; });
      // 剧集（TV）多数无 crew.Director，用 created_by（主创/编剧）兜底
      if (!dir && d.created_by && d.created_by.length) dir = { name: d.created_by[0].name, profile_path: d.created_by[0].profile_path };
      if (dir) directors = [{ name: dir.name || '', dept: '导演', role: '', photo: null, _profile: dir.profile_path || null }];
      actors = (d.credits.cast || []).slice(0, actorLimit).map(function(p){ return { name: p.name || '', role: p.character || '', photo: null, _profile: p.profile_path || null }; });
    }
    var posters = (d.images && d.images.posters) || [];
    var posterPaths = posters.length ? posters.map(function(p){ return p.file_path; }) : (d.poster_path ? [d.poster_path] : []);
    var backdrops = (d.images && d.images.backdrops) || [];
    var backdropPaths = backdrops.map(function(b){ return b.file_path; });
    var galleryLinks = backdrops.map(function(b){ return tmdbImgUrl(b.file_path, 'w1280'); });
    var logoPath = '';
    if (d.images && d.images.logos && d.images.logos.length){
      var logos = d.images.logos;
      var zh = logos.find(function(l){ return l.iso_639_1 === 'zh'; });
      var en = logos.find(function(l){ return l.iso_639_1 === 'en'; });
      var pick = (zh || en || logos[0]);
      logoPath = pick ? pick.file_path : '';
    }
    var trailerKey = '';
    if (d.videos && d.videos.results && d.videos.results.length){
      var yt = d.videos.results.filter(function(v){ return v.site === 'YouTube' && v.key; });
      var officialTrailer = yt.find(function(v){ return v.type === 'Trailer' && v.official; });
      var tr = officialTrailer || yt.find(function(v){ return v.type === 'Trailer'; }) || yt[0];
      if (tr) trailerKey = tr.key;
    }
    return {
      adult: !!d.adult,
      isTV: isTV,
      title: title, originaltitle: orig, date: date, year: year, runtime: runtime,
      overview: overview, rating: rating, countries: countries, genres: genres, cert: cert,
      directors: directors, actors: actors,
      posterPaths: posterPaths, backdropPaths: backdropPaths, galleryLinks: galleryLinks,
      logoPath: logoPath, trailerKey: trailerKey,
      tmdbId: (d.id != null ? d.id : null)
    };
  }

  /* ============ model：影片数据模型纯逻辑（单点真相） ============ */
  // 影片类型标记（持久化对象 __type）
  var FILM_TYPE = 'film';

  // 成人归属（旧）：原本完全由分级决定——nc-17 或 nr（含 JAV 默认 NR）即归 18+（XV）。
  // 2026-09-08 起统一改为「是否有番号（dvdId）」决定，此函数保留仅供历史参考/其他端复用。
  function isAdultByRating(mpaa){
    return /^(nc-17|nr)$/i.test((mpaa || '').trim());
  }

  // 影片 / AV 的唯一区分标准：是否含有番号（dvdId）。
  // 2026-09-08 统一规则：不再看分级、不再看 TMDB 的 adult 标志、不再看来源（jav/tmdb）。
  // 单点真相，两端显示与存储都走它。
  function isAvFilm(f){
    var d = (f && f.data) || {};
    return !!(d.dvdId);
  }

  // 持久化键约定：IndexedDB kv 存储的 film 键（两端统一，避免 key 漂移）
  function filmKey(id){
    return FILM_TYPE + ':' + (id || '');
  }

  // 创建空影片骨架（newFilm 的基础）。adult 由调用方按来源/分级显式传入，不在此推断。
  function createEmptyFilm(opts){
    opts = opts || {};
    return { id: '', adult: !!opts.adult, data: {} };
  }

  /* ============ 当前影片 ↔ 记录 互转（单点真相） ============ */
  // 从当前编辑态构建影片对象：两端此前逐字一致的重复实现合并为单点真相。
  // 仍依赖各端顶层全局：getVal / state / currentFilmLocked / normalizeTextField（两端均声明为顶层全局，调用时按当前加载的端解析）。
  function buildFilmFromCurrent(){
    var id = sanitizeName(getVal('filename') || getVal('title') || ('film-' + Date.now()));
    // 成人归属统一由「是否有番号（dvdId）」决定（2026-09-08 起），不再依赖分级/来源/TMDB 标志
    var adult = !!(state.dvdId);
    // 来源：优先沿用当前编辑态（刷新时由对应 populate 重新赋值），否则按搜索源推导，自定义兜底
    var src = state.source || (state.metaSource === 'jav' ? 'jav' : 'tmdb');
    return {
      __type: FILM_TYPE, id: id, adult: adult,
      source: src,
      title: getVal('title'),
      rating: getVal('rating'),
      locked: currentFilmLocked,
      posterDataUrl: state.poster || null,
      data: {
        title: getVal('title'), filename: getVal('filename'), originaltitle: getVal('originaltitle'),
        adult: adult,
        premiered: getVal('premiered'), year: getVal('year'), runtime: getVal('runtime'),
        plot: getVal('plot'), rating: getVal('rating'), mpaa: getVal('mpaa'),
        countries: state.countries.slice(), genres: state.genres.slice(),
        directors: state.directors, actors: state.actors,
        studio: normalizeTextField(state.studio), label: normalizeTextField(state.label), series: normalizeTextField(state.series), dvdId: state.dvdId || null,
        javCensor: state.javCensor || '',   /* v508：记录 JavBus 有码/无码区，供 AV 评论判断是否跳过无码；老片无此字段 */
        poster: state.poster || null, originalPoster: state.originalPoster || null, fanart: state.fanart || null, logo: state.logo || null, detailPoster: state.detailPoster || null,
        posterCandidates: state.posterCandidates || null, fanartCandidates: state.fanartCandidates || null,
        gallery: state.gallery || [], galleryLinks: state.galleryLinks || [], hasSubtitle: !!state.hasSubtitle, trailer: state.trailer || null, tmdbId: state.tmdbId || null,
        collectionId: state.collectionId || null,   /* v348：TMDB 合集 ID（belongs_to_collection.id），合集反查开关 */
        tmdbMediaType: state.tmdbMediaType || 'movie',
        javbusId: state.javbusId || null,
        javbusMagnets: (state.javbusMagnets || []).slice()
      },
      updatedAt: Date.now()
    };
  }

  /* ============ img：图片 URL 加载纯逻辑（单点真相） ============ */
  // 图片加载核心：fetch → blob → FileReader → dataURL。不碰 DOM / 不读 state，
  // 两端 loadImageFromURL 胶水层在拿到 dataURL 后再做 state 赋值 / 裁剪 / 渲染。
  function fetchImageToDataURL(url){
    return fetch(url, { mode: 'cors', cache: 'force-cache' }).then(function(r){ if (!r.ok) throw new Error('img'); return r.blob(); })
      .then(function(blob){
        return new Promise(function(resolve, reject){
          var reader = new FileReader();
          reader.onload = function(evt){ resolve(evt.target.result); };
          reader.onerror = function(){ reject(new Error('read')); };
          reader.readAsDataURL(blob);
        });
      });
  }

  // ===== 图片显示 / 加载胶水（两端逐字一致的重复实现合并为单点真相）=====
  // 注：以下函数仍引用各端的顶层全局（state / renderOverview / cropRightHalfAuto 等），
  // 两端均将其声明为顶层全局，调用时按当前加载的端解析，不存在分叉。
  function stillDisplayUrl(url){
    if (!url || url.indexOf('data:') === 0) return url;
    var isAv = currentDetailFilm && (currentDetailFilm.adult || (currentDetailFilm.data && currentDetailFilm.data.adult));
    if (!isAv) return url;
    if (!state.magnetWorker) return url;
    if (url.indexOf('/img?url=') > -1 || (state.magnetWorker && url.indexOf(state.magnetWorker) > -1)) return url;
    return state.magnetWorker.replace(/\/$/, '') + '/img?url=' + encodeURIComponent(url);
  }
  // 首页海报「翻译中」图标（translatingIds）的 60s 兜底：翻译 Promise 可能因网络挂起而既不 resolve 也不 reject，
  // 导致 finishTranslation 永不调用、图标永久卡住。每标记一次翻译就起一个按 id 的安全计时器，
  // 到点无论翻译是否完成都强制从 translatingIds 移除并刷新首页；翻译正常结束时由 clearTranslatingFallback 清掉计时器。
  var _translatingFallbackTimers = {};
  function armTranslatingFallback(id){
    if (!id) return;
    if (_translatingFallbackTimers[id]) clearTimeout(_translatingFallbackTimers[id]);
    _translatingFallbackTimers[id] = setTimeout(function(){
      delete _translatingFallbackTimers[id];
      if (state.translatingIds.has(id)){
        state.translatingIds.delete(id);
        state.translatingInFlight.delete(id);
        state.translateFailedIds.add(id);
        if (typeof updateTranslateRetryBtn === 'function') updateTranslateRetryBtn();
        renderOverview();
      }
    }, 60000);
  }
  function clearTranslatingFallback(id){
    if (!id) return;
    if (_translatingFallbackTimers[id]){ clearTimeout(_translatingFallbackTimers[id]); delete _translatingFallbackTimers[id]; }
  }
  function markPendingTranslate(id){
    if (state.metaSource === 'tmdb') return; // TMDB 来源影片保存时不自动触发翻译
    // 自填 key 或高级档（服务端翻译）才自动触发；免费/中级无 key 则不自动翻
    if (!translateConfigReady() && (state.tier || '') !== 'full') return;
    state.translatingIds.add(id);
    armTranslatingFallback(id);   // 起 60s 兜底：最多 60 秒后图标强制消失
    renderOverview();
    state.pendingTranslateIds.add(id);
    setTimeout(function(){ flushPendingTranslate(id); }, 6000);
  }
  function loadImageFromURL(url, type, ratio, cropMode){
    ratio = ratio || 0;
    var cropFn;
    if (cropMode === 'right') cropFn = cropRightHalfAuto;   // 横图右切去标题；竖图取整张
    else if (cropMode === 'full') cropFn = function(durl){ return Promise.resolve(durl); };  // 不裁剪，保留原图
    else cropFn = function(durl){ return cropToRatio(durl, ratio); };
    return fetchImageToDataURL(url).then(function(durl){
      cropOriginals[type] = durl;
      // AV 海报走 'right' 裁剪（首页用裁剪版、详情页用原始版）：保留未裁剪的原始海报
      if (type === 'poster' && cropMode === 'right') state.originalPoster = durl;
      return cropFn(durl).then(function(cropped){
        state[type] = cropped;
        renderMediaThumb(type, cropped);
      });
    }).catch(function(){ /* 图片拉取失败不阻塞导入 */ });
  }

  // ===== TMDB / 翻译 代理请求（纯逻辑，自填 key 优先，无则走服务端代理）=====
  // 「一个激活码搞定」混合模型：
  // - 用户自填 TMDB Key → 直连 api.themoviedb.org（不占服务端配额、不限流）
  // - 未填 → 走 Worker /tmdb 代理（服务端持有 key，按档位全局共享配额）
  // path 形如 '/search/movie' 或 '/movie/123'；params 为查询参数对象（不含 api_key）；
  // opts = { ownKey, workerBase, code }；返回 Promise<解析后的 JSON>
  function tmdbRequest(path, params, opts) {
    opts = opts || {};
    var ownKey = (opts.ownKey || '').trim();
    var timeout = (typeof opts.timeout === 'number') ? opts.timeout : 15000;
    function withTimeout(p) {
      if (!timeout) return p;
      return new Promise(function (resolve, reject) {
        var tid = setTimeout(function () { reject(new Error('TMDB 请求超时')); }, timeout);
        p.then(function (v) { clearTimeout(tid); resolve(v); }, function (e) { clearTimeout(tid); reject(e); });
      });
    }
    if (ownKey) {
      var u = new URL(TMDB_API_BASE + path);
      Object.keys(params || {}).forEach(function (k) { if (params[k] != null) u.searchParams.set(k, params[k]); });
      u.searchParams.set('api_key', ownKey);
      return withTimeout(fetch(u.toString(), { headers: { 'Accept': 'application/json' } })
        .then(function (r) { if (!r.ok) throw new Error('TMDB ' + r.status); return r.json(); }));
    }
    var base = (opts.workerBase || '').replace(/\/+$/, '');
    if (!base) return Promise.reject(new Error('未配置 TMDB：请填写 TMDB Key 或 Worker 地址'));
    var wu = new URL(base + '/tmdb' + path);
    Object.keys(params || {}).forEach(function (k) { if (params[k] != null) wu.searchParams.set(k, params[k]); });
    var code = (opts.code || '').trim();
    if (code) wu.searchParams.set('code', code);
    /* v424：qid = 一次用户动作（一次点击）的批次号。
       智能搜索在一次点击里可能并发 movie / tv / person 三个请求，额度必须按「点击次数」算而不是请求数：
       同一个 qid 只记第一次；qid 同时透传给服务端（checkQuota 幂等），保证 /quota 回填的数字也一致。
       v490：调用方没显式给 qid 时，自动挂上「当前动作」的 qid（见 beginTmdbAction）。
       保存一部片其实要发好几个请求（详情 / 英文兜底 / 中文片的别名 / 分级 …），
       以前每个都单独扣一次「TMDB保存」，点一次保存就能把当天额度打空。 */
    var qid = (opts.qid || _actionQid || '').trim();
    if (qid) wu.searchParams.set('qid', qid);
    // 配额计数：仅服务端代理路径消耗共享配额（自填 key 直连不计数）。
    // v500 行为计费：只有「搜索」在这里计 tmdbSearch（按点击 qid 去重，一次点击=1次）；
    // 详情 / 预告 / 图片 / 人物 / 合集 等读取类请求一律免费，不再计 tmdbSave——
    // 保存额度改由客户端在「点击卡片保存到首页」时经 /quota/consume 单独核减（见 ui-ios.js quickSaveAndHome）。
    if (path.indexOf('/search') >= 0) {
      if (!qid) quotaInc('tmdbSearch');
      else if (_searchQidSeen.indexOf(qid) < 0) {
        quotaInc('tmdbSearch');
        _searchQidSeen.push(qid);
        if (_searchQidSeen.length > 20) _searchQidSeen.shift();   // 只留最近 20 个批次，防无限增长
      }
    }
    return withTimeout(fetch(wu.toString(), { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json().then(function (d) { if (d && d.error) throw new Error(d.error); return d; }); }));
  }

  // AI 翻译：自填配置优先（直连，复用 translateMeta）；无则走服务端代理（仅高级档）
  // title/plot 为待翻译文本；opts = { ownCfg:{baseUrl,apiKey,model}, workerBase, code }
  // 返回 Promise<{title, summary}>（两条路径均经 stripTitleParens + cleanTranslatedText 清洗，结果一致）
  function translateRequest(title, plot, opts) {
    opts = opts || {};
    var own = opts.ownCfg || {};
    if (own.baseUrl && own.apiKey && own.model) {
      return translateMeta(title, plot, own);
    }
    var base = (opts.workerBase || '').replace(/\/+$/, '');
    if (!base) return Promise.reject(new Error('未配置翻译：请填写翻译配置或升级高级档'));
    var url = base + '/translate' + ((opts.code ? ('?code=' + encodeURIComponent(opts.code)) : ''));
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title || '', plot: plot || '', prompt: AI_PROMPTS.translate })
    }).then(function (r) { return r.json().then(function (d) { if (d && d.error) throw new Error(d.error); return d; }); })
      .then(function (d) {
        var res = { title: (d && d.title) || '', summary: (d && d.summary) || '' };
        if (res.title) res.title = stripTitleParens(cleanTranslatedText(res.title));
        if (res.summary) res.summary = cleanTranslatedText(res.summary);
        return res;
      });
  }

  // ===== 本地按天配额计数（仅展示用，权威以服务端为准）=====
  // 字段：tmdbSearch / tmdbSave / javSearch / javSave / tidy115；档位 free=15、medium=30、full=不限
  var QUOTA_FIELDS = ['tmdbSearch', 'tmdbSave', 'javSearch', 'javSave', 'tidy115'];
  var QUOTA_LABELS = { tmdbSearch: 'TMDB搜索', tmdbSave: 'TMDB保存', javSearch: 'JAV搜索', javSave: 'JAV保存', tidy115: '文件整理' };
  var QUOTA_LIMITS = {
    free:   { tmdbSearch: 15, tmdbSave: 15, javSearch: 15, javSave: 15, tidy115: 15 },
    medium: { tmdbSearch: 30, tmdbSave: 30, javSearch: 30, javSave: 30, tidy115: 30 },
    full:   {}
  };
  var quotaSaveSeen = {}; // 按天去重，避免详情语言兜底下 tmdbSave 重复计数
  var _searchQidSeen = []; // v424：一次点击内的多个 /search 子请求共用一个 qid，只计一次额度
  var _saveQidSeen = [];   // v490：一次保存内的多个请求共用一个 qid，只计一次额度
  /* v490：「当前用户动作」的批次号。保存一部片会连着发好几个 TMDB 请求
     （详情、英文兜底、中文片别名、分级…），它们必须算成一次点击。
     做法：在每个动作的入口调一次 beginTmdbAction()，之后这个动作里所有没显式带 qid 的
     请求都自动挂上它 —— 不用去改几十处调用点。 */
  var _actionQid = '';
  var _actionAt = 0;
  /* force=true 强制开新批次；默认 2 秒内复用当前批次 ——
     保存完紧接着自动打开详情页（也是我们代码触发的）属于同一次点击，不该再扣一次。 */
  function beginTmdbAction(force){
    var now = Date.now();
    if (!force && _actionQid && (now - _actionAt) < 2000) return _actionQid;
    _actionAt = now;
    _actionQid = 'a' + now.toString(36) + Math.random().toString(36).slice(2, 7);
    return _actionQid;
  }
  function quotaDayKey(){ var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function quotaStoreKey(){ return 'nfo_quota_' + quotaDayKey(); }
  function quotaLoad(){ try { return JSON.parse(localStorage.getItem(quotaStoreKey()) || '{}'); } catch (e) { return {}; } }
  function quotaSave(o){ try { localStorage.setItem(quotaStoreKey(), JSON.stringify(o)); } catch (e) {} }
  function quotaInc(field){
    var o = quotaLoad(); o[field] = (o[field] || 0) + 1; quotaSave(o);
    if (typeof window !== 'undefined' && window.dispatchEvent) { try { window.dispatchEvent(new Event('nfo:quota-changed')); } catch (e) {} }
    return o[field];
  }
  function quotaGet(field){ return quotaLoad()[field] || 0; }
  function quotaLimit(tier, field){ return (QUOTA_LIMITS[tier] && QUOTA_LIMITS[tier][field]) || 0; }
  function quotaData(tier){
    var t = tier || 'free'; var out = [];
    QUOTA_FIELDS.forEach(function (f) {
      var lim = quotaLimit(t, f); if (!lim) return;
      var used = quotaGet(f);
      out.push({ field: f, label: QUOTA_LABELS[f], used: used, limit: lim, remaining: Math.max(0, lim - used) });
    });
    return out;
  }

  // ===== v424 智能搜索：判定「这次搜到的是电影还是剧集」=====
  /* 归一化片名：小写 + 去掉字母数字汉字以外的字符，让「教父 The Godfather」和「教父」可比 */
  function tmdbNormTitle(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
  }
  /* 单条结果的匹配强度：2 = 强匹配（标题/原名与查询全等）、1 = 弱匹配（互相包含）、0 = 不相关 */
  function tmdbMatchLevel(item, qNorm) {
    if (!item || !qNorm) return 0;
    var names = [item.title, item.name, item.original_title, item.original_name];
    var best = 0;
    for (var i = 0; i < names.length; i++) {
      var n = tmdbNormTitle(names[i]);
      if (!n) continue;
      if (n === qNorm) return 2;
      if (best < 1 && (n.indexOf(qNorm) === 0 || qNorm.indexOf(n) === 0)) best = 1;
    }
    return best;
  }
  /* 电影 / 剧集两批结果 → 这次应该显示哪一类。
     primary = 'movie' | 'tv' | ''（两类都空，交给调用方去搜人物）。
     判定顺序：强匹配条数多者胜 → 只有一类有强匹配就选它 → 都没强匹配时按结果条数兜底
     （一边有结果另一边空，直接选有结果的那边；两边都有就选条数多的）。 */
  function classifyTmdbResults(movies, tvs, q) {
    movies = movies || []; tvs = tvs || [];
    var qNorm = tmdbNormTitle(q);
    var mStrong = 0, tStrong = 0, i;
    for (i = 0; i < movies.length; i++) if (tmdbMatchLevel(movies[i], qNorm) >= 2) mStrong++;
    for (i = 0; i < tvs.length; i++) if (tmdbMatchLevel(tvs[i], qNorm) >= 2) tStrong++;
    var primary = '';
    if (mStrong || tStrong) primary = (tStrong > mStrong) ? 'tv' : 'movie';
    else if (movies.length && !tvs.length) primary = 'movie';
    else if (tvs.length && !movies.length) primary = 'tv';
    else if (movies.length && tvs.length) primary = (tvs.length > movies.length * 1.5) ? 'tv' : 'movie';
    return { primary: primary, movieStrong: mStrong, tvStrong: tStrong, movieCount: movies.length, tvCount: tvs.length };
  }

  // ===== v418 磁力搜索垃圾过滤（纯逻辑，三层方案）=====
  // 内置屏蔽词：垃圾广告/诈骗特征词（普通片名搜索时生效；番号搜索自动放宽跳过词库层）
  var MAGNET_SPAM_WORDS = [
    '破解', '注册码', '免费下载', '在线观看', '手机在线', '高清完整版', '全集网',
    '约炮', '援交', '楼凤', '外围', '上门服务', '一夜情', '妓院',
    '成人直播', '福利姬', '杏吧', '资源群', '扫码', '二维码', '彩票', '博彩'
  ];
  // 归一化：小写 + 去掉字母数字汉字以外的分隔符（点/空格/横杠等），标题「MIAB.500C」与查询「miab-500c」可比
  function magnetNormText(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
  }
  /* 第一层·相关性：查询按空格拆 token，标题须包含全部有效 token（归一化后 ≥2 字符的才算有效）。
     无有效 token（太短/空）不过滤。demote 而非删除——中文查英文资源等场景仍可往下滚看到。 */
  function magnetRelevant(title, q) {
    var nt = magnetNormText(title);
    var tokens = String(q || '').split(/\s+/).map(magnetNormText).filter(function (t) { return t.length >= 2; });
    if (!tokens.length || !nt) return true;
    for (var i = 0; i < tokens.length; i++) {
      if (nt.indexOf(tokens[i]) < 0) return false;
    }
    return true;
  }
  /* 第二层·屏蔽词：命中内置或自定义词（归一化包含）即视为垃圾 */
  function magnetSpam(title, words) {
    var nt = magnetNormText(title);
    if (!nt) return false;
    // 自定义词非空时以它为准（用户在设置页可增删内置词）；为空则用内置默认词
    var list = (words && words.length) ? words : MAGNET_SPAM_WORDS;
    for (var i = 0; i < list.length; i++) {
      var w = magnetNormText(list[i]);
      if (w && nt.indexOf(w) >= 0) return true;
    }
    return false;
  }
  /* 磁力结果行的「季集标签」：从发布标题里认出第几季第几集，只为界面看一眼就知道是哪一集，
     不参与命名、不参与过滤。认不出返回空串——宁可不显示，也不臆造。 */
  function cnSmallNum(s) {
    s = String(s || '').trim();
    if (/^\d+$/.test(s)) return +s;
    var d = { '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
    var m = s.match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/);
    if (m) return (m[1] ? d[m[1]] : 1) * 10 + (m[2] ? d[m[2]] : 0);
    if (s.length === 1 && d[s] !== undefined) return d[s];
    return 0;
  }
  function magnetEpLabel(title) {
    var raw = String(title || '');
    if (!raw || raw.length > 400) return '';
    var s = 0, ep = 0, m;
    // ① S02E08（含 S02.E08 / S02-E08 / S02 E08）
    m = raw.match(/\bs(\d{1,2})[.\-_\s]?e(\d{1,3})(?!\d)/i);
    if (m) { s = +m[1]; ep = +m[2]; }
    // ② 1x05（x 前是 1~2 位数字、x 后是集号；x264 这类编码不会命中）
    if (!ep) {
      m = raw.match(/(?:^|[^0-9a-z])(\d{1,2})\s?[x×]\s?(\d{1,3})(?!\d)/i);
      if (m && +m[1] > 0 && +m[1] <= 30) { s = +m[1]; ep = +m[2]; }
    }
    // 季号：Season 2 / 第2季 / 第二季 / 2季 / 单独 S02
    if (!s) {
      m = raw.match(/season\s*(\d{1,2})(?!\d)/i) || raw.match(/第\s*([零一二两三四五六七八九十\d]{1,3})\s*[季部]/);
      if (m) s = cnSmallNum(m[1]);
    }
    if (!s) {
      m = raw.match(/(?:^|[^0-9])(\d{1,2})\s*季/);   // 「2季」这种省略「第」的写法（剧集磁力常见）
      if (m && +m[1] > 0 && +m[1] <= 30) s = +m[1];
    }
    if (!s) {
      m = raw.match(/(?:^|[^a-z0-9])s(\d{1,2})(?![0-9a-z])/i);
      if (m && +m[1] > 0 && +m[1] <= 30) s = +m[1];
    }
    // 集号：第8集/话 / EP08、E08 / [08]、- 08 [1080p]、08v2 / 结尾 08
    if (!ep) {
      m = raw.match(/第\s*([零一二两三四五六七八九十百\d]{1,3})\s*[集话話]/);
      if (m) ep = cnSmallNum(m[1]);
    }
    // 「05集 / 12话」省略「第」的写法；「全10集 / 共10集」是总集数不是某一集，跳过
    if (!ep && !/(?:全|共)\s*\d{1,4}\s*[集话話]/.test(raw)) {
      m = raw.match(/(\d{1,4})\s*[集话話]/);
      if (m && +m[1] > 0 && +m[1] < 1900) ep = +m[1];
    }
    if (!ep) {
      m = raw.match(/episode\s*(\d{1,4})(?!\d)/i);
      if (m) ep = +m[1];
    }
    if (!ep) {
      m = raw.match(/(?:^|[^a-z0-9])(?:ep|e)\s?(\d{1,3})(?![0-9a-z])/i);
      if (m) ep = +m[1];
    }
    // 这几个数字不是集号：年份、分辨率（长番如海贼王 1085 集要能认，但 1080p/2160 不能）
    var badNum = function (n) {
      if (n <= 0) return true;
      if (n >= 1900 && n <= 2100) return true;
      return [480, 576, 720, 1080, 1440, 2160, 4320].indexOf(n) >= 0;
    };
    // 合集：01-28 / 01~28（多集打包，显示范围比单集号有用）
    var range = '';
    if (!ep && !s) {
      m = raw.match(/(?:^|[\s\-_.\[【（(])(\d{1,4})\s*[-~～]\s*(\d{1,4})(?=$|[\s\]】）).,])/);
      if (m && !badNum(+m[1]) && !badNum(+m[2]) && +m[2] > +m[1]) range = m[1] + '-' + m[2];
    }
    if (!ep && !range) {
      m = raw.match(/[\[\(（【]\s*(\d{1,4})\s*(?:v\d)?\s*[\]\)）】]/);
      if (m && !badNum(+m[1])) ep = +m[1];
    }
    if (!ep && !range) {
      m = raw.match(/(?:^|[\s\-_.])(\d{1,4})\s*(?:v\d+)?\s*(?=[\[\(（【])/);
      if (m && !badNum(+m[1])) ep = +m[1];
    }
    if (!ep && !range) {
      m = raw.match(/(?:^|[\s\-_.])(\d{1,4})\s*(?:v\d+)?\s*$/);
      if (m && !badNum(+m[1])) ep = +m[1];
    }
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    if (range) return (s ? 'S' + p2(s) + ' · ' : '') + range;
    if (!s && !ep) return '';
    if (s && ep) return 'S' + p2(s) + 'E' + p2(ep);
    if (ep) return 'E' + p2(ep);
    return 'S' + p2(s);
  }
  /* 三层过滤：blocked=命中词库（折叠，可展开看）；demoted=与查询不相关（沉底）；keep=正常。
     isDvd（番号搜索）→ 放宽：跳过词库层（怕屏蔽掉想要的），只留相关性层。
     skipRelevance（v425 动漫源结果）→ 跳过相关性层：站内已按标题检索过，
     而番剧标题常是「中文名 / 日文名 / 英文名」混排，客户端再卡 token 会把大量正确结果误降权。 */
  /* 去重键：优先 btih（同一资源不同标题），无则用整条磁力；无磁力链接的项不参与去重 */
  function magnetDedupeKey(it) {
    var m = (it && it.magnet) ? String(it.magnet) : '';
    if (!m) return '';
    var h = m.match(/btih:([a-z0-9]+)/i);
    return h ? 'h:' + h[1].toLowerCase() : 'm:' + m.toLowerCase();
  }
  function magnetBySeeders(a, b) {
    return (Number(b && b.seeders) || 0) - (Number(a && a.seeders) || 0);
  }
  function filterMagnetResults(items, q, words, isDvd, skipRelevance) {
    items = items || [];
    var keep = [], demoted = [], blocked = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it) continue;
      var key = magnetDedupeKey(it);
      if (key) { if (seen[key]) continue; seen[key] = 1; }   // 同一资源只留第一条
      if (!isDvd && magnetSpam(it.title, words)) { blocked.push(it); continue; }
      if (!skipRelevance && !magnetRelevant(it.title, q)) { demoted.push(it); continue; }
      keep.push(it);
    }
    // 做种数高的排前面（没有 seeders 字段的维持原顺序）
    keep.sort(magnetBySeeders); demoted.sort(magnetBySeeders); blocked.sort(magnetBySeeders);
    return { keep: keep, demoted: demoted, blocked: blocked };
  }

  global.NfoCore = {
    escapeXml: escapeXml,
    sanitizeName: sanitizeName,
    MAGNET_SPAM_WORDS: MAGNET_SPAM_WORDS,
    magnetNormText: magnetNormText,
    magnetRelevant: magnetRelevant,
    magnetSpam: magnetSpam,
    filterMagnetResults: filterMagnetResults,
    magnetEpLabel: magnetEpLabel,
    tmdbNormTitle: tmdbNormTitle,
    tmdbMatchLevel: tmdbMatchLevel,
    classifyTmdbResults: classifyTmdbResults,
    buildMovieXml: buildMovieXml,
    buildTvShowXml: buildTvShowXml,
    TRANSLATE_SYSTEM_PROMPT: TRANSLATE_SYSTEM_PROMPT,
    AI_PROMPTS: AI_PROMPTS,
    callLLM: callLLM,
    cleanAiReviewText: cleanAiReviewText,
    parseAiReviewText: parseAiReviewText,
    reviewRequest: reviewRequest,
    needsTranslation: needsTranslation,
    isChineseText: isChineseText,
    javZoneOrder: javZoneOrder,
    extractJsonObject: extractJsonObject,
    computeTranslateNeed: computeTranslateNeed,
    translateMeta: translateMeta,
    cleanTranslatedText: cleanTranslatedText,
    stripTitleParens: stripTitleParens,
    parseTitleYear: parseTitleYear,
    rankTitleYearResults: rankTitleYearResults,
    javStr: javStr,
    javName: javName,
    mapGenreEnToZh: mapGenreEnToZh,
    mapActressEnToZh: mapActressEnToZh,
    javCoverUrl: javCoverUrl,
    proxyImgUrl: proxyImgUrl,
    normalizeJavFilm: normalizeJavFilm,
    normalizeJavbusFilm: normalizeJavbusFilm,
    TMDB_IMG_BASE: TMDB_IMG_BASE,
    tmdbImgUrl: tmdbImgUrl,
    CC_MAP: CC_MAP,
    normalizeTmdbFilm: normalizeTmdbFilm,
    tmdbIsChinese: tmdbIsChinese,
    tmdbEnTitle: tmdbEnTitle,
    tmdbRequest: tmdbRequest,
    beginTmdbAction: beginTmdbAction,   // v490：一次点击 = 一次额度，动作入口调一下
    translateRequest: translateRequest,
    quotaInc: quotaInc,
    quotaData: quotaData,
    FILM_TYPE: FILM_TYPE,
    isAdultByRating: isAdultByRating,
    filmKey: filmKey,
    createEmptyFilm: createEmptyFilm,
    fetchImageToDataURL: fetchImageToDataURL,
    stillDisplayUrl: stillDisplayUrl,
    markPendingTranslate: markPendingTranslate,
    armTranslatingFallback: armTranslatingFallback,
    clearTranslatingFallback: clearTranslatingFallback,
    loadImageFromURL: loadImageFromURL,
    buildFilmFromCurrent: buildFilmFromCurrent,
    isAvFilm: isAvFilm
  };
})(typeof window !== 'undefined' ? window : this);
