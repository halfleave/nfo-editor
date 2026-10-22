#!/usr/bin/env node
/* core-shared（共享核心）纯逻辑测试 —— 先覆盖 v274 华语片原始标题取英文标题
 * 运行：node tests/core-shared-test.js （由 tools/check.js 汇总）
 * 约定：一行一个 assert，PASS/FAIL 开头便于 check.js 统计 */
const NfoCore = require('../src/core-shared.js').NfoCore;
function assert(cond, msg){ console.log((cond ? 'PASS' : 'FAIL') + ' ' + msg); if (!cond) process.exitCode = 1; }

/* —— 华语片判定 —— */
assert(NfoCore.tmdbIsChinese({ original_language: 'zh' }), '华语判定：original_language=zh');
assert(NfoCore.tmdbIsChinese({ origin_country: ['HK'] }), '华语判定：原产香港');
assert(NfoCore.tmdbIsChinese({ origin_country: ['CN', 'US'] }), '华语判定：中美合拍含 CN');
assert(!NfoCore.tmdbIsChinese({ original_language: 'en', origin_country: ['US'] }), '华语判定：英文片不命中');
assert(!NfoCore.tmdbIsChinese({ original_language: 'ja', origin_country: ['JP'] }), '华语判定：日文片不命中');

/* —— 英文标题提取（movie 用 titles / tv 用 results） —— */
const atMovie = { alternative_titles: { titles: [
  { iso_3166_1: 'CN', title: '赌神' },
  { iso_3166_1: 'GB', title: 'God of Gamblers' },
  { iso_3166_1: 'US', title: 'God of Gamblers' }
] } };
assert(NfoCore.tmdbEnTitle(atMovie) === 'God of Gamblers', '英文标题：US 优先');

const atGBonly = { alternative_titles: { titles: [ { iso_3166_1: 'CN', title: '赌神' }, { iso_3166_1: 'GB', title: 'God of Gamblers' } ] } };
assert(NfoCore.tmdbEnTitle(atGBonly) === 'God of Gamblers', '英文标题：无 US 时取 GB');

const atTV = { alternative_titles: { results: [ { iso_3166_1: 'CN', title: '古战场传奇' }, { iso_3166_1: 'US', title: 'Outlander' } ] } };
assert(NfoCore.tmdbEnTitle(atTV) === 'Outlander', '英文标题：tv 的 results 结构也能取到');

assert(NfoCore.tmdbEnTitle({ alternative_titles: { titles: [ { iso_3166_1: 'CN', title: '赌神' } ] } }) === '', '英文标题：只有中文区 → 返回空');
assert(NfoCore.tmdbEnTitle({}) === '', '英文标题：没挂 alternative_titles → 返回空');

/* —— normalizeTmdbFilm 集成 —— */
const zhDetail = {
  title: '赌神', original_title: '赌神', original_language: 'zh',
  release_date: '1989-12-14', origin_country: ['HK'],
  alternative_titles: { titles: [ { iso_3166_1: 'US', title: 'God of Gamblers' } ] }
};
const n = NfoCore.normalizeTmdbFilm(zhDetail, { actorLimit: 5 });
assert(n.title === '赌神' && n.originaltitle === 'God of Gamblers', '华语片：标题保持中文、原始标题取英文');

const zhNoAt = Object.assign({}, zhDetail); delete zhNoAt.alternative_titles;
const n2 = NfoCore.normalizeTmdbFilm(zhNoAt, { actorLimit: 5 });
assert(n2.originaltitle === '赌神', '华语片：拉不到英文标题 → 保持原行为（中文原名）');

const enDetail = {
  title: 'Inception', original_title: 'Inception', original_language: 'en',
  release_date: '2010-07-16', origin_country: ['US', 'GB'],
  alternative_titles: { titles: [ { iso_3166_1: 'US', title: 'Inception' } ] }
};
const n3 = NfoCore.normalizeTmdbFilm(enDetail, { actorLimit: 5 });
assert(n3.originaltitle === 'Inception', '非华语片：原始标题行为不变');

