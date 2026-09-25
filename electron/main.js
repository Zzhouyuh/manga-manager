const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { initDB, getDB } = require('./db');
const { scanDirectory } = require('./scanner');
const AdmZip = require('adm-zip');
const { pinyin } = require('pinyin-pro');


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
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// ==================== 工具 ====================

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i;

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
        const zip = new AdmZip(filePath);
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
    } else if (chapter.format === 'epub') {
        // ⭐ epub 封面：取内部第一张图片
        try {
            const zip = new AdmZip(chapter.file_path);
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

function getCoverCachePath(seriesId, ext = 'jpg') {
    return path.join(getCoversDir(), `${seriesId}.${ext}`);
}

function findExistingCover(seriesId) {
    const dir = getCoversDir();
    const prefix = `${seriesId}.`;
    const files = fs.readdirSync(dir).filter(f => f.startsWith(prefix));
    return files.length > 0 ? path.join(dir, files[0]) : null;
}

function deleteCoverCache(seriesId) {
    const cached = findExistingCover(seriesId);
    if (cached) {
        try { fs.unlinkSync(cached); } catch { /* ignore */ }
    }
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
            const zip = new AdmZip(chapter.file_path);
            return zip.getEntries()
                .filter(e => IMAGE_EXT.test(e.entryName))
                .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }))
                .map((e, i) => ({
                    name: path.basename(e.entryName),
                    path: `cbz::${chapter.file_path}::${e.entryName}`,
                    index: i,
                }));
        } catch { return []; }
    }
    return [];
}

function getImageAsDataUrl(filePath) {
    try {
        if (filePath.startsWith('cbz::')) {
            const [, zipPath, entryName] = filePath.split('::');
            const zip = new AdmZip(zipPath);
            const entry = zip.getEntry(entryName);
            if (!entry) return null;
            const data = entry.getData();
            const ext = path.extname(entryName).slice(1).toLowerCase();
            return `data:image/${ext};base64,${data.toString('base64')}`;
        }
        const ext = path.extname(filePath).slice(1).toLowerCase();
        const data = fs.readFileSync(filePath);
        return `data:image/${ext};base64,${data.toString('base64')}`;
    } catch (e) {
        console.warn('读图失败:', filePath, e.message);
        return null;
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

ipcMain.handle('scan-and-import', async (_event, dirPath) => {
    try {
        const items = await scanDirectory(dirPath);
        const db = getDB();
        const findSeries = db.prepare('SELECT id FROM series WHERE title = ?');
        const insertSeries = db.prepare('INSERT INTO series (title, title_pinyin) VALUES (?, ?)');
        const insertChapter = db.prepare(`
      INSERT OR IGNORE INTO chapters
      (series_id, title, chapter_number, file_path, format, page_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

        let imported = 0;
        const cache = new Map();
        for (const item of items) {
            let sid = cache.get(item.seriesTitle);
            if (!sid) {
                const row = findSeries.get(item.seriesTitle);
                if (row) sid = row.id;
                else sid = insertSeries.run(item.seriesTitle, '').lastInsertRowid;
                cache.set(item.seriesTitle, sid);
            }
            const r = insertChapter.run(sid, item.chapterTitle, item.chapterNumber,
                item.filePath, item.format, item.pageCount);
            if (r.changes > 0) imported++;
        }
        return { success: true, total: items.length, imported };
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
    const cached = findExistingCover(seriesId);
    if (cached) {
        try {
            const ext = path.extname(cached).slice(1).toLowerCase();
            const data = fs.readFileSync(cached);
            return `data:image/${ext};base64,${data.toString('base64')}`;
        } catch { /* ignore */ }
    }

    const db = getDB();
    let chapter = null;

    if (mode === 'dynamic') {
        chapter = db.prepare(`
      SELECT * FROM chapters
      WHERE series_id = ? AND last_read_page > 0
      ORDER BY created_at DESC LIMIT 1
    `).get(seriesId);
    }
    if (!chapter) {
        chapter = db.prepare(`
      SELECT * FROM chapters WHERE series_id = ?
      ORDER BY chapter_number, title LIMIT 1
    `).get(seriesId);
    }
    if (!chapter) return null;

    const raw = getChapterCoverRaw(chapter);
    if (!raw) return null;

    try {
        const cachePath = getCoverCachePath(seriesId, raw.ext);
        fs.writeFileSync(cachePath, raw.buffer);
    } catch (e) { /* ignore */ }

    return `data:image/${raw.ext};base64,${raw.buffer.toString('base64')}`;
});

ipcMain.handle('list-chapter-images', async (_event, chapterId) => {
    const db = getDB();
    const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(chapterId);
    if (!chapter) return [];

    // ⭐ epub
    if (chapter.format === 'epub') {
        const { parseEpub } = require('./epub');
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

ipcMain.handle('get-image', async (_event, imagePath) => {
    // ⭐ epub
    if (imagePath.startsWith('epub::')) {
        const parts = imagePath.split('::');
        const epubPath = parts[1];
        const href = parts.slice(2).join('::');   // href 可能含 ::
        const { extractEpubImage } = require('./epub');
        const result = await extractEpubImage(epubPath, href);
        if (!result.success) return null;
        return `data:image/${result.ext};base64,${result.buffer.toString('base64')}`;
    }
    return getImageAsDataUrl(imagePath);
});

ipcMain.handle('update-progress', (_event, chapterId, page) => {
    const db = getDB();
    db.prepare(`UPDATE chapters SET last_read_page = ?, is_read = ? WHERE id = ?`)
        .run(page, page > 0 ? 1 : 0, chapterId);
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
    ORDER BY c.created_at DESC
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

ipcMain.handle('search-series', (_event, keyword) => {
    const db = getDB();
    const kw = (keyword || '').trim().toLowerCase();
    const all = db.prepare('SELECT * FROM series ORDER BY title').all();

    if (!kw) {
        return all.map(s => ({
            ...s,
            chapter_count: db.prepare('SELECT COUNT(*) AS c FROM chapters WHERE series_id = ?').get(s.id).c,
        }));
    }

    const matched = all.filter(s => {
        const title = (s.title || '').toLowerCase();
        if (title.includes(kw)) return true;
        const { full, abbr } = toPinyin(s.title || '');
        return full.includes(kw) || abbr.includes(kw);
    });

    return matched.map(s => ({
        ...s,
        chapter_count: db.prepare('SELECT COUNT(*) AS c FROM chapters WHERE series_id = ?').get(s.id).c,
    }));
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
// ==================== ⭐ epub 支持 ====================
const { parseEpub, extractEpubImage } = require('./epub');

// 测试接口：解析 epub，返回图片列表
ipcMain.handle('epub-list-images', async (_event, epubPath) => {
    const result = await parseEpub(epubPath);
    if (!result.success) return { success: false, error: result.error };
    return {
        success: true,
        images: result.images.map(img => ({
            name: img.name,
            path: `epub::${epubPath}::${img.href}`,
            index: img.index,
        })),
    };
});

// 测试接口：从 epub 提取单张图片
ipcMain.handle('epub-get-image', async (_event, epubPath, href) => {
    const result = await extractEpubImage(epubPath, href);
    if (!result.success) return null;
    return `data:image/${result.ext};base64,${result.buffer.toString('base64')}`;
});