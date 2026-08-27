# NFO 编辑器 · TPDB 接入 + 元数据/成人标记解耦 方案（v2）

> 状态：待确认。确认后执行「开发」阶段。
> v1（r18 优先 → TPDB 兜底）已废弃，按本版「源分开 + 保存时选 18+」实现。

## 1. 核心设计变更

### 1.1 三个互相独立的元数据「源」
搜索页源切换从 `TMDB / JAV` 扩展为 **`TMDB / JAV / TPDB`** 三个按钮，各自只负责"怎么把元数据拉进来"，互不串：

| 源 | 搜索方式 | 上游 |
|----|----------|------|
| TMDB | 片名 | `api.themoviedb.org/3`（Key 在应用内配置，直连） |
| JAV（r18） | 番号 | 你的 Worker `/r18rich`（Turso 富源） |
| TPDB | 番号/code | `api.theporndb.net`（Token 在应用内配置，直连） |

### 1.2 TPDB Token = 应用内配置，跟 TMDB 一样"配了即用"
- 在「设置 → API 配置」新增一行 `ThePornDB Token`，与 `TMDB Key` 同级，`state.tpdbToken` 持久化到 IndexedDB。
- PWA **直接** `fetch('https://api.theporndb.net/jav?parse=<番号>', { headers: { Authorization: 'Bearer ' + token } })`，与 TMDB 直连模式一致。
- 图片统一走现有 Worker `/img?url=` 代理（绕 CORS + 转 dataURL 持久化）。
- **兜底**：若实测浏览器直连 TPDB 被 CORS 拦，再补 Worker `/tpdb` 路由转发（同 `/r18rich` 模式，Token 由 Worker 环境变量提供）。先按直连实现，CORS 不通再补 Worker。

### 1.3 成人标记「解耦」：元数据通用，保存时选 18+
这是修复串档 bug 的关键，也是你要的"点保存的时候可以选影片/18+"。

- **编辑页新增「影片 / 18+」分段控件**（复用已有 `setEditType(t)`，把 `AV` 文案改 `18+`），明确驱动 `state.adult`。
- 拉取元数据时，源**只给一个默认建议**（JAV/TPDB → 默认 18+；TMDB → 默认 影片），用户可随时翻转。
- `buildFilmFromCurrent()` 的 `adult` **只取 `state.adult`（用户的显式选择）**，不再从 `state.genres` 反推，杜绝"类型里有成人标签就自动变 AV"。
- 首页标签：**影片（adult=false）/ 18+（adult=true）**，从 `AV` 改名为 `18+`，过滤逻辑不变（`renderOverview` 按 `f.adult` 过滤）。

### 1.4 元数据「合并成一个通用」填充函数
新增 `applyGenericMeta(meta)`，三个源都把各自响应**归一化**成同一结构后调用它，避免三套 populate 各自改 `state.adult` 导致行为不一致：

```
meta = {
  title, originaltitle, year, premiered, runtime, plot, rating,
  genres:[], actors:[{name,photo}], directors:[{name}],
  studio, label, series, dvdId, trailer,
  cover,            // 封面 URL
  gallery:[],       // 剧照 URL 列表
  adultSuggestion   // true/false：源的默认建议，仅初次填充时采用
}
```

- `populateFromTMDB` / 新增 `populateFromTPDB` / 保留 `populateFromJAV` → 各自先归一化 → 调 `applyGenericMeta`。
- `applyGenericMeta` 内部统一处理：清空旧字段、写文本、渲染 chips、转 dataURL 持久化（沿用 v28 已修好的 gallery→dataURL 逻辑）、按 `adultSuggestion` 设 `state.adult` 初始值。

## 2. Bug 修复清单（串档根因）

| 位置 | 现状（bug） | 修改 |
|------|-------------|------|
| `openCustomEdit()` | `newFilm(state.metaSource === 'jav')` 把"上次源"当成 adult | 改为 `newFilm()`，默认 `adult=false`（影片），由编辑页 18+ 控件决定 |
| `newFilm(adult)` | 入参 `adult` 来自源 | 去掉该耦合；新增影片一律默认 `state.adult=false`，用户可在编辑页翻到 18+ |
| `buildFilmFromCurrent()` | `adult = state.adult \|\| genres 命中 genreAdult` | 改为 `adult = state.adult`（仅用户显式选择） |
| `populateFromJAV` | 强制 `state.adult = true` | 改为 `adultSuggestion = true`，交 `applyGenericMeta` 设初始值 |
| `populateFromTMDB` | 强制 `state.adult = false` | 改为 `adultSuggestion = false` |
| `setOverviewTab` 文案 | `影片 / AV` | 改为 `影片 / 18+` |
| `editMetaTag` 文案 | `AV` | 改为 `18+`；并让分段控件可点击切换 |

## 3. 前端改动（`nfo-editor-ios.html`）

