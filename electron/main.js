const { app, BrowserWindow, ipcMain, dialog, nativeImage, protocol, shell, Menu, clipboard } = require('electron');
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

// ==================== ⭐ 页面尺寸（跨页自动矫正用） ====================
// 只读文件/记录的头部字节就能拿到宽高，不用整张解码
function imageSizeFromHeader(buf) {
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
        let i = 2;
        while (i < buf.length - 9) {
            if (buf[i] !== 0xff) { i++; continue; }
            const m = buf[i + 1];
            if (m === 0xda || m === 0xd9) return null;                      // 进入压缩数据，没找到 SOF
            if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
                return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
            }
            if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; }
            const len = buf.readUInt16BE(i + 2);
            if (len < 2) return null;
            i += 2 + len;
        }
        return null;
    }
    if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
        return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };        // PNG
    }
    if (buf.length > 10 && buf.toString('latin1', 0, 3) === 'GIF') {
        return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };          // GIF
    }
    if (buf.length > 26 && buf[0] === 0x42 && buf[1] === 0x4d) {
        return { w: buf.readInt32LE(18), h: Math.abs(buf.readInt32LE(22)) }; // BMP
    }
    if (buf.length > 30 && buf.toString('latin1', 0, 4) === 'RIFF'
        && buf.toString('latin1', 8, 12) === 'WEBP') {
        const fmt = buf.toString('latin1', 12, 16);
        if (fmt === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
        if (fmt === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
        if (fmt === 'VP8L') {
            const b = buf.readUInt32LE(21);
            return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
        }
    }
    return null;
}

// chapterId -> { stamp, sizes }
const sizeCache = new Map();

// 返回该话每页的 { w, h }（拿不到的一页是 null）；不支持格式返回 null
function getChapterImageSizes(chapter) {
    const key = `ch-${chapter.id}`;
    let stamp = '0';
    try {
        const st = fs.statSync(chapter.file_path);
        stamp = `${st.mtimeMs}-${st.size}`;
    } catch { /* 文件没了就用 0，下面自然会拿到空 */ }

    const cached = sizeCache.get(key);
    if (cached && cached.stamp === stamp) return cached.sizes;

    let sizes = null;
    try {
        if (chapter.format === 'folder') {
            const images = listChapterImages(chapter);
            if (images.length === 0 || images.length > 900) return null;
            sizes = images.map(im => {
                let fd = null;
                try {
                    fd = fs.openSync(im.path, 'r');
                    const fileSize = fs.fstatSync(fd).size;
                    const b = Buffer.alloc(Math.min(65536, fileSize));
                    const n = fs.readSync(fd, b, 0, b.length, 0);
                    const s = imageSizeFromHeader(b.subarray(0, n));
                    return s ? { ...s, bytes: fileSize } : null;
                } catch { return null; } finally {
                    if (fd !== null) { try { fs.closeSync(fd); } catch { /* ignore */ } }
                }
            });
        } else if (chapter.format === 'mobi') {
            const info = parseMobi(chapter.file_path);
            if (!info.success || info.images.length === 0 || info.images.length > 900) return null;
            let fd = null;
            try {
                fd = fs.openSync(chapter.file_path, 'r');
                sizes = info.images.map(img => {
                    const n = Math.min(img.length, 65536);
                    const b = Buffer.alloc(n);
                    fs.readSync(fd, b, 0, n, img.start);
                    const s = imageSizeFromHeader(b);
                    return s ? { ...s, bytes: img.length } : null;
                });
            } finally {
                if (fd !== null) { try { fs.closeSync(fd); } catch { /* ignore */ } }
            }
        }
    } catch (e) {
        console.warn('[页尺寸] 失败:', chapter.file_path, e.message);
        return null;
    }

    if (sizes) sizeCache.set(key, { stamp, sizes });
    return sizes;
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
// ⭐ 图片处理队列
// - 高优先级：后进先出（LIFO）—— 用户正划到的那些最先做
// - 低优先级：先来先做 —— 后台预热整话缩略图用
// 一次只解码一张，中间让出事件循环，主进程才不会被堵死
const highJobStack = [];
const lowJobQueue = [];
let imageJobRunning = false;

function enqueueImageJob(job, lowPriority = false) {
    return new Promise((resolve, reject) => {
        const item = { job, resolve, reject };
        if (lowPriority) lowJobQueue.push(item);
        else highJobStack.push(item);
        pumpImageJobs();
    });
}

async function pumpImageJobs() {
    if (imageJobRunning) return;
    imageJobRunning = true;
    try {
        while (highJobStack.length > 0 || lowJobQueue.length > 0) {
            const item = highJobStack.length > 0 ? highJobStack.pop() : lowJobQueue.shift();
            await new Promise(resolve => setImmediate(resolve));   // 先让主进程处理窗口/IPC 事件
            try {
                item.resolve(await item.job());
            } catch (err) {
                item.reject(err);
            }
        }
    } finally {
        imageJobRunning = false;
    }
}

async function getThumbnailBuffer(imagePath, maxWidth = 320, opts = {}) {
    const width = Math.max(48, Math.min(1200, parseInt(maxWidth, 10) || 320));
    const lowPriority = !!opts.lowPriority;
    const isAborted = typeof opts.isAborted === 'function' ? opts.isAborted : () => false;
    const key = crypto.createHash('sha1')
        .update(`${imagePath}|${width}|${sourceStamp(imagePath)}`)
        .digest('hex');
    const cacheFile = path.join(getThumbsDir(), `${key}.jpg`);

    if (fs.existsSync(cacheFile)) {
        try {
            return { buffer: fs.readFileSync(cacheFile), mime: 'image/jpeg' };
        } catch { /* 缓存读失败就重新生成 */ }
    }

    return enqueueImageJob(async () => {
        // 客户端已经不等了（划过去了 / 换章节了）→ 直接放弃，别继续占队列
        if (isAborted()) return null;

        // 排队期间可能已经被别的请求生成好了
        if (fs.existsSync(cacheFile)) {
            try { return { buffer: fs.readFileSync(cacheFile), mime: 'image/jpeg' }; } catch { /* ignore */ }
        }

        if (isAborted()) return null;
        const jpeg = await makeThumbJpeg(imagePath, width);
        if (jpeg) {
            try { fs.writeFileSync(cacheFile, jpeg); } catch { /* ignore */ }
            return { buffer: jpeg, mime: 'image/jpeg' };
        }

        // 兜底：gif/webp/bmp 或 nativeImage 不支持时，直接用原图
        const raw = await readImageBuffer(imagePath);
        if (!raw) return null;
        return { buffer: raw.buffer, mime: imageMime(raw.ext) };
    }, lowPriority);
}

/**
 * 生成缩略图 jpeg
 * - 普通文件（文件夹漫画）：用系统的异步缩略图接口，不在主进程里解码，最快
 * - 压缩包内图片（cbz / mobi / epub）：只能取出字节再解码
 */
async function makeThumbJpeg(imagePath, width) {
    const isPseudo = imagePath.startsWith('cbz::') || imagePath.startsWith('mobi::') || imagePath.startsWith('epub::');
    if (!isPseudo) {
        try {
            const img = await nativeImage.createThumbnailFromPath(imagePath, {
                width,
                height: Math.round(width * 4 / 3),
            });
            if (img && !img.isEmpty()) {
                const jpeg = img.toJPEG(78);
                if (jpeg && jpeg.length) return jpeg;
            }
        } catch { /* 失败就走下面的兜底 */ }
    }

    const raw = await readImageBuffer(imagePath);
    if (!raw) return null;
    return shrinkToJpeg(raw.buffer, width);
}

// ⭐ 把早期缓存下来的"原图级"封面缩成 640px（一次性，之后一直是小的）
const MAX_COVER_BYTES = 220 * 1024;
async function shrinkCoverFileIfNeeded(file) {
    try {
        const st = fs.statSync(file);
        if (st.size <= MAX_COVER_BYTES) return file;

        const jpeg = await enqueueImageJob(async () => {
            const buf = fs.readFileSync(file);
            const out = shrinkToJpeg(buf, 640, 82);
            return (out && out.length > 0 && out.length < st.size) ? out : null;
        });
        if (!jpeg) return file;   // webp 之类缩不了的，就保持原样

        const target = file.replace(/\.[^.\\/]+$/, '') + '.jpg';
        fs.writeFileSync(target, jpeg);
        if (target !== file) {
            try { fs.unlinkSync(file); } catch { /* ignore */ }
        }
        console.log('[封面] 旧大图已缩小:', path.basename(file), '→', Math.round(jpeg.length / 1024) + 'KB');
        return target;
    } catch (e) {
        return file;
    }
}

// ⭐ 后台预热整话缩略图（低优先级：只有用户没在等图的时候才做）
let warmToken = 0;
ipcMain.handle('warm-thumbnails', async (_event, chapterId, maxWidth = 320) => {
    try {
        const token = ++warmToken;
        const db = getDB();
        const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(chapterId);
        if (!chapter) return { success: false, error: '章节不存在' };

        const images = listChapterImages(chapter);
        if (images.length === 0) return { success: true, total: 0 };

        // 不 await：让它在后台慢慢排队
        (async () => {
            for (const img of images) {
                if (token !== warmToken) return;      // 用户已经换章节了
                try {
                    await getThumbnailBuffer(img.path, maxWidth, { lowPriority: true });
                } catch { /* ignore */ }
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            console.log('[预热] 缩略图完成:', images.length, '张');
        })();

        return { success: true, total: images.length };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

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
            const cover = await buildCover(seriesId, mode);
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
            // 浏览器如果已经放弃这个请求（图被划走了），队列里就直接跳过
            const got = await getThumbnailBuffer(imagePath, width, {
                isAborted: () => !!(request.signal && request.signal.aborted),
            });
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
            const p = list[i];
            send('scan', { current: i + 1, total: list.length, name: path.basename(p) });

            let isDir = false;
            try { isDir = fs.statSync(p).isDirectory(); } catch { /* ignore */ }

            if (isDir) {
                // ⭐ 拖进来的是文件夹 → 按「导入文件夹」的方式扫一遍
                const sub = await scanDirectory(p, (pr) => send('scan', {
                    current: i + 1, total: list.length,
                    name: `${path.basename(p)}/${pr.name}`,
                }));
                for (const it of sub) items.push(it);
            } else {
                const item = buildItemFromFile(p);
                if (item) items.push(item);
            }
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
               (SELECT COALESCE(SUM(page_count), 0) FROM chapters WHERE series_id = s.id) AS page_count,
               (SELECT COALESCE(SUM(reading_seconds), 0) FROM chapters WHERE series_id = s.id) AS reading_seconds,
               (SELECT MAX(COALESCE(last_read_at, created_at)) FROM chapters
                 WHERE series_id = s.id AND (last_read_page > 0 OR last_read_at IS NOT NULL)) AS last_read_at,
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

ipcMain.handle('get-series-cover', async (_event, seriesId, mode = 'dynamic') => {
    const cover = await buildCover(seriesId, mode);
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
async function buildCover(seriesId, mode = 'dynamic') {
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
    if (cached) {
        // 老缓存里可能是原图（几百 KB ~ 几 MB），顺手缩一下 —— 不然漫画库滚动会非常卡
        const fixed = await shrinkCoverFileIfNeeded(cached);
        return { file: fixed };
    }

    const raw = getChapterCoverRaw(chapter);
    if (!raw) return null;

    // 封面上卡片只显示 200px 左右，缓存里存缩小版即可（原来是原图，一张几百 KB）
    // 和缩略图共用队列，避免一次生成几十张封面时把主进程堵住
    const shrunk = await enqueueImageJob(async () => shrinkToJpeg(raw.buffer, 640, 82));
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

// ⭐ 每页宽高：前端用来判断"这页是不是躺倒的跨页"
ipcMain.handle('get-chapter-image-sizes', async (_event, chapterId) => {
    const db = getDB();
    const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(chapterId);
    if (!chapter) return null;
    return getChapterImageSizes(chapter);
});

// 原图：epub / cbz / mobi / 散图都由 readImageBuffer 统一处理
ipcMain.handle('get-image', async (_event, imagePath) => getImageAsDataUrl(imagePath));

// ⭐ 右键菜单：返回被点中的那一项的 id（没选就返回 null）
ipcMain.handle('context-menu', (event, items) => {
    return new Promise((resolve) => {
        let done = false;
        const finish = (id) => {
            if (done) return;
            done = true;
            resolve(id);
        };

        const template = (items || []).map((item) => {
            if (!item || item.separator) return { type: 'separator' };
            return {
                label: String(item.label || ''),
                enabled: item.enabled !== false,
                click: () => finish(item.id),
            };
        });
        if (template.length === 0) return finish(null);

        const menu = Menu.buildFromTemplate(template);
        const win = (event && event.sender) ? BrowserWindow.fromWebContents(event.sender) : null;
        menu.popup({ window: win || undefined, callback: () => finish(null) });
    });
});

// ⭐ 在资源管理器里定位文件（文件→选中它；文件夹→打开它）
ipcMain.handle('reveal-path', async (_event, target) => {
    try {
        if (!target || typeof target !== 'string') return { success: false, error: '没有路径' };
        const st = fs.statSync(target);
        if (st.isDirectory()) {
            const err = await shell.openPath(target);
            return err ? { success: false, error: err } : { success: true };
        }
        shell.showItemInFolder(target);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// ⭐ 复制文本到剪贴板
ipcMain.handle('copy-text', (_event, text) => {
    try {
        clipboard.writeText(String(text == null ? '' : text));
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// ⭐ 取单条章节记录（右键菜单需要它的 file_path）
ipcMain.handle('get-chapter', (_event, chapterId) => {
    const db = getDB();
    return db.prepare('SELECT * FROM chapters WHERE id = ?').get(chapterId) || null;
});

ipcMain.handle('update-progress', (_event, chapterId, page) => {
    const db = getDB();
    db.prepare(`
        UPDATE chapters
        SET last_read_page = ?, is_read = ?, last_read_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(page, page > 0 ? 1 : 0, chapterId);
    return { success: true };
});

// ⭐ 累计阅读时长（秒），阅读器每隔一段时间上报一次
ipcMain.handle('add-reading-time', (_event, chapterId, seconds) => {
    try {
        const s = Math.max(0, Math.round(Number(seconds) || 0));
        if (!s) return { success: true, added: 0 };
        const db = getDB();
        db.prepare(`
            UPDATE chapters
            SET reading_seconds = COALESCE(reading_seconds, 0) + ?
            WHERE id = ?
        `).run(s, chapterId);
        return { success: true, added: s };
    } catch (err) {
        return { success: false, error: err.message };
    }
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

    // 章节数 / 总页数一次查完，避免每条 series 再单独查一次
    const stats = new Map(
        db.prepare(`
      SELECT series_id,
             COUNT(*) AS c,
             COALESCE(SUM(page_count), 0) AS p,
             COALESCE(SUM(reading_seconds), 0) AS sec,
             MAX(CASE WHEN last_read_page > 0 OR last_read_at IS NOT NULL
                      THEN COALESCE(last_read_at, created_at) END) AS last
      FROM chapters GROUP BY series_id
    `).all().map(r => [r.series_id, r])
    );
    const withCount = (s) => {
        const st = stats.get(s.id);
        return {
            ...s,
            chapter_count: st ? st.c : 0,
            page_count: st ? st.p : 0,
            reading_seconds: st ? st.sec : 0,
            last_read_at: st ? st.last : null,
        };
    };

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
