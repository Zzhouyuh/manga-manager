const { app, BrowserWindow, ipcMain, dialog, nativeImage, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { initDB, getDB } = require('./db');
const { scanDirectory, buildItemFromFile } = require('./scanner');
const { parseEpub, extractEpubImage } = require('./epub');
const { parseMobi, extractMobiImage } = require('./mobi');
const { getZip } = require('./zipcache');
const { pinyin } = require('pinyin-pro');

// ⭐ 固定数据目录：dev 模式和打包后的 exe 必须用同一个库。
// Electron 默认按 package.json 的 name / productName 生成目录，
// 改个名或打个包就换目录，表现就是"漫画库突然空了"。
app.setPath('userData', path.join(app.getPath('appData'), 'MangaManager'));

// ⭐ 自定义协议 manga:// ：让 <img src="manga://..."> 直接由主进程喂字节，
// 不再把每张图 base64 一遍再跨进程传（省 33% 体积 + 一次编解码 + 一次拷贝）
protocol.registerSchemesAsPrivileged([
    {
        scheme: 'manga',
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            stream: true,
            bypassCSP: true,
        },
    },
]);


let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        title: '漫画管理器v2.1',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    const isDev = !app.isPackaged;
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
    } else {
        mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
    }
    //mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
    initDB();
    ensureCoversDir();
    protocol.handle('manga', handleMangaRequest);
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// ==================== 工具 ====================

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i;

// data url 的 MIME：jpg 要写 image/jpeg，tif 要写 image/tiff
const MIME_ALIAS = { jpg: 'jpeg', jpe: 'jpeg', tif: 'tiff' };
function imageMime(ext) {
    const e = String(ext || '').toLowerCase().replace(/^\./, '');
    return `image/${MIME_ALIAS[e] || e || 'jpeg'}`;
}

function getCoversDir() {
    const dir = path.join(app.getPath('userData'), 'covers');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}
function ensureCoversDir() { getCoversDir(); }

function getFirstImageInFolder(dir) {
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const imgs = entries
            .filter(e => !e.isDirectory() && IMAGE_EXT.test(e.name))
            .map(e => path.join(dir, e.name))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        if (imgs.length > 0) return imgs[0];
        for (const e of entries) {
            if (e.isDirectory()) {
                const f = getFirstImageInFolder(path.join(dir, e.name));
                if (f) return f;
            }
        }
    } catch (e) { /* ignore */ }
    return null;
}

function getFirstImageInZip(filePath) {
    try {
        const zip = getZip(filePath);
        if (!zip) return null;
        const imgs = zip.getEntries()
            .filter(e => IMAGE_EXT.test(e.entryName))
            .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }));
        if (imgs.length === 0) return null;
        const entry = imgs[0];
        return {
            buffer: entry.getData(),
            ext: path.extname(entry.entryName).slice(1).toLowerCase(),
        };
    } catch (e) { return null; }
}

function getChapterCoverRaw(chapter) {
    if (chapter.format === 'folder') {
        const img = getFirstImageInFolder(chapter.file_path);
        if (!img) return null;
        try {
            return { buffer: fs.readFileSync(img), ext: path.extname(img).slice(1).toLowerCase() };
        } catch { return null; }
    } else if (chapter.format === 'cbz') {
        return getFirstImageInZip(chapter.file_path);
    } else if (chapter.format === 'mobi') {
        // ⭐ mobi / azw3：直接取内部第一张图
        const img = extractMobiImage(chapter.file_path, 0);
        return img.success ? { buffer: img.buffer, ext: img.ext } : null;
    } else if (chapter.format === 'epub') {
        // ⭐ epub 封面：取内部第一张图片
        try {
            const zip = getZip(chapter.file_path);
            if (!zip) return null;
            const entries = zip.getEntries()
                .filter(e => !e.isDirectory && IMAGE_EXT.test(e.entryName))
                .filter(e => !/^META-INF\//i.test(e.entryName))
                .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }));
            if (entries.length === 0) return null;
            const first = entries[0];
            return {
                buffer: first.getData(),
                ext: path.extname(first.entryName).slice(1).toLowerCase() || 'jpg',
            };
        } catch (e) {
            console.warn('[封面] epub 提取失败:', e.message);
            return null;
        }
    }
    return null;
}

