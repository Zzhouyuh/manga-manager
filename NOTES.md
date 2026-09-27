# 开发笔记 / 交接单

> 这份文件是给"下一次继续开发"用的：架构要点、约定、坑、待办都在这里。
> 用户可见的功能说明见 [README.md](./README.md)，版本变更见 [CHANGELOG.md](./CHANGELOG.md)。

## 一、环境与运行

| 项目 | 说明 |
| --- | --- |
| 代码位置 | `D:\IDEAworkplace\manga-manager`（Windows），WSL 里是 `/mnt/d/IDEAworkplace/manga-manager` |
| 技术栈 | Electron 44 + React 19 + TypeScript + Vite 8 + `node:sqlite` |
| 开发 | `npm run dev`（concurrently 起 vite + electron）；打包 `npm run dist`（产物在 `release/`） |
| 数据目录 | **固定** `%APPDATA%\MangaManager`（在 `main.js` 里用 `app.setPath('userData', ...)` 锁死，避免改包名/打包后"库变空"） |
| 数据库 | `%APPDATA%\MangaManager\manga.db`（`node:sqlite` 的 `DatabaseSync`） |
| 缓存 | `covers/`（系列封面，640px jpg）+ `thumbs/`（图片墙缩略图） |

**改完要不要重启？**

- 改了 `electron/` 下任何文件（main / preload / db / scanner / mobi / epub / zipcache）→ **必须重启 `npm run dev`**
- 只改 `src/` 下（页面、组件、样式）→ 刷新窗口即可（Vite HMR）

## 二、架构要点（容易忘的关键决定）

### 1. 图片读取：`manga://` 自定义协议（替代 base64）

主进程注册了特权协议（`registerSchemesAsPrivileged` + `protocol.handle`）：

| URL | 用途 |
| --- | --- |
| `manga://img/<encodeURIComponent(图片路径)>` | 原图（阅读器） |
| `manga://thumb/<宽度>/<编码路径>` | 缩略图（图片墙/收藏页） |
| `manga://cover/<系列id>/<dynamic\|static>` | 系列封面 |

- preload 暴露 `imageUrl(path, maxWidth?)` / `coverUrl(seriesId, mode)` 给渲染端拼 URL
- **兜底**：协议失败时，阅读器/图片墙会自动回退到老的 IPC 取图（`getImage` / `getThumbnail`），所以那三个 IPC 现在虽然"没人用"但先别删
- 路径编码用 `encodeURIComponent`，解码在主进程 `decodeURIComponent`

### 2. 图片处理队列（性能关键）

`main.js` 里的 `enqueueImageJob(job, lowPriority)`：

- **高优先级 = LIFO（后进先出）**：用户正划到的图优先处理
- **低优先级 = FIFO**：后台预热整话缩略图（`warm-thumbnails` IPC）
- 一次只解码一张，每张之间 `setImmediate` 让出事件循环 → 主进程不会卡死
- 协议 handler 会把 `request.signal` 传进来，**已取消的请求直接跳过**（划走的图不再占队列）
- 普通文件走 `nativeImage.createThumbnailFromPath`（异步、原生）；压缩包内的图只能取出字节再 `createFromBuffer` 解码（nativeImage **不支持 webp**，遇到就回退原图）
- **旧封面瘦身**：`buildCover` 里若缓存文件 > 220KB，会自动缩成 640px 覆盖（早期缓存是原图，1~3MB，是漫画库卡顿的元凶）

### 3. 支持的格式与扫描规则（`scanner.js`）

- 格式：`folder`（散图）/ `cbz`(zip) / `epub` / `mobi`(含 azw3/azw) / `pdf`（仅登记）
- `scanDirectory` 分两步：先收集任务（快），再逐个解析并上报进度
- 系列名规则：**外层文件夹名优先**；文件名里若含卷号（`卷01` / `第1话` / `Vol.3`）会被拆出来当章节名，其余作系列名；结尾的 ` (1)` 副本标记会被清掉
- 文件夹里如果既有散图又有整本文件，两者都会导入

### 4. 数据模型与迁移（`db.js`）

- 表：`series` / `chapters` / `favorite_pages` / `tags` / `series_tags` / `favorite_page_tags`
- 迁移方式：`initDB()` 里用 `try { ALTER TABLE ... ADD COLUMN } catch {}` 兼容老库
  - 已加过：`series.is_favorite`、`chapters.last_read_at`、`chapters.reading_seconds`
- `series.title` 有唯一索引（建之前会先检查有没有重名，有就跳过）

### 5. 导入流程（`main.js`）

- 入口：`pick-directory` + `scan-and-import` / `pick-files` + `import-files`（**import-files 也接受文件夹路径**，拖入用的就是它）
- 进度通过 `event.sender.send('import-progress', { phase, current, total, name })` 推给界面（scan → import → done）
- `importItems()`：新文件插入；已存在（按 `file_path`）只更新页数/标题；系列拼音在入库时算好存进 `title_pinyin`（格式 `全拼|首字母`）

