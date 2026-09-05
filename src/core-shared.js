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
    return (name || '')
      .replace(/[\\/:*?"<>|]/g, '_')
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

  // ===== 翻译模块（纯逻辑，不碰 DOM/state）=====
  // 提示语：成人影视元数据 → 简体中文；含 8 条硬性规则（番号原样、含假名才翻、JSON 输出）
  var TRANSLATE_SYSTEM_PROMPT = [
    '你是将成人影视元数据译为简体中文的翻译专家。请把下方日文的影片标题与简介翻译为简体中文。',
    '硬性规则：',
    '1. 仅做等值翻译，不增删、不概括、不改写语气。',
    '2. 专有名词保留原文并附中文：演员名、片商、系列名。',
    '3. 番号/型号代码（如 SONE-456、ABC-123）一律原样输出，绝不翻译或改写。',
    '4. 日文汉字按简体中文习惯转写（例：妻→人妻按需），但语义必须准确。',
    '5. 不雅化也不净化原文本措辞，保持原营销/直述风格。',
    '6. 已知源语言：日文，请勿误判。',
    '7. 若某字段已是简体中文、英文或纯番号代码，则原样输出，不要改写或翻译。',
    '8. 严格输出 JSON，不要任何多余文字、不要 markdown 代码块包裹。格式：{"title":"简体中文标题","summary":"简体中文简介"}'
  ].join('\n');

  // 是否需要翻译：仅当含日文假名（平/片假名）判定为日文；纯汉字/英文/番号不翻（避免误翻中文）
  function needsTranslation(text) {
    if (!text || !String(text).trim()) return false;
    return /[ぁ-んァ-ヶ]/.test(String(text));
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

  // 调用 OpenAI 兼容接口，一次请求翻译 title + plot；返回 Promise<{title, summary}>（30s 超时）
  // cfg = { baseUrl, apiKey, model } 由调用方从配置/state 传入（不读全局，便于两端复用）
  function translateMeta(title, plot, cfg) {
    return new Promise(function (resolve, reject) {
      var base = ((cfg && cfg.baseUrl) || '').trim().replace(/\/+$/, '');
      var key = (cfg && cfg.apiKey) || '';
      var model = (cfg && cfg.model) || '';
      if (!base || !key || !model) { reject(new Error('翻译未配置')); return; }
      var endpoint = /\/chat\/completions$/i.test(base) ? base : base + '/chat/completions';
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 30000) : null;
      var userMsg = '【标题】\n' + (title || '') + '\n\n【简介】\n' + (plot || '');
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({ model: model, temperature: 0.3, messages: [
          { role: 'system', content: TRANSLATE_SYSTEM_PROMPT },
          { role: 'user', content: userMsg }
        ] }),
        signal: ctrl ? ctrl.signal : undefined
      }).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error('HTTP ' + r.status + '：' + t.slice(0, 200)); });
        return r.json();
      }).then(function (d) {
        if (timer) clearTimeout(timer);
        var c = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
        if (!c) throw new Error('翻译返回为空');
        try {
          var res = extractJsonObject(c);
          if (typeof res.title === 'string') res.title = cleanTranslatedText(res.title);
          if (typeof res.summary === 'string') res.summary = cleanTranslatedText(res.summary);
          resolve(res);
        }
        catch (e) { reject(new Error('翻译结果解析失败')); }
      }).catch(function (err) {
        if (timer) clearTimeout(timer);
        reject(err);
      });
    });
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
  /* 归一化 TMDB 详情（movie/tv）→ 标准字段对象（纯逻辑，不碰 DOM/state）。
   * opts.isTV：当前是否为剧集详情（决定 name/first_air_date/episode_run_time/created_by/content_ratings）；不读全局 state。
   * opts.actorLimit：演员显示上限（手机端 5 / PC 端 11，分叉保留，由 UI 经 opts 传入）。
   * 图片仅返回 TMDB 原始 file_path（posterPaths/backdropPaths/logoPath）与已拼好的 galleryLinks（w1280 直连 URL）；
   * 实际的 fetch→blob→dataURL 与 <img> DOM 由两端 UI 各自处理（不碰共享核心）。 */
  function normalizeTmdbFilm(d, opts){
    opts = opts || {}; d = d || {};
    var isTV = !!opts.isTV;
    var actorLimit = opts.actorLimit || 5;
    var title = d.title || (isTV ? d.name : '') || d.original_title || (isTV ? d.original_name : '') || '';
    var orig = d.original_title || (isTV ? d.original_name : '') || d.title || (isTV ? d.name : '') || '';
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

  // 成人归属：完全由分级决定——nc-17 或 nr（含 JAV 默认 NR）即归 18+（XV）。
  // 这是「保存 AV 再保存影片、影片被错存成 AV」串档 bug 的根因修复点，集中为单点真相。
  function isAdultByRating(mpaa){
    return /^(nc-17|nr)$/i.test((mpaa || '').trim());
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
    // 成人归属完全由分级决定：nc-17 或 nr（含 JAV 默认 NR）即归 18+（XV）——集中到共享核心单点真相
    var adult = isAdultByRating(state.mpaa);
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
        poster: state.poster || null, originalPoster: state.originalPoster || null, fanart: state.fanart || null, logo: state.logo || null, detailPoster: state.detailPoster || null,
        posterCandidates: state.posterCandidates || null, fanartCandidates: state.fanartCandidates || null,
        gallery: state.gallery || [], galleryLinks: state.galleryLinks || [], hasSubtitle: !!state.hasSubtitle, trailer: state.trailer || null, tmdbId: state.tmdbId || null,
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
    if (!translateConfigReady()) return;
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

  global.NfoCore = {
    escapeXml: escapeXml,
    sanitizeName: sanitizeName,
    buildMovieXml: buildMovieXml,
    TRANSLATE_SYSTEM_PROMPT: TRANSLATE_SYSTEM_PROMPT,
    needsTranslation: needsTranslation,
    extractJsonObject: extractJsonObject,
    computeTranslateNeed: computeTranslateNeed,
    translateMeta: translateMeta,
    cleanTranslatedText: cleanTranslatedText,
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
    buildFilmFromCurrent: buildFilmFromCurrent
  };
})(typeof window !== 'undefined' ? window : this);