// 封面缓存 key：静态封面用 seriesId，动态封面用 seriesId + 章节 id
function coverCachePath(key, ext = 'jpg') {
    return path.join(getCoversDir(), `${key}.${ext}`);
}

function findCoverCache(key) {
    const dir = getCoversDir();
    const files = fs.readdirSync(dir).filter(f => f.startsWith(`${key}.`));
    return files.length > 0 ? path.join(dir, files[0]) : null;
}

// 删掉某个系列的所有封面缓存（静态的 + 各章节的动态封面）
function deleteCoverCache(seriesId) {
    const dir = getCoversDir();
    for (const f of fs.readdirSync(dir)) {
        if (f.startsWith(`${seriesId}.`) || f.startsWith(`${seriesId}_c`)) {
            try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
        }
    }
}

function fileToDataUrl(filePath) {
    const ext = path.extname(filePath).slice(1).toLowerCase() || 'jpg';
    const data = fs.readFileSync(filePath);
    return `data:${imageMime(ext)};base64,${data.toString('base64')}`;
}

function listChapterImages(chapter) {
    if (chapter.format === 'folder') {
        const imgs = [];
        (function walk(dir) {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const e of entries) {
                const full = path.join(dir, e.name);
                if (e.isDirectory()) walk(full);
                else if (IMAGE_EXT.test(e.name)) imgs.push(full);
            }
        })(chapter.file_path);
        return imgs
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
            .map((p, i) => ({ name: path.basename(p), path: p, index: i }));
    } else if (chapter.format === 'cbz') {
        try {
            const zip = getZip(chapter.file_path);
            if (!zip) return [];
            return zip.getEntries()
                .filter(e => IMAGE_EXT.test(e.entryName))
                .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }))
                .map((e, i) => ({
                    name: path.basename(e.entryName),
                    path: `cbz::${chapter.file_path}::${e.entryName}`,
                    index: i,
                }));
        } catch { return []; }
    } else if (chapter.format === 'mobi') {
        // ⭐ mobi / azw3：按 record 顺序把图片列出来
        const info = parseMobi(chapter.file_path);
        if (!info.success) return [];
        return info.images.map(img => ({
            name: img.name,
            path: `mobi::${chapter.file_path}::${img.index}`,
            index: img.index,
        }));
    }
    return [];
}

// 把 "cbz::路径::条目" 这种伪路径拆开（Windows 路径里不可能出现 ::）
function splitPseudoPath(pseudoPath) {
    const sep = pseudoPath.indexOf('::');
    const kind = pseudoPath.slice(0, sep);
    const rest = pseudoPath.slice(sep + 2);
    const sep2 = rest.indexOf('::');
    return {
        kind,
        filePath: sep2 === -1 ? rest : rest.slice(0, sep2),
        extra: sep2 === -1 ? '' : rest.slice(sep2 + 2),
    };
}

/**
 * 统一读图：不管是文件夹里的散图、cbz/zip 里的条目、mobi 的 record，
 * 还是 epub 里的图片，都返回 { buffer, ext }
 */
