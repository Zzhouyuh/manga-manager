const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { parseMobi } = require('./mobi');

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i;
const ARCHIVE_EXT = /\.(cbz|zip)$/i;
const EPUB_EXT = /\.epub$/i;
// azw / azw3 / prc 都是 MOBI 容器，用同一套解析
const MOBI_EXT = /\.(mobi|azw3?|prc)$/i;
const PDF_EXT = /\.pdf$/i;
const BOOK_EXT = /\.(cbz|zip|epub|mobi|azw3?|prc|pdf)$/i;

const IGNORE_EPUB = [
    /^mimetype$/i,
    /^META-INF\//i,
    /cover\.x?html$/i,
    /toc\.x?html$/i,
    /nav\.x?html$/i,
];

// 文件夹里找漫画文件时最多往下钻几层
const MAX_BOOK_DEPTH = 3;

/**
 * 从文件名拆出「书名」和「卷/话」
 *   [Kmoe][東京喰種Re]卷01  → { seriesTitle: '[Kmoe][東京喰種Re]', chapterTitle: '卷01', chapterNumber: 1 }
 *   我的漫画 Vol.3          → { seriesTitle: '我的漫画', chapterTitle: 'Vol.3', chapterNumber: 3 }
 *   随便一个名字            → { seriesTitle: '随便一个名字', chapterTitle: '全一话', chapterNumber: 1 }
 */
function splitSeriesAndChapter(baseName) {
    const trimmed = baseName.trim();
    const patterns = [
        /第\s*\d+(?:\.\d+)?\s*[卷巻話话册冊回]/i,          // 第01卷 / 第12话
        /[卷巻册冊]\s*\d+(?:\.\d+)?/i,                     // 卷01
        /(?:vol\.?|volume)\s*\d+(?:\.\d+)?/i,              // Vol.3 / volume 3
        /(?:^|[\s_\-])v\d{1,3}\b/i,                        // v03
    ];

    for (const re of patterns) {
        const m = trimmed.match(re);
        if (!m) continue;
        const digits = m[0].match(/\d+(?:\.\d+)?/);
        if (!digits) continue;

        const chapterTitle = m[0].trim();
        // 把卷号从书名里去掉，再清掉残留的分隔符 / 括号
        let seriesTitle = trimmed.slice(0, m.index) + trimmed.slice(m.index + m[0].length);
        seriesTitle = seriesTitle
            .replace(/\s+/g, ' ')
            .replace(/[\s\-_·]+$/g, '')
            .replace(/^[\s\-_·]+/g, '')
            .replace(/[\[(（【]\s*[\])）】]$/g, '')
            // 浏览器重复下载会变成「…卷16 (1).mobi」，去掉结尾的 (1) 才不会分裂成两个系列
            .replace(/\s*[(（]\d+[)）]$/g, '')
            .trim();

        // 去掉卷号后名字太短，说明卷号本来就在名字里，那就不拆了
        if (seriesTitle.length < 2) {
            return { seriesTitle: trimmed, chapterTitle: '全一话', chapterNumber: 1 };
        }
        return {
            seriesTitle,
            chapterTitle,
            chapterNumber: parseFloat(digits[0]),
        };
    }

    return { seriesTitle: trimmed, chapterTitle: '全一话', chapterNumber: 1 };
}

function countImagesRecursive(dir, depth = 0) {
    if (depth > 5) return 0;
    let count = 0;
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
                count += countImagesRecursive(full, depth + 1);
            } else if (IMAGE_EXT.test(e.name)) {
                count++;
            }
        }
    } catch (err) {
        console.warn('[扫描] 无法读取目录:', dir, err.message);
    }
    return count;
}

function countZipImages(filePath) {
    try {
        const zip = new AdmZip(filePath);
        return zip.getEntries().filter(e => !e.isDirectory && IMAGE_EXT.test(e.entryName)).length;
    } catch (err) {
        console.warn('[扫描] 读 zip 失败:', filePath, err.message);
        return 0;
    }
}

// ⭐ 统计 epub 图片数（用 adm-zip）
function countEpubImages(filePath) {
    try {
        const zip = new AdmZip(filePath);
        const entries = zip.getEntries();
        let count = 0;
        for (const entry of entries) {
            if (entry.isDirectory) continue;
            if (!IMAGE_EXT.test(entry.entryName)) continue;
            if (IGNORE_EPUB.some(p => p.test(entry.entryName))) continue;
            count++;
        }
        console.log(`[扫描] epub 内部条目 ${entries.length} 个，图片 ${count} 张`);
        return count;
    } catch (err) {
        console.warn('[扫描] epub 解析失败:', filePath, err.message);
        return 0;
    }
}