/* —— 剧集 NFO（<tvshow>）：M3.2 新增，与 <movie> 分开 —— */
const tvXml = NfoCore.buildTvShowXml({
  title: '怪奇物语', originaltitle: 'Stranger Things', year: '2016', premiered: '2016-07-15',
  runtime: '50', rating: '8.7', status: 'Continuing', season: '1', episode: '8',
  plot: '剧情简介', genres: ['悬疑'], countries: ['美国'], mpaa: 'TV-14',
  directors: [{ name: '达菲兄弟' }], actors: [{ name: '米莉', role: '十一' }], hasSubtitle: true
});
assert(tvXml.indexOf('<tvshow>') >= 0 && tvXml.indexOf('</tvshow>') >= 0, '剧集NFO：根标签为 <tvshow>');
assert(tvXml.indexOf('<movie>') < 0, '剧集NFO：不出现 <movie> 根标签');
assert(tvXml.indexOf('<title>怪奇物语</title>') >= 0, '剧集NFO：剧集名');
assert(tvXml.indexOf('<originaltitle>Stranger Things</originaltitle>') >= 0, '剧集NFO：原始剧名');
assert(tvXml.indexOf('<premiered>2016-07-15</premiered>') >= 0, '剧集NFO：首播日期');
assert(tvXml.indexOf('<runtime>50</runtime>') >= 0, '剧集NFO：单集时长');
assert(tvXml.indexOf('<status>Continuing</status>') >= 0, '剧集NFO：连载状态');
assert(tvXml.indexOf('<season>1</season>') >= 0, '剧集NFO：季号');
assert(tvXml.indexOf('<episode>8</episode>') >= 0, '剧集NFO：总集数');
assert(tvXml.indexOf('<genre>悬疑</genre>') >= 0, '剧集NFO：类型');
assert(tvXml.indexOf('<country>美国</country>') >= 0, '剧集NFO：国家');
assert(tvXml.indexOf('<mpaa>TV-14</mpaa>') >= 0, '剧集NFO：分级');
assert(tvXml.indexOf('<director>达菲兄弟</director>') >= 0, '剧集NFO：主创写入 <director>');
assert(tvXml.indexOf('<name>米莉</name>') >= 0 && tvXml.indexOf('<role>十一</role>') >= 0, '剧集NFO：演员与角色名');
assert(tvXml.indexOf('<subtitles>字幕</subtitles>') >= 0, '剧集NFO：字幕标记');

const tvMin = NfoCore.buildTvShowXml({ title: 'X' });
assert(tvMin.indexOf('<season>') < 0 && tvMin.indexOf('<status>') < 0, '剧集NFO：空字段不输出标签');
assert(tvMin.indexOf('<dvdid>') < 0 && tvMin.indexOf('<studio>') < 0 && tvMin.indexOf('<series>') < 0, '剧集NFO：不含番号/制作商/系列等 AV 专属标签');
assert(NfoCore.buildTvShowXml(null).indexOf('<tvshow>') >= 0, '剧集NFO：空入参不抛错，仍输出合法骨架');
assert(NfoCore.buildTvShowXml({ title: 'A & B' }).indexOf('<title>A &amp; B</title>') >= 0, '剧集NFO：XML 特殊字符转义');
assert(NfoCore.buildMovieXml({ title: 'X' }).indexOf('<movie>') >= 0, '回归：电影 NFO 仍为 <movie>（未受剧集生成器影响）');

/* —— v404 剧集选集：tvshow.nfo 内嵌 <episodedetails> 每集简介 —— */
const tvEps = NfoCore.buildTvShowXml({
  title: '某剧',
  tvSeasons: {
    '2': { n: 2, episodes: [
      { ep: 2, name: '第二集', overview: '简介 2', air: '2024-01-02', runtime: 45, vote: 7.5 },
      { ep: 1, name: '', overview: '', air: '', runtime: 0, vote: 0 }
    ] },
    '1': { n: 1, episodes: [ { ep: 3, name: '第三集', overview: '含 <tag> & 符号', air: '2023-03-03', runtime: 42, vote: 8.1 } ] }
  }
});
assert(tvEps.indexOf('<episodedetails>') >= 0 && tvEps.indexOf('</episodedetails>') >= 0, '选集NFO：内嵌 episodedetails 块');
assert(tvEps.indexOf('<season>1</season>') < tvEps.indexOf('<season>2</season>'), '选集NFO：按季排序（S1 在 S2 前）');
assert(tvEps.indexOf('<episode>1</episode>') < tvEps.indexOf('<episode>2</episode>'), '选集NFO：同季内按集排序');
assert(tvEps.indexOf('<title>第二集</title>') >= 0, '选集NFO：集名写入 title');
assert(tvEps.indexOf('<plot>简介 2</plot>') >= 0, '选集NFO：简介写入 plot');
assert(tvEps.indexOf('<plot>含 &lt;tag&gt; &amp; 符号</plot>') >= 0, '选集NFO：简介 XML 特殊字符转义');
assert(tvEps.indexOf('<aired>2023-03-03</aired>') >= 0, '选集NFO：播出日期');
assert(tvEps.indexOf('<runtime>42</runtime>') >= 0, '选集NFO：单集时长');
assert(tvEps.indexOf('<rating>7.5</rating>') >= 0, '选集NFO：单集评分');
assert(tvEps.match(/<episodedetails>/g).length === 3, '选集NFO：空简介集仍输出块（共 3 集）');
assert(tvEps.lastIndexOf('<episodedetails>') < tvEps.lastIndexOf('</tvshow>'), '选集NFO：episodedetails 在 </tvshow> 闭合前');
const tvNoEps = NfoCore.buildTvShowXml({ title: '无缓存剧' });
assert(tvNoEps.indexOf('<episodedetails>') < 0, '选集NFO：无 tvSeasons 缓存不输出 episodedetails');
assert(NfoCore.buildMovieXml({ title: 'X', tvSeasons: { '1': { episodes: [ { ep: 1 } ] } } }).indexOf('<episodedetails>') < 0, '选集NFO：电影 NFO 不受影响');