async function readImageBuffer(imagePath) {
    try {
        if (imagePath.startsWith('cbz::') || imagePath.startsWith('mobi::') || imagePath.startsWith('epub::')) {
            const { kind, filePath: realPath, extra } = splitPseudoPath(imagePath);

            if (kind === 'mobi') {
                const img = extractMobiImage(realPath, parseInt(extra, 10));
                return img.success ? { buffer: img.buffer, ext: img.ext } : null;
            }
            if (kind === 'epub') {
                const r = await extractEpubImage(realPath, extra);
                return r.success ? { buffer: r.buffer, ext: r.ext } : null;
            }
            const zip = getZip(realPath);
            if (!zip) return null;
            const entry = zip.getEntry(extra);
            if (!entry) return null;
            return {
                buffer: entry.getData(),
                ext: path.extname(extra).slice(1).toLowerCase() || 'jpg',
            };
        }
        return {
            buffer: fs.readFileSync(imagePath),
            ext: path.extname(imagePath).slice(1).toLowerCase() || 'jpg',
        };
    } catch (e) {
        console.warn('[读图] 失败:', imagePath, e.message);
        return null;
    }
}

async function getImageAsDataUrl(imagePath) {
    const raw = await readImageBuffer(imagePath);
    if (!raw) return null;
    return `data:${imageMime(raw.ext)};base64,${raw.buffer.toString('base64')}`;
}

// ==================== ⭐ 缩略图 ====================

function getThumbsDir() {
    const dir = path.join(app.getPath('userData'), 'thumbs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

// 源文件（压缩包/电子书本体）的修改时间，用来让缩略图缓存自动失效
function sourceStamp(imagePath) {
    try {
        const real = imagePath.startsWith('cbz::') || imagePath.startsWith('mobi::') || imagePath.startsWith('epub::')
            ? splitPseudoPath(imagePath).filePath
            : imagePath;
        const st = fs.statSync(real);
        return `${st.mtimeMs}-${st.size}`;
    } catch {
        return '0';
    }
}

// 把原图缩到指定宽度（返回 jpeg buffer）；失败或不支持就返回 null
function shrinkToJpeg(buffer, width, quality = 78) {
    try {
        const img = nativeImage.createFromBuffer(buffer);
        if (img.isEmpty()) return null;
        const size = img.getSize();
        const out = size.width > width ? img.resize({ width, quality: 'good' }) : img;
        const jpeg = out.toJPEG(quality);
        return jpeg && jpeg.length > 0 ? jpeg : null;
    } catch (e) {
        console.warn('[缩略图] 缩放失败:', e.message);
        return null;
    }
}

ipcMain.handle('get-thumbnail', async (_event, imagePath, maxWidth = 320) => {
    try {
        const got = await getThumbnailBuffer(imagePath, maxWidth);
        if (!got) return null;
        return `data:${got.mime};base64,${got.buffer.toString('base64')}`;
    } catch (e) {
        console.warn('[缩略图] 出错:', e.message);
        return null;
    }
});

/**
 * 缩略图取字节（带磁盘缓存），给 IPC 和 manga:// 协议共用
 * 返回 { buffer, mime } 或 null
 */
async function getThumbnailBuffer(imagePath, maxWidth = 320) {
    const width = Math.max(48, Math.min(1200, parseInt(maxWidth, 10) || 320));
    const key = crypto.createHash('sha1')
        .update(`${imagePath}|${width}|${sourceStamp(imagePath)}`)
        .digest('hex');
    const cacheFile = path.join(getThumbsDir(), `${key}.jpg`);

    if (fs.existsSync(cacheFile)) {
        try {
            return { buffer: fs.readFileSync(cacheFile), mime: 'image/jpeg' };
        } catch { /* 缓存读失败就重新生成 */ }
    }

    const raw = await readImageBuffer(imagePath);
    if (!raw) return null;

    const jpeg = shrinkToJpeg(raw.buffer, width);
    if (jpeg) {
        try { fs.writeFileSync(cacheFile, jpeg); } catch { /* ignore */ }
        return { buffer: jpeg, mime: 'image/jpeg' };
    }

    // 兜底：gif/webp/bmp 或 nativeImage 不支持时，直接用原图
    return { buffer: raw.buffer, mime: imageMime(raw.ext) };
}

/**
 * manga://img/<encodeURIComponent(图片路径)>       → 原图
 * manga://thumb/<宽度>/<encodeURIComponent(路径)>  → 缩略图
 * manga://cover/<系列id>/<dynamic|static>          → 系列封面
 */
async function handleMangaRequest(request) {
    try {
        const url = new URL(request.url);
        const kind = url.hostname;
        const parts = url.pathname.replace(/^\/+/, '').split('/');

        if (kind === 'cover') {
            const seriesId = parseInt(parts[0], 10);
            const mode = parts[1] === 'static' ? 'static' : 'dynamic';
            const cover = buildCover(seriesId, mode);
            if (!cover) return new Response(null, { status: 404 });
            if (cover.file) {
                const ext = path.extname(cover.file).slice(1).toLowerCase() || 'jpg';
                return new Response(fs.readFileSync(cover.file), {
                    status: 200,
                    headers: { 'content-type': imageMime(ext), 'cache-control': 'max-age=60' },
                });
            }
            return new Response(cover.buffer, {
                status: 200,
                headers: { 'content-type': cover.mime, 'cache-control': 'max-age=60' },
            });
        }

        let imagePath;
        if (kind === 'thumb') {
            const width = parseInt(parts.shift(), 10) || 320;
            imagePath = decodeURIComponent(parts.join('/'));
            const got = await getThumbnailBuffer(imagePath, width);
            if (!got) return new Response(null, { status: 404 });
            return new Response(got.buffer, {
                status: 200,
                headers: { 'content-type': got.mime, 'cache-control': 'max-age=3600' },
            });
        }

        imagePath = decodeURIComponent(parts.join('/'));
        const raw = await readImageBuffer(imagePath);
        if (!raw) return new Response(null, { status: 404 });
        return new Response(raw.buffer, {
            status: 200,
            headers: { 'content-type': imageMime(raw.ext), 'cache-control': 'max-age=3600' },
        });
    } catch (e) {
        console.warn('[manga 协议] 出错:', request.url, e.message);
        return new Response(null, { status: 500 });
    }
}

// ==================== IPC ====================

ipcMain.handle('pick-directory', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: '选择漫画文件夹',
    });
    return r.canceled ? null : r.filePaths[0];
});

