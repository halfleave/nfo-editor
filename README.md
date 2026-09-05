# NFO 编辑器

一套用于整理电影 / 剧集 NFO 元数据的轻量工具。支持海报、剧照、Logo 等图片编辑，以及演员、导演、国家 / 地区、类型等信息的录入与管理，最终导出标准 `.nfo` 文件，配合 Kodi、Emby、Plex、Infuse 等媒体管理软件使用。

提供两个版本，均为纯静态前端文件（移动版 `nfo-editor-ios.html` 需与 `src/core-shared.js` 同目录），无需服务器、无需安装、双击即可在浏览器打开：

| 版本 | 文件 | 适用场景 |
|---|---|---|
| **移动版（iOS）** | `nfo-editor-ios.html` | iPhone / iPad，建议「添加到主屏幕」全屏使用 |
| **桌面版** | `nfo-editor.html` | Windows / macOS / Linux 桌面浏览器，可直接写入本地目录 |

访问仓库根目录的 `index.html` 会根据设备类型自动跳转到对应版本。

---

## 功能特性

- **图片编辑**：海报、剧照、Logo 上传与裁剪（裁剪框外内容默认隐藏，操作时显示并带暗色聚焦遮罩）。
- **人员管理**：演员 / 导演添加，支持头像、姓名、角色名；弹窗采用分组卡片式输入。
- **标签系统**：
  - 国家 / 地区、类型以气泡胶囊选择。
  - 内置常用预设，可在「配置」中增删、拖拽排序、逐条**启用 / 禁用**（禁用后文字置灰、选择弹窗不再出现）。
  - 支持本次临时「手动添加」标签，仅作用于当前影片，不写入预设库。
  - 预设库与禁用状态长期保存在浏览器本地（IndexedDB），刷新不丢失。
- **主题与外观**：支持浅色 / 深色 / 自动；可切换主题色。
- **数据安全**：设置页「恢复」可一键清空所有配置与缓存，回到初始状态（带二次确认）。
- **离线可用（移动版）**：通过 `sw.js` Service Worker 缓存应用外壳，部署到 HTTPS 后可离线打开。

---

## 文件结构

```
nfo-editor/
├── index.html            # GitHub Pages 入口，按设备自动跳转
├── src/                  # 共享核心 core-shared.js（纯逻辑，window.NfoCore）+ 桌面版 core.js/ui.js
├── nfo-editor-ios.html   # 移动版（iOS）源文件（引用 src/core-shared.js 共享核心）
├── nfo-editor.html       # 桌面版源文件（File System Access API 直写目录）
├── sw.js                 # 移动版 Service Worker（离线缓存）
├── dist/                 # 部署副本（含上述四件套）
├── verify_nfo.py         # 修改后做 JS 语法校验
├── make_icon.py          # 生成应用图标（icon_app.png）
└── icon_app.png          # 应用图标源图
```

---

## 部署到 GitHub Pages

1. 在仓库根目录上传以下文件：**`index.html`**、**`nfo-editor-ios.html`**、**`nfo-editor.html`**、**`sw.js`**（`dist/` 内的副本即为这一套完整文件）。
2. 在仓库 **Settings → Pages** 中，将 Source 设为 `main` 分支（或你的默认分支）的 `/ (root)`。
3. 访问分配的 `https://<用户名>.github.io/<仓库名>/`，移动设备会自动打开 `nfo-editor-ios.html`。

> **注意**
> - 移动版的分享导出、Service Worker 离线等能力**需要 HTTPS**（GitHub Pages 已满足）。
> - `sw.js` 必须与入口页面同源同级，否则离线缓存不生效。
> - 修改源文件后，需重新上传到仓库根目录才能对公网生效。

---

## 本地预览

**桌面版**：直接用浏览器打开 `nfo-editor.html` 即可（桌面版依赖文件系统 API，建议用 Chrome / Edge）。

**移动版**：
- 简单方式：用电脑起一个本地 HTTP 服务（或 `python -m http.server 8000`），手机与电脑同一 Wi-Fi 下访问 `http://<电脑IP>:8000/nfo-editor-ios.html`。注意 HTTP 环境下 Service Worker 与系统分享不可用，仅用于界面预览。
- 完整体验：部署到 HTTPS（如 GitHub Pages 或 CloudStudio）后，在 Safari 中打开 → 点击「分享」→「添加到主屏幕」，即可全屏离线使用。

---

## 校验与构建

修改 `nfo-editor-ios.html` 后，建议先跑语法校验：

```bash
python verify_nfo.py nfo-editor-ios.html
```

校验通过再同步到 `dist/` 或上传部署，避免把带语法错误的版本发布出去。

---

## 隐私说明

所有影片数据、标签预设、主题与配置均仅保存在**你自己的浏览器本地（IndexedDB）**，不会上传到任何服务器。执行「恢复」会清空这些本地数据，操作前请确认已导出需要保留的内容。
