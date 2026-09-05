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
        try { resolve(extractJsonObject(c)); }
        catch (e) { reject(new Error('翻译结果解析失败')); }
      }).catch(function (err) {
        if (timer) clearTimeout(timer);
        reject(err);
      });
    });
  }

  global.NfoCore = {
    escapeXml: escapeXml,
    sanitizeName: sanitizeName,
    buildMovieXml: buildMovieXml,
    TRANSLATE_SYSTEM_PROMPT: TRANSLATE_SYSTEM_PROMPT,
    needsTranslation: needsTranslation,
    extractJsonObject: extractJsonObject,
    computeTranslateNeed: computeTranslateNeed,
    translateMeta: translateMeta
  };
})(typeof window !== 'undefined' ? window : this);