// ⭐ 选文件导入（mobi / azw3 / epub / cbz ...），可多选
ipcMain.handle('pick-files', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'multiSelections'],
        title: '选择漫画文件（可多选）',
        filters: [
            { name: '漫画文件', extensions: ['mobi', 'azw3', 'azw', 'epub', 'cbz', 'zip', 'pdf'] },
            { name: 'MOBI / AZW', extensions: ['mobi', 'azw3', 'azw'] },
            { name: '所有文件', extensions: ['*'] },
        ],
    });
    return r.canceled ? [] : r.filePaths;
});

/**
 * 统一入库
 * 新文件 → 插入；已存在的文件 → 只在页数/标题变了时更新（不重复建章节）
 */
function importItems(items, onProgress) {
    const db = getDB();
    const findSeries = db.prepare('SELECT id, title_pinyin FROM series WHERE title = ?');
    const insertSeries = db.prepare('INSERT INTO series (title, title_pinyin) VALUES (?, ?)');
    const updateSeriesPinyin = db.prepare('UPDATE series SET title_pinyin = ? WHERE id = ?');
    const findChapter = db.prepare('SELECT id, title, page_count FROM chapters WHERE file_path = ?');
    const insertChapter = db.prepare(`
      INSERT INTO chapters
      (series_id, title, chapter_number, file_path, format, page_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const updateChapter = db.prepare(`
      UPDATE chapters SET title = ?, chapter_number = ?, page_count = ? WHERE id = ?
    `);

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    const failures = [];
    const seriesCache = new Map();

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        try {
            if (onProgress) {
                try {
                    onProgress({ current: i + 1, total: items.length, name: path.basename(item.filePath) });
                } catch { /* ignore */ }
            }
            if (item.warning) failures.push({ file: item.filePath, reason: item.warning });

            let sid = seriesCache.get(item.seriesTitle);
            if (!sid) {
                const row = findSeries.get(item.seriesTitle);
                if (row) {
                    sid = row.id;
                    // 老数据拼音是空的，顺手补上，之后搜索不用每次现算
                    if (!row.title_pinyin) {
                        const py = toPinyin(item.seriesTitle);
                        updateSeriesPinyin.run(`${py.full}|${py.abbr}`, sid);
                    }
                } else {
                    const py = toPinyin(item.seriesTitle);
                    sid = insertSeries.run(item.seriesTitle, `${py.full}|${py.abbr}`).lastInsertRowid;
                }
                seriesCache.set(item.seriesTitle, sid);
            }

            const exists = findChapter.get(item.filePath);
            if (exists) {
                if (exists.page_count !== item.pageCount || exists.title !== item.chapterTitle) {
                    updateChapter.run(item.chapterTitle, item.chapterNumber, item.pageCount, exists.id);
                    updated++;
                } else {
                    skipped++;
                }
                continue;
            }

            insertChapter.run(sid, item.chapterTitle, item.chapterNumber,
                item.filePath, item.format, item.pageCount);
            imported++;
        } catch (err) {
            failures.push({ file: item.filePath, reason: err.message });
        }
    }

    return { success: true, total: items.length, imported, updated, skipped, failures };
}

// 给渲染进程推进度：{ phase: 'scan' | 'import' | 'done', current, total, name }
function makeProgressSender(event) {
    return (phase, p) => {
        try {
            event.sender.send('import-progress', { phase, current: 0, total: 0, name: '', ...(p || {}) });
        } catch { /* 窗口关了就算了 */ }
    };
}

ipcMain.handle('scan-and-import', async (event, dirPath) => {
    try {
        const send = makeProgressSender(event);
        const items = await scanDirectory(dirPath, (p) => send('scan', p));
        const result = importItems(items, (p) => send('import', p));
        send('done', { current: items.length, total: items.length });
        return result;
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('import-files', async (event, filePaths) => {
    try {
        const send = makeProgressSender(event);
        const list = Array.isArray(filePaths) ? filePaths : [filePaths];
        const items = [];
        for (let i = 0; i < list.length; i++) {
            send('scan', { current: i + 1, total: list.length, name: path.basename(list[i]) });
            const item = buildItemFromFile(list[i]);
            if (item) items.push(item);
            await new Promise(resolve => setImmediate(resolve));
        }
        if (items.length === 0) {
            return { success: false, error: '这些文件都不是支持的漫画格式（mobi / azw3 / epub / cbz / pdf）' };
        }
        const result = importItems(items, (p) => send('import', p));
        send('done', { current: items.length, total: items.length });
        return result;
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('list-series', () => {
    const db = getDB();
    return db.prepare(`
        SELECT s.*,
               (SELECT COUNT(*) FROM chapters WHERE series_id = s.id) AS chapter_count,
               (SELECT id FROM chapters WHERE series_id = s.id ORDER BY chapter_number LIMIT 1) AS first_chapter_id,
      (SELECT id FROM chapters WHERE series_id = s.id AND last_read_page > 0
        ORDER BY created_at DESC LIMIT 1) AS last_read_chapter_id
        FROM series s
        ORDER BY s.is_favorite DESC, s.created_at DESC
    `).all();
});

ipcMain.handle('list-chapters', (_event, seriesId) => {
    const db = getDB();
    return db.prepare(`
    SELECT * FROM chapters WHERE series_id = ?
    ORDER BY chapter_number, title
  `).all(seriesId);
});

ipcMain.handle('get-series-cover', (_event, seriesId, mode = 'dynamic') => {
    const cover = buildCover(seriesId, mode);
    if (!cover) return null;
    if (cover.file) {
        try { return fileToDataUrl(cover.file); } catch { /* ignore */ }
    }
    return `data:${cover.mime};base64,${cover.buffer.toString('base64')}`;
});

/**
 * 生成/读取某个系列的封面（带缓存），给 IPC 和 manga:// 协议共用
 * 返回 { file } 或 { buffer, mime } 或 null
 */
function buildCover(seriesId, mode = 'dynamic') {
    const db = getDB();

    // 先决定用哪一章当封面：动态模式优先「最近在读」，否则第一卷
    let chapter = null;
    if (mode === 'dynamic') {
        chapter = db.prepare(`
      SELECT * FROM chapters
      WHERE series_id = ? AND last_read_page > 0
      ORDER BY COALESCE(last_read_at, created_at) DESC LIMIT 1
    `).get(seriesId);
    }
    if (!chapter) {
        chapter = db.prepare(`
      SELECT * FROM chapters WHERE series_id = ?
      ORDER BY chapter_number, title LIMIT 1
    `).get(seriesId);
    }
    if (!chapter) return null;

    // 缓存 key：静态封面对整个系列有效；动态封面跟章节绑定，
    // 只有换了「正在读的那一卷」才会重新生成
    const cacheKey = mode === 'dynamic' ? `${seriesId}_c${chapter.id}` : `${seriesId}`;
    const cached = findCoverCache(cacheKey);
    if (cached) return { file: cached };

    const raw = getChapterCoverRaw(chapter);
    if (!raw) return null;

    // 封面上卡片只显示 200px 左右，缓存里存缩小版即可（原来是原图，一张几百 KB）
    const shrunk = shrinkToJpeg(raw.buffer, 640, 82);
    const coverBuffer = shrunk || raw.buffer;
    const coverExt = shrunk ? 'jpg' : raw.ext;

    try {
        fs.writeFileSync(coverCachePath(cacheKey, coverExt), coverBuffer);
    } catch (e) { /* ignore */ }

    return { buffer: coverBuffer, mime: imageMime(coverExt) };
}

ipcMain.handle('list-chapter-images', async (_event, chapterId) => {
    const db = getDB();
    const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(chapterId);
    if (!chapter) return [];

    // ⭐ epub
    if (chapter.format === 'epub') {
        const result = await parseEpub(chapter.file_path);
        if (!result.success) return [];
        return result.images.map(img => ({
            name: img.name,
            path: `epub::${chapter.file_path}::${img.href}`,
            index: img.index,
        }));
    }

    return listChapterImages(chapter);
});

// 原图：epub / cbz / mobi / 散图都由 readImageBuffer 统一处理
ipcMain.handle('get-image', async (_event, imagePath) => getImageAsDataUrl(imagePath));

ipcMain.handle('update-progress', (_event, chapterId, page) => {
    const db = getDB();
    db.prepare(`
        UPDATE chapters
        SET last_read_page = ?, is_read = ?, last_read_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(page, page > 0 ? 1 : 0, chapterId);
    return { success: true };
});

