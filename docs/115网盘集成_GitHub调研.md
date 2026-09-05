# 115 网盘集成 · GitHub 公开库调研（2026-09-05）

用户建议先搜公开参考再开发，避免盲测。调研结论如下。

## 一、关键参考项目

| 项目 | 地址 | 用途 |
|---|---|---|
| 115-fetch-cookie | github.com/KrxkGit/115-fetch-cookie | 纯前端扫码登录 115 + 自动拿 cookie + Cloudflare Worker 透明 CORS 代理（不存数据）。index.html 含完整前端扫码轮询逻辑，可直接移植 |
| p115client | github.com/ChenyangGao/p115client | Python 客户端，封装 115 web/app/open 全部接口（扫码/文件/云下载/上传），方案 A 核心库（已本地下载源码确认） |
| py115 | github.com/deadblue/py115 | Python SDK，star 较多，接口较上层 |
| 115wangpan | github.com/shichao-an/115wangpan | 老牌 Python 库，有完整 API 文档 |
| GreasyFork 115磁力助手 | greasyfork.org 脚本 520827 | 前端直连 115 离线下载接口实例，证明 web/lixian/?ct=lixian&ac=add_task_url 前端可直调（需 CORS 代理） |

## 二、扫码登录接口（115-fetch-cookie 实测对齐）

- 取 token：GET qrcodeapi.115.com/api/1.0/web/1.0/token/ → data.qrcode(二维码串) + data.uid/time/sign
- 轮询：GET qrcodeapi.115.com/get/status/?{uid,time,sign} → data.status：0 等待 / 1 已扫待确认 / 2 已登录 / -1 过期 / -2 取消
- 兑换 cookie：POST passportapi.115.com/app/1.0/{app}/1.0/login/qrcode/，body {app, account:uid} → data.cookie 为对象 {UID,CID,SEID,KID,...}，前端拼 k=v; 字符串
- 二维码渲染：qrcodejs 库 new QRCode(el,{text:qrcodeData,width,height,correctLevel:H})
- 有效期约 2 分钟，过期 status=-1 需重新生成

## 三、两条架构路线对比

### 路线 A（原方案）：Vercel Python 函数 + p115client 后端中转
- 后端持有 cookie、做全部业务逻辑，前端只发指令
- 优：p115client 封装全、签名/编码已处理、cookie 不暴露给 CORS 代理、安全边界清
- 缺：Vercel Python 运行时 + p115client 依赖重（本环境装 OOM）、cold start 慢、部署复杂

### 路线 B（115-fetch-cookie 模式）：纯前端 + JS 透明代理
- 前端直接调 115 全部 API（扫码/文件/云下载/上传），JS 代理只解决跨域，不存数据
- 优：极轻，一个 JS 函数即可（可复用现有 nfo-magnet-proxy-vercel，加 115 代理 route），无需 Python/p115client，部署简单，契合 nfo-editor 单文件 H5 形态
- 缺：云下载/上传的 web API 字段需前端逐个调通（参考 GreasyFork + p115client 源码）；代理白名单需放开到 webapi/clouddownload/upload.115.com

## 四、离线下载接口（已确认）

- 现代：POST clouddownload.115.com/lixianssp/?ac=add_task_url，body {url, wp_path_id}（cookie 鉴权，无需老版 sign）
- 旧版前端可直连：POST 115.com/web/lixian/?ct=lixian&ac=add_task_url
- 文件列表：GET webapi.115.com/files?cid=0，字段 n=名 / cid=ID / pid=父目录 / fc=文件数

## 五、待用户决策

路线 A / B 二选一后进入 P1。当前倾向 B（更轻、更快落地、复用现有 Vercel 仓库）。
