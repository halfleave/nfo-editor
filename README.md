# NFO Editor

一个基于单文件 HTML 的影片 NFO 信息编辑器，支持 NFO 文件导入导出、TMDB 在线搜索、海报与演职人员管理。所有数据保存在浏览器本地（IndexedDB），无需后端服务。

仓库包含两个版本：

| 文件 | 说明 |
|------|------|
| `nfo-editor.html` | 基础版，简洁通用 |
| `nfo-editor-ios.html` | iOS 26 Liquid Glass 风格版，针对手机/Safari 优化交互与动画 |

## 功能特性

- **NFO 文件管理**：导入本地 `.nfo` 文件，解析影片元数据；支持导出 NFO。
- **TMDB 在线搜索**：通过 The Movie Database API 搜索影片并一键导入标题、年份、剧情、评分、海报、背景图、预告片等信息。
- **多媒体素材**：管理海报（poster）、背景图（fanart）、Logo 和演职人员头像，支持裁剪。
- **演职人员管理**：添加、编辑、删除导演和演员，维护角色信息。
- **预告片播放**：自动识别 YouTube 预告片并内嵌播放（仅 TMDB 导入）。
- **本地持久化**：所有影片数据存储在浏览器 IndexedDB，刷新不丢失。
- **iOS 风格交互**（iOS 版）：底部 Sheet 弹窗、手势缩放海报、滚动磨砂玻璃效果、安全区适配等。

## 快速开始

1. 克隆或下载本仓库。
2. 任选以下方式打开：
   - 本地直接双击 `nfo-editor-ios.html`（或 `nfo-editor.html`）。
   - 部署到任意静态托管（GitHub Pages、Cloudflare Pages、Vercel 等）。
3. 首次使用建议配置 TMDB API Key（见下文）。

## 配置 TMDB API Key

TMDB 搜索与海报导入需要 API Key。

1. 访问 [TMDB 官网](https://www.themoviedb.org/) 注册并申请 API Key（个人版即可）。
2. 打开编辑器，进入「设置」→「TMDB API Key」。
3. 粘贴 Key 并保存，即可使用搜索与导入功能。

## 技术栈

- 单文件 HTML，零构建步骤
- 原生 JavaScript（Vanilla JS）
- IndexedDB（浏览器本地数据库）
- TMDB API（`append_to_response=videos`）
- CSS 变量与 `backdrop-filter` 实现 iOS Liquid Glass 质感

## 浏览器兼容性

- Chrome / Edge（最新版）
- Safari（iOS 16+ / macOS 13+，iOS 版针对 Safari 做了手势与安全区适配）
- Firefox（最新版，部分滤镜效果可能略有差异）

## 文件结构

```
.
├── nfo-editor.html          # 基础版编辑器
├── nfo-editor-ios.html      # iOS 26 Liquid Glass 风格版
├── README.md                # 本文件
└── .*-test.js               # 本地测试脚本（jsdom + fake-indexeddb）
```

## 本地测试

项目附带少量 Node.js 测试脚本，用于校验核心逻辑：

```bash
node --check nfo-editor-ios.html
# 或运行具体测试（需安装 jsdom、fake-indexeddb）
node .features-test.js
```

> 测试依赖可通过 `npm install jsdom fake-indexeddb` 安装。

## 截图

> TODO：添加应用主界面、影片详情页、编辑页截图。

## License

MIT