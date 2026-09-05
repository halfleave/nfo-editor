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

  global.NfoCore = {
    escapeXml: escapeXml,
    sanitizeName: sanitizeName,
    buildMovieXml: buildMovieXml
  };
})(typeof window !== 'undefined' ? window : this);