ipcMain.handle('recent-reading', () => {
    const db = getDB();
    return db.prepare(`
    SELECT
      s.id AS series_id, s.title AS series_title,
      c.id AS chapter_id, c.title AS chapter_title,
      c.last_read_page, c.page_count, c.file_path, c.format,
      c.created_at AS chapter_created
    FROM chapters c
    JOIN series s ON s.id = c.series_id
    WHERE c.last_read_page > 0
    ORDER BY COALESCE(c.last_read_at, c.created_at) DESC
    LIMIT 12
  `).all();
});

function toPinyin(text) {
    try {
        const full = pinyin(text, { toneType: 'none', type: 'array' }).join('').toLowerCase();
        const abbr = pinyin(text, { pattern: 'first', toneType: 'none', type: 'array' }).join('').toLowerCase();
        return { full, abbr };
    } catch { return { full: '', abbr: '' }; }
}

ipcMain.handle('search-series', (_event, keyword, tagId) => {
    const db = getDB();
    const kw = (keyword || '').trim().toLowerCase();
    const all = db.prepare('SELECT * FROM series ORDER BY title').all();

    // 章节数一次查完，避免每条 series 再单独查一次
    const counts = new Map(
        db.prepare('SELECT series_id, COUNT(*) AS c FROM chapters GROUP BY series_id').all()
            .map(r => [r.series_id, r.c])
    );
    const withCount = (s) => ({ ...s, chapter_count: counts.get(s.id) || 0 });

    // ⭐ 按标签筛选
    let base = all;
    if (tagId) {
        const ids = new Set(
            db.prepare('SELECT series_id FROM series_tags WHERE tag_id = ?').all(tagId).map(r => r.series_id)
        );
        base = all.filter(s => ids.has(s.id));
    }

    if (!kw) return base.map(withCount);

    const updatePinyin = db.prepare('UPDATE series SET title_pinyin = ? WHERE id = ?');
    const matched = base.filter(s => {
        const title = (s.title || '').toLowerCase();
        if (title.includes(kw)) return true;

        // 拼音在导入时就算好存进库了（格式：全拼|首字母），
        // 老数据第一次搜索时现算一次并写回去
        let py = s.title_pinyin || '';
        if (!py.includes('|')) {
            const p = toPinyin(s.title || '');
            py = `${p.full}|${p.abbr}`;
            try { updatePinyin.run(py, s.id); } catch { /* ignore */ }
        }
        const [full = '', abbr = ''] = py.split('|');
        return full.includes(kw) || abbr.includes(kw);
    });

    return matched.map(withCount);
});