// ⭐ 统计 mobi / azw3 图片数（扫 PalmDB record）
function countMobiImages(filePath) {
    const info = parseMobi(filePath);
    if (!info.success) {
        console.warn('[扫描] mobi 解析失败:', filePath, info.error);
        return { count: 0, error: info.error };
    }
    console.log(`[扫描] mobi record ${info.recordCount} 个，图片 ${info.images.length} 张`);
    return { count: info.images.length, error: info.error };
}

function detectFormat(filePath) {
    if (ARCHIVE_EXT.test(filePath)) return 'cbz';
    if (EPUB_EXT.test(filePath)) return 'epub';
    if (MOBI_EXT.test(filePath)) return 'mobi';
    if (PDF_EXT.test(filePath)) return 'pdf';
    return null;
}

/**
 * 把一个漫画文件（cbz/epub/mobi/pdf）变成一条导入记录
 * seriesTitleOverride：外层文件夹名，传了就优先用它当系列名
 */
function buildItemFromFile(fullPath, seriesTitleOverride) {
    const format = detectFormat(fullPath);
    if (!format) return null;

    const base = path.basename(fullPath, path.extname(fullPath));
    const split = splitSeriesAndChapter(base);

    let pageCount = 0;
    let warning;
    if (format === 'cbz') {
        pageCount = countZipImages(fullPath);
    } else if (format === 'epub') {
        pageCount = countEpubImages(fullPath);
    } else if (format === 'mobi') {
        const r = countMobiImages(fullPath);
        pageCount = r.count;
        if (pageCount === 0) warning = r.error || '没找到图片';
    }

    console.log(`[扫描] ${format}: ${path.basename(fullPath)} → ${pageCount} 张图`);

    return {
        seriesTitle: seriesTitleOverride || split.seriesTitle,
        chapterTitle: split.chapterTitle,
        chapterNumber: split.chapterNumber,
        filePath: fullPath,
        format,
        pageCount,
        warning,
    };
}

// 递归收集文件夹里的漫画文件
function collectBookFiles(dir, depth = 0, out = []) {
    if (depth > MAX_BOOK_DEPTH) return out;
    let entries = [];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
        console.warn('[扫描] 无法读取目录:', dir, err.message);
        return out;
    }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) collectBookFiles(full, depth + 1, out);
        else if (BOOK_EXT.test(e.name)) out.push(full);
    }
    return out;
}

// 主扫描：既支持「一堆图片文件夹」，也支持「文件夹里躺着很多 mobi/cbz」
// onProgress({ current, total, name }) 用来给界面报进度
async function scanDirectory(rootDir, onProgress) {
    console.log('════════════════════════════════════');
    console.log('[扫描] 根目录:', rootDir);

    if (!fs.existsSync(rootDir)) {
        console.error('[扫描] 路径不存在:', rootDir);
        return [];
    }

    // ---------- 1) 先收集任务（只读目录，不解析文件，很快）----------
    const jobs = [];
    const topEntries = fs.readdirSync(rootDir, { withFileTypes: true });
    console.log('[扫描] 顶层条目数:', topEntries.length);

    for (const e of topEntries) {
        const full = path.join(rootDir, e.name);
        if (e.isDirectory()) {
            // 文件夹本身：可能是「一堆散装图片 = 一话」
            jobs.push({ kind: 'folder', path: full, name: e.name });
            // 文件夹里的 cbz/epub/mobi：一个文件一话，系列名用文件夹名
            for (const f of collectBookFiles(full)) {
                jobs.push({ kind: 'file', path: f, name: path.basename(f), seriesTitle: e.name });
            }
        } else if (BOOK_EXT.test(e.name)) {
            jobs.push({ kind: 'file', path: full, name: e.name });
        }
    }
    console.log('[扫描] 待处理任务数:', jobs.length);

    // ---------- 2) 逐个处理，边处理边报进度 ----------
    const results = [];
    for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        if (onProgress) {
            try {
                onProgress({ current: i + 1, total: jobs.length, name: job.name });
            } catch { /* 界面那边出错不影响扫描 */ }
        }

        if (job.kind === 'folder') {
            const imgCount = countImagesRecursive(job.path);
            if (imgCount > 0) {
                console.log(`[扫描] 文件夹: ${job.name} → 找到 ${imgCount} 张图`);
                results.push({
                    seriesTitle: job.name,
                    chapterTitle: '全一话',
                    chapterNumber: 1,
                    filePath: job.path,
                    format: 'folder',
                    pageCount: imgCount,
                });
            }
        } else {
            const item = buildItemFromFile(job.path, job.seriesTitle);
            if (item) results.push(item);
        }

        // 每个任务之间让出一次事件循环，否则导入几百本 mobi 时窗口会一直转圈点不动
        await new Promise(resolve => setImmediate(resolve));
    }

    console.log('[扫描] 总计找到:', results.length, '本');
    console.log('════════════════════════════════════');
    return results;
}

module.exports = { scanDirectory, buildItemFromFile };