### 6. 阅读器约定（`src/pages/Reader.tsx`）

- 翻页模式 + 滚动模式；`userZoom` 乘在 `baseScale` 上（适应窗口/宽度/高度/原始）
- **双击画面中间**放大 2 倍（以点击位置为中心，rAF 后回滚滚动位置）；已放大时双击**任意位置**复位
- 左右各 20% 是翻页热区：**那里双击不放大**（否则快速连点翻页会误触）
- 左键拖动平移：内容超出容器才生效；拖动过会抑制随后的 click（不误翻页）
- 工具栏**默认不显示**，鼠标一动（或滚轮）出现，静止 3 秒收起；`F` 键彻底隐藏/恢复
- 换话：`[` / `]` + 工具栏按钮；到本章首尾自动切话
- 阅读时长：只在窗口可见且聚焦时每秒 +1，每 15 秒 / 切话 / 离开时调 `add-reading-time` 落库
- **旋转**：`,` 左转 90° / `.` 右转 90° / `R` 复位；用 CSS `transform: rotate()`，
  外面套一个"转完之后宽高"的盒子（转了 90/270 时 `rotatedSize` 宽高互换，
  缩放按转完的比例算）。手动旋转按**图片路径**记在 `localStorage`
  （`readerPageRotations` / `readerSpreadNoAuto`，上限 4000 条）
- **跨页自动转正**：见下面 §11

### 7. 导航与返回（`src/App.tsx`）

- `route` 是单层状态（不是栈），阅读器路由带 `from: RouteOrigin` + `wallSingle`
- 返回逻辑：**从哪进的阅读器就回哪**（home / favorites / library / seriesDetail / imageWall）
- 单话漫画：图片墙返回时直接回漫画库（不再绕系列详情）
- 侧边栏：普通页面常驻；**只有阅读器/图片墙**用抽屉模式（默认收起、鼠标移到左边缘 8px 热区滑出）

### 8. 漫画库（`src/pages/Library.tsx`）

- 视图设置存 `localStorage['libraryView']`：`{ mode: 'grid'|'list', cardSize, sortBy, sortDir }`
- Ctrl+滚轮缩放卡片：**只在按住 Ctrl 期间**挂非 passive 的 wheel 监听（平时挂会拖慢滚动）
- 排序：添加时间 / 漫画页数 / 首字母（拼音）/ 上次阅读；`page_count`、`reading_seconds`、`last_read_at` 由 `list-series` / `search-series` 聚合返回
- 上次阅读兜底：**有进度但没时间戳**的老数据用 `created_at` 顶替；完全没读过的是 NULL

### 9. 右键菜单与文件定位

- `context-menu` IPC：传 `[{id,label}|{separator:true}]`，主进程用 `Menu.popup` 弹**原生菜单**，resolve 被点中的 `id`
- `reveal-path`：文件 → `shell.showItemInFolder`（资源管理器里选中）；文件夹 → `shell.openPath`
- `copy-text`：剪贴板；`get-chapter`：右键菜单需要章节的 `file_path`
- 入口：图片墙（图上/空白）、漫画库（卡片/文本行）、阅读器

### 10. 拖入导入

- 根 div 上监听 dragenter/over/leave/drop，显示全屏虚线提示
- **Electron 32+ 没有 `file.path` 了**，必须用 preload 暴露的 `webUtils.getPathForFile(file)`
- 从压缩软件/浏览器拖出来的虚拟文件拿不到路径 → 弹提示让用户先解压

### 11. 跨页自动转正（`get-chapter-image-sizes` + `Reader.tsx`）

**规律（用真实样本核对过，别再重新猜）**：Kmoe 这批 mobi 里的跨页，
是**把跨页逆时针转 90° 存进去的**，正解统一顺时针转 90°。
例：浪客行卷02 第58页（1440×1845）、浪客行卷13 第6/7/12/47/54/61/74/79/82 页、
烙印战士卷10 第41页、卷34 第9/10/11 页 —— 全部转正核对过。

**判定规则**（前端 `spreadFlags`，纯几何）：设 `r0` = 本话竖版页比例的中位数，
某页比例 `r = w/h` 命中条件：`0.5 < r < 0.95`（竖着存的）、`r ≥ 1.03·r0`（比正常页宽）、
`|1/r − 2·r0| / (2·r0) ≤ 0.05`（转正后正好"两页并排"）、
`bytes/(w·h) ≥ 0.06`（排除版权页/说明页，这种页只有 40~60KB）。
一话命中超过 50% 时整话停用（判定不可信的兜底）。

**已知局限**（别再花时间试）：
- 漏判：跨页和普通页尺寸完全一样的（烙印战士卷12 的 98/110 页，1110×1600 vs 1109×1600），
  以及跨页比例偏了 6~10% 的卷（卷37 直接 0 命中）