// ==================== ⭐ 标签 ====================

// 列出所有标签（带使用数量）
ipcMain.handle('list-tags', () => {
    const db = getDB();
    return db.prepare(`
    SELECT t.id, t.name, t.color,
           (SELECT COUNT(*) FROM series_tags st WHERE st.tag_id = t.id) AS series_count
    FROM tags t
    ORDER BY t.name
  `).all();
});

// 新建标签（重名直接返回已有的那条）
ipcMain.handle('create-tag', (_event, name, color) => {
    try {
        const n = String(name || '').trim();
        if (!n) return { success: false, error: '标签名不能为空' };
        const db = getDB();
        const exist = db.prepare('SELECT * FROM tags WHERE name = ?').get(n);
        if (exist) return { success: true, tag: exist, existed: true };

        const c = color || '#3b82f6';
        const r = db.prepare('INSERT INTO tags (name, color) VALUES (?, ?)').run(n, c);
        return { success: true, tag: { id: r.lastInsertRowid, name: n, color: c } };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// 删除标签（series_tags 的关联靠外键级联清理）
ipcMain.handle('delete-tag', (_event, tagId) => {
    try {
        const db = getDB();
        db.prepare('DELETE FROM tags WHERE id = ?').run(tagId);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// 某本漫画身上的标签
ipcMain.handle('get-series-tags', (_event, seriesId) => {
    const db = getDB();
    return db.prepare(`
    SELECT t.id, t.name, t.color
    FROM tags t
    JOIN series_tags st ON st.tag_id = t.id
    WHERE st.series_id = ?
    ORDER BY t.name
  `).all(seriesId);
});

// 覆盖式设置某本漫画的标签
ipcMain.handle('set-series-tags', (_event, seriesId, tagIds) => {
    const db = getDB();
    try {
        db.exec('BEGIN');
        db.prepare('DELETE FROM series_tags WHERE series_id = ?').run(seriesId);
        const ins = db.prepare('INSERT OR IGNORE INTO series_tags (series_id, tag_id) VALUES (?, ?)');
        for (const id of (tagIds || [])) ins.run(seriesId, id);
        db.exec('COMMIT');
        return { success: true };
    } catch (err) {
        try { db.exec('ROLLBACK'); } catch { /* ignore */ }
        return { success: false, error: err.message };
    }
});

// ==================== ⭐ 收藏 & 标签接口 ====================

// 1. 收藏单页
ipcMain.handle('favorite-page', async (_event, chapterId, pageIndex, imagePath) => {
    try {
        const db = getDB();
        // 如果已经收藏了，忽略
        db.prepare(`
      INSERT OR IGNORE INTO favorite_pages (chapter_id, page_index, image_path)
      VALUES (?, ?, ?)
    `).run(chapterId, pageIndex, imagePath);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// 2. 取消收藏单页
ipcMain.handle('unfavorite-page', async (_event, chapterId, pageIndex) => {
    try {
        const db = getDB();
        db.prepare(`
      DELETE FROM favorite_pages WHERE chapter_id = ? AND page_index = ?
    `).run(chapterId, pageIndex);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// 3. 检查某页是否被收藏
ipcMain.handle('is-page-favorited', async (_event, chapterId, pageIndex) => {
    const db = getDB();
    const row = db.prepare(`
    SELECT id FROM favorite_pages WHERE chapter_id = ? AND page_index = ?
  `).get(chapterId, pageIndex);
    return !!row;
});

// 4. 列出所有收藏的单页（含来源信息）
ipcMain.handle('list-favorite-pages', () => {
    const db = getDB();
    return db.prepare(`
    SELECT
      fp.id, fp.chapter_id, fp.page_index, fp.image_path, fp.note, fp.created_at,
      c.title AS chapter_title, c.format,
      s.id AS series_id, s.title AS series_title
    FROM favorite_pages fp
    JOIN chapters c ON c.id = fp.chapter_id
    JOIN series s ON s.id = c.series_id
    ORDER BY s.title, c.chapter_number, fp.page_index
  `).all();
});

// 5. 收藏/取消收藏漫画
ipcMain.handle('toggle-favorite-series', async (_event, seriesId) => {
    try {
        const db = getDB();
        const row = db.prepare('SELECT is_favorite FROM series WHERE id = ?').get(seriesId);
        if (!row) return { success: false, error: '系列不存在' };
        const newVal = row.is_favorite ? 0 : 1;
        db.prepare('UPDATE series SET is_favorite = ? WHERE id = ?').run(newVal, seriesId);
        return { success: true, is_favorite: newVal };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// 6. 列出所有收藏的漫画
ipcMain.handle('list-favorite-series', () => {
    const db = getDB();
    return db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM chapters WHERE series_id = s.id) AS chapter_count
    FROM series s
    WHERE s.is_favorite = 1
    ORDER BY s.title
  `).all();
});

// 7. 删除收藏的单页
ipcMain.handle('delete-favorite-page', async (_event, favoriteId) => {
    try {
        const db = getDB();
        db.prepare('DELETE FROM favorite_pages WHERE id = ?').run(favoriteId);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});
// ==================== ⭐ 删除接口 ====================

// 删除漫画（及其所有章节和封面缓存）
// 注意：只删数据库记录，不删本地文件（安全起见）
ipcMain.handle('delete-series', async (_event, seriesId) => {
    try {
        const db = getDB();
        // chapters 表外键 CASCADE 会自动删（前提：db.js 里开了 foreign_keys）
        db.exec('PRAGMA foreign_keys = ON');
        db.prepare('DELETE FROM series WHERE id = ?').run(seriesId);

        // 删封面缓存
        deleteCoverCache(seriesId);

        return { success: true };
    } catch (err) {
        console.error('删除失败:', err);
        return { success: false, error: err.message };
    }
});

// 删除单个章节
ipcMain.handle('delete-chapter', async (_event, chapterId) => {
    try {
        const db = getDB();
        db.prepare('DELETE FROM chapters WHERE id = ?').run(chapterId);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});
// epub 的图片列表 / 取图已经统一走 list-chapter-images + get-image（内部会用 ./epub 解析）
