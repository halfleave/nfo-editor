# D1 兜底搜索（v535）规划 —— 已开发完成

## 一句话
把 D1 从"补中文名"升级成"搜索兜底"：JavBus 和 D1 并行搜；JavBus 有结果就补字段，没结果就显示 D1 卡片，且卡片能进详情。列表标题一律中文优先——有 D1 中文译名就用中文作主标题，没有才用原始标题。

## 现状（为什么搜不到）
- D1 现在只有一个按番号精确查的接口 `/api/d1?codes=`，用来给 JavBus 结果贴中文名。
- 它不是搜索引擎——用户输入中文片名时，JavBus 没有中文名、搜不到，D1 又没有"按关键词搜"的接口，所以整条链断在第一步。
- 另外这套代码还没推、没部署，手机上的 App 也还是旧版。

## 数据现实（先说清预期）
D1 只有 17 列，没有简介 / 剧照 / 评分 / 预告。所以 D1 兜底搜出来的详情页会偏空：有番号、日文名、中文译名、日期、演员、标签、片商、时长、封面，没有剧情和剧照。磁力仍不接（ed2k 老链、覆盖率约 1%，沿用之前决定）。

当前 D1 只导入 4 万行（1998 年起的老片），11-30 导完 12 万行后效果才完整。

## 改动清单

### 1. 后台 javbus-scraper（`api/index.js`）
新增关键词模糊搜索路由 `/api/d1/search?q=关键词`：
- 匹配范围：番号、全部番号变体、日文原名、中文译名、演员名。
- SQL 用参数绑定（防注入），`LIMIT 30`，keyword 做 trim。
- 复用现有 row→item 映射，**补上 `makers/labels/series/directors` 四个字段**（当前映射没有，进详情要用）。
- 返回 `{items:[...]}`，每项带 `queryCode=code`，方便 App 直接塞进会话缓存。

### 2. 后台 magnet-proxy
无需改动：`isD1Read` 判断的是 `includes('/api/d1')`，自动覆盖 `/api/d1/search`，**不扣搜索配额**。

### 3. App（`src/ui-ios.js`）
- 新增 `fetchD1Search(q)`：调 `/javbus/api/d1/search?q=`，失败返回空数组（静默，不影响 JavBus）。
- 在 `fetchJavbusSearch`（:9572）开头并行发起 D1 搜索，不 await。
- JavBus 命中（:9599）→ 沿用现有 `patchSearchFromD1`，把 D1 结果按番号配对补字段，不新增卡片。
- JavBus 全空（:9620）→ 不再直接显示"未找到"，改用 D1 搜索结果渲染卡片：
  - 卡片字段映射：`id=code`、`title=中文译名 || 日文名`、`img=cover`、`date=date`。
  - 复用 `renderJavbusResults`，加一个来源参数：D1 来源用独立的 `applyD1Result(i)`，跳过二次补数据请求。
  - D1 结果先塞进 `d1Cache`（命中时零网络开销）。
- 新增 `applyD1Result(i)`：把 D1 item 转成 JavBus 详情结构后调 `populateFromJavbus(d)`：
  | JavBus 字段 | D1 来源 |
  |---|---|
  | `id` | `code` |
  | `title` | `title_zh || title` |
  | `date` | `date` |
  | `videoLength` | `duration` |
  | `img` | `cover`（走现有 `/img` 代理） |
  | `genres` | `genres`（字符串数组→`{name}`） |
  | `stars` | `actors`（`{name,role}`→`{name}`） |
  | `director` | `directors[0]` |
  | `producer` | `makers[0]` |
  | `publisher` | `labels[0]` |
  | `series` | `series[0]` |
  - `plot/rating/magnets/trailer` 留空（D1 没有）。
  - 填充后调用现有 `patchDetailFromD1(film, d)` 补中文译名小字等（命中 `d1Cache`，不再发请求）。

### 4. 测试
- 后台：隔离测试搜番号 / 日文名 / 中文名 / 演员名四类 SQL 拼装与 item 映射。
- App：隔离测试 D1 结果→卡片映射、D1 item→JavBus 详情结构映射。
- 不真实调用线上接口。

### 5. 发版
- `node tools/bump.js 535 "D1 兜底搜索：JavBus 无结果时显示 D1 卡片，可进详情"`（抬 sw CACHE + About + PC `?v=` + 写日志）。
- 显示版本 2.5.35，内部号 535。
- 三仓库分推、两个 Worker 重部署——沿用既有顺序：先推 App 等手机更新，再部署 Worker。

## 需要你拍板 / 留意
1. **D1 详情页会偏空**（没剧情、没剧照、没评分、没预告）。这是数据源决定的，改不了。
2. **只有 4 万行**，新片搜不到属正常，11-30 导完再评估。
3. 中文搜索命中质量取决于 D1 里的中文译名（部分是机翻，可能别扭）。

## 验收场景
- 搜 `53ka01885`（番号）→ JavBus 没结果 → 出现 D1 卡片，中文标题「淫秽模特 鈴木麻奈美」→ 点进去详情有演员/片商/时长/封面。
- 搜「淫秽模特」（中文）→ 同上，验证关键词模糊搜。
- 搜一部 JavBus 有的片 → 只在原卡片上多一行中文小字，列表数量不变。
