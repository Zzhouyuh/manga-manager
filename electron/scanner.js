const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i;
const ARCHIVE_EXT = /\.(cbz|zip)$/i;

const IGNORE_EPUB = [
    /^mimetype$/i,
    /^META-INF\//i,
    /cover\.x?html$/i,
    /toc\.x?html$/i,
    /nav\.x?html$/i,
];

function parseChapterNumber(name) {
    const m = name.match(/(?:第|ch\.?|chapter\s*|卷)?\s*(\d+(?:\.\d+)?)\s*(?:话|章|卷)?/i);
    return m ? parseFloat(m[1]) : 0;
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

// 主扫描
async function scanDirectory(rootDir) {
    console.log('════════════════════════════════════');
    console.log('[扫描] 根目录:', rootDir);

    if (!fs.existsSync(rootDir)) {
        console.error('[扫描] 路径不存在:', rootDir);
        return [];
    }

    const results = [];
    const topEntries = fs.readdirSync(rootDir, { withFileTypes: true });
    console.log('[扫描] 顶层条目数:', topEntries.length);

    for (const e of topEntries) {
        const full = path.join(rootDir, e.name);

        if (e.isDirectory()) {
            const imgCount = countImagesRecursive(full);
            console.log(`[扫描] 文件夹: ${e.name} → 找到 ${imgCount} 张图`);

            if (imgCount > 0) {
                results.push({
                    seriesTitle: e.name,
                    chapterTitle: '全一话',
                    chapterNumber: 1,
                    filePath: full,
                    format: 'folder',
                    pageCount: imgCount,
                });
            }
        } else {
            if (ARCHIVE_EXT.test(e.name)) {
                const pageCount = countZipImages(full);
                console.log(`[扫描] 压缩包: ${e.name} → ${pageCount} 张图`);
                results.push({
                    seriesTitle: path.basename(e.name, path.extname(e.name)),
                    chapterTitle: '全一话',
                    chapterNumber: 1,
                    filePath: full,
                    format: 'cbz',
                    pageCount,
                });
            } else if (/\.epub$/i.test(e.name)) {
                const pageCount = countEpubImages(full);
                console.log(`[扫描] epub: ${e.name} → ${pageCount} 张图`);
                results.push({
                    seriesTitle: path.basename(e.name, '.epub'),
                    chapterTitle: '全一话',
                    chapterNumber: 1,
                    filePath: full,
                    format: 'epub',
                    pageCount,
                });
            } else if (/\.mobi$/i.test(e.name)) {
                console.log(`[扫描] mobi: ${e.name}（暂不解析）`);
                results.push({
                    seriesTitle: path.basename(e.name, '.mobi'),
                    chapterTitle: '全一话',
                    chapterNumber: 1,
                    filePath: full,
                    format: 'mobi',
                    pageCount: 0,
                });
            } else if (/\.pdf$/i.test(e.name)) {
                results.push({
                    seriesTitle: path.basename(e.name, '.pdf'),
                    chapterTitle: '全一话',
                    chapterNumber: 1,
                    filePath: full,
                    format: 'pdf',
                    pageCount: 0,
                });
            }
        }
    }

    console.log('[扫描] 总计找到:', results.length, '本');
    console.log('════════════════════════════════════');
    return results;
}

module.exports = { scanDirectory };