- 误判：跨页特别多的卷（卷34 命中 57 页）看着像误判，但实测 9/10/11 等确实是跨页
- 试过但**无效**的特征：中缝暗线/亮线强度、文字排版方向自相关（漫画里全挤在 0.8~0.95，无区分度）

**IPC**：`get-chapter-image-sizes(chapterId)` → `[{w,h,bytes}|null]`，
只读文件头（JPEG SOF / PNG / GIF / BMP / WEBP）不解码整图，
结果按 `chapterId + 文件 mtime/size` 缓存。只实现了 `folder` 和 `mobi`；
`cbz/epub/pdf` 返回 `null`（前端就不做自动矫正，手动旋转仍可用）。
实测：237 页 MOBI 首次 154ms、缓存后 1ms；文件夹格式 225ms。

## 三、本地测试脚本

在 WSL 的 `/tmp/netest/` 下（**重启 WSL/清理 /tmp 后会丢，需要时可以让 Codex 重建**）。思路都是：用假的 `electron` 模块（stub `app/ipcMain/BrowserWindow/dialog/nativeImage/protocol/shell/Menu/clipboard/webUtils`）require 真实的 `electron/main.js`，然后直接调 IPC handler。

| 脚本 | 覆盖 |
| --- | --- |
| `test.js` | 缩略图 IPC + 封面缓存 |
| `proto-test.js` | `manga://` 协议取原图/缩略图、坏路径 404、中文路径 |
| `cover-test.js` | 封面（IPC + 协议）、`series.title` 唯一索引 |
| `tag-test.js` | 标签 CRUD、级联删除、标签+关键词组合筛选 |
| `progress-test.js` | 导入进度事件序列 + 重复导入 |
| `pages-test.js` | `page_count` 聚合 |
| `time-test.js` | 阅读时长上报 + 老库迁移（ALTER TABLE） |
| `lastread-test.js` | 上次阅读兜底（读过无时间戳 / 没读过） |
| `dnd-test.js` | 目录导入、`get-chapter`、`reveal-path`、`context-menu`、`copy-text` |
| `perf-test.js` | 图片队列 LIFO 优先级、已取消请求跳过、后台预热 |

跑法：`node /tmp/netest/<名字>.js`（在项目目录下跑，脚本里写死了真实样本 `E:\MANGA\虫师\[Kmoe][蟲師]卷01.mobi`）。

## 四、踩过的坑（别再踩）

1. **PowerShell/批处理脚本别用 UTF-8 无 BOM 写中文**：Windows PowerShell 5.1 会按 GBK 读，中文会把换行吃掉导致语法错误（`.bat` 里 `goto` 标签配 LF 换行也会失效，要 CRLF）。
2. **桌面上的 `.bat/.ps1/.txt` 会被安全软件清理掉**（用户机器实测），要放脚本就放 `D:\CodexTools\` 或用 `%TEMP%`。
3. **preload 的改动必须重启**，只刷新页面不会加载新的 preload。
4. **`loading` 状态别用来"挡住" `<img>` 的渲染**：图不渲染就永远不会 onLoad，会一直卡在"加载中"（阅读器踩过一次）。
5. 图片缩放的 MIME 用 `image/jpeg`（不是 `image/jpg`）。
6. `protocol.handle` 里返回 `new Response(undefined)` 之类的空 body 会报错，取消时返回 `new Response(null, { status: 404 })`。

## 五、待办 / 待决策

**项目相关**

- [ ] 把这一批改动写进 `CHANGELOG.md`（准备 **v0.2.1**）并推送到 GitHub（仓库：<https://github.com/Zzhouyuh/manga-manager>，分支 `main`）
- [ ] 仓库是 **public**，要私有自己去 Settings → Change visibility
- [ ] `src/pages/Reader.tsx.bak` 是旧备份（`.gitignore` 里有 `*.bak`，不会上传），可删
- [ ] 三个取图 IPC（`getImage` / `getThumbnail` / `getSeriesCover`）在协议稳定后可删 —— 目前留着当兜底
- [ ] 旧库合并：`%APPDATA%\manga-manager`（老的 33 本，含 3 张页面收藏）要不要并进 `%APPDATA%\MangaManager`
- [ ] 可选功能：多标签筛选、标签颜色自选、阅读器页码跳转输入框、用虚拟滚动优化超大漫画库（几百本以上时卡片 DOM 太多）

**环境相关（不影响开发）**

- [ ] 之前排查过的虚拟化/网络问题：结论是**迅雷 `XLWFP` 劫持驱动 + 网卡卸载特性**导致浏览器间歇性 `ERR_CONNECTION_REFUSED`；相关脚本在 `D:\CodexTools\`（`game-mode.bat` / `codex-mode.bat` / `status.bat`，切换 `hypervisorlaunchtype`，**每次切换都要重启**）