### 3.1 搜索页源切换：加 TPDB 按钮
- `#searchMetaSeg` 内增加 `<button data-source="tpdb" onclick="setMetaSource('tpdb',this)">TPDB</button>`。
- `setMetaSource` 增加 `'tpdb'` 分支：占位符 `IPX-011`、清空输入框、刷新对应历史。
- `searchMeta()` 分派：`tpdb` → `searchTPDB()`。

### 3.2 API 配置区
- 在 `TMDB Key` 与 `Worker 代理地址` 之间（或之后）加 `ThePornDB Token` 输入行 `id="tpdbTokenInput"`。
- 保存进 `state.tpdbToken`（与 `state.tmdbKey` 同处理）。

### 3.3 API 说明弹窗
- 新增「ThePornDB Token」一节：说明用于补齐最新 AV 元数据、去 `https://theporndb.net/user/api-tokens` 生成、可选不填则 TPDB 源不可用。

### 3.4 TPDB 搜索与归一化
- `searchTPDB()`：校验番号 → 直连 `api.theporndb.net/jav?parse=<番号>`（带 `Authorization: Bearer`）→ 取首条 → 再 `GET /jav/<id>` 详情。
- `normalizeTPDBResult(raw)`：洗成 `applyGenericMeta` 通用结构（见 §1.4 字段映射表）。
- `renderSingleJAV` 改名为更通用的结果卡片渲染，来源标签显示 `TMDB / R18 / TPDB`。
- 图片：`javCoverUrl` 扩展——TPDB 图片域名（`media.theporndb.net` / `cdn.theporndb.net` 等，实测后补）统一走 Worker `/img?url=`。

### 3.5 编辑页「影片 / 18+」控件
- 现有只读 `editMetaTag`（影片/AV）改为可点击的 `影片 / 18+` 分段控件，调用 `setEditType('movie'|'av')`（'av' 即 18+）。
- `applyEditMode()` 文案：`'AV'` → `'18+'`。

### 3.6 字段映射（TPDB → 通用 meta）
| TPDB 字段 | 通用 meta | 备注 |
|-----------|-----------|------|
| `data.title` | `title` | |
| `data.external_id` | `dvdId` | 番号 |
| `data.date` | `premiered` / `year` | |
| `data.duration` / `runtime` | `runtime` | 分钟 |
| `data.description` | `plot` | |
| `data.director.name` | `directors[].name` | |
| `data.site.name` | `studio` | 片商 |
| `data.network?.name` | `label` | 发行 |
| `data.performers[].parent.name` | `actors[].name` | 女优 |
| `data.performers[].parent.image` | `actors[].photo` | |
| `data.tags[].name` | `genres[]` | 复用 `mapGenreEnToZh` 转中文 |
| `data.background.full` | `cover` + `gallery[0]` | |
| `data.posters.full` | `gallery[]` | |
| `data.trailer` / `trailers[]` | `trailer` | |
| `data.id` | `tmdbId` 占位（内部 id） | |

## 4. Worker 改动（仅兜底时需要）

若直连 TPDB 被 CORS 拦，新增 `/tpdb` 路由（同 `/r18rich` 模式）：
- `GET /tpdb?dvd_id=番号` → 读 `process.env.TPDB_TOKEN` → 上游 `api.theporndb.net/jav?parse=…` + 详情 → 透传、补 CORS。
- 否则**不改动 Worker**，保持纯前端直连。

## 5. 待确认

1. TPDB 直连 CORS 未知——你方便的话，拿到 Token 后我先小测一次直连是否通；通就纯前端、不动 Worker，不通再补 `/tpdb` 路由 + Vercel 环境变量。是否认可这个"先直连、不通再补"的路线？
2. 编辑页「影片 / 18+」控件放在哪：标题栏右侧（替代现有只读 `影片/AV` 标签）是否 OK？
3. 搜索历史：TPDB 是否单独一列（tmdb/jav/tpdb 三列），还是把 JAV+TPDB 合并到"av"历史？倾向三列独立。
4. 你已有 TPDB Token，开发完后要实测——是否愿意在「设置」里先填好 Token 再让我联调？

## 6. 文件改动清单

| 文件 | 改动 |
|------|------|
| `nfo/nfo-editor-ios.html` | 三源切换 + TPDB 配置/搜索/归一化 + 通用 `applyGenericMeta` + 编辑页影片/18+ 控件 + 首页标签改名 18+ + 解耦 bug 修复 |
| `nfo/sw.js` | 缓存版本递增（v28→v29） |
| `nfo/README.md` | API 配置章节补 TPDB Token |
| `nfo-magnet-proxy-vercel-main/api/index.js` | **仅在 CORS 不通时**新增 `/tpdb` 路由 |

## 7. 风险

- **TPDB CORS**：前端直连能否成功取决于源站 CORS 头，需实测（见待确认 1）。
- **TPDB 字段漂移**：社区文档与真实返回可能不一致，归一化函数需拿到真实响应微调。
- **图片域名**：TPDB 图片 CDN 域名需实测确认后写进 `javCoverUrl` 代理规则。
- **genreAdult 列表**：不再参与 adult 判定，仅作 UI 提示/默认类型收纳，需确认不影响现有 AV 类型展示。
