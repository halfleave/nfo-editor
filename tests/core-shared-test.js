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

console.log('core-shared 完成');