/* —— v398 搜索增强：「标题.年份」解析 —— */
const pt = NfoCore.parseTitleYear;
assert(pt('教父.1972').title === '教父' && pt('教父.1972').year === 1972, '解析：教父.1972 → 教父/1972');
assert(pt('教父 1972').title === '教父' && pt('教父 1972').year === 1972, '解析：空格分隔同样拆');
assert(pt('教父（1972）').title === '教父' && pt('教父（1972）').year === 1972, '解析：全角括号');
assert(pt('教父(1972)').year === 1972, '解析：半角括号');
assert(pt('The.Matrix.1999').title === 'The.Matrix' && pt('The.Matrix.1999').year === 1999, '解析：英文点号只切末尾年份');
assert(pt('1917.2019').title === '1917' && pt('1917.2019').year === 2019, '解析：数字片名 + 年份');
assert(pt('请回答1988').title === '请回答1988' && pt('请回答1988').year === 0, '解析：片名自带年份数字不误切');
assert(pt('教父2').year === 0, '解析：续集数字不当年份');
assert(pt('2019').year === 0 && pt('2019').title === '2019', '解析：纯年份不拆，按原词搜');
assert(pt('阿凡达：水之道.2022').title === '阿凡达：水之道', '解析：中文冒号标题完整保留');
assert(pt('').title === '' && pt('').year === 0, '解析：空串安全');
assert(pt(null).year === 0, '解析：null 安全');

/* —— v398 搜索结果排序：精准项置顶 —— */
const rk = NfoCore.rankTitleYearResults;
const pyGod = { title: '教父', year: 1972, raw: '教父.1972' };
const godList = [
  { id: 1, title: '教父', release_date: '1990-12-25' },
  { id: 2, title: '教父', release_date: '1972-03-14' },
  { id: 3, title: '别的片', release_date: '1972-01-01' },
  { id: 4, title: '无关', release_date: '2001-01-01' }
];
assert(rk(godList, pyGod)[0].id === 2, '排序：标题+年份都对 → 第一');
assert(rk(godList, pyGod)[1].id === 1, '排序：其次标题对');
assert(rk(godList, pyGod)[2].id === 3, '排序：再次年份对');
assert(rk(godList, pyGod)[3].id === 4, '排序：其余保持 TMDB 原顺序');
assert(rk(godList, pyGod) !== godList, '排序：返回副本不改原数组');
assert(rk([{ id: 1, title: '教父', release_date: '1972-01-01' }], pyGod).length === 1, '排序：单条结果原样返回');
assert(rk([{ id: 1 }, { id: 2 }], null).length === 2, '排序：无解析结果不排序');
assert(rk([{ id: 1 }, { id: 2 }], { title: 'x', year: 0 }).length === 2, '排序：year=0 不排序');
const pyMat = { title: 'the matrix', year: 1999, raw: 'The.Matrix.1999' };
const matList = [{ id: 9, name: '某剧', first_air_date: '1999-05-01' }, { id: 8, original_title: 'The Matrix', release_date: '1999-03-31' }];
assert(rk(matList, pyMat)[0].id === 8, '排序：original_title 与 first_air_date（tv）兼容');

console.log('core-shared 完成');
