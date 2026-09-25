const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp)$/i;

// 一些 epub 元数据文件忽略掉
const IGNORE_PATTERNS = [
    /^mimetype$/i,
    /^META-INF\//i,
    /cover\.x?html$/i,
    /toc\.x?html$/i,
    /nav\.x?html$/i,
];

/**
 * 用 adm-zip 直接读 epub 里的图片
 * 返回 { success: true, images: [{ name, href, index }] }
 */
function parseEpub(epubPath) {
    return new Promise((resolve) => {
        try {
            if (!fs.existsSync(epubPath)) {
                return resolve({ success: false, error: '文件不存在: ' + epubPath });
            }

            const zip = new AdmZip(epubPath);
            const entries = zip.getEntries();

            console.log('[epub] 总条目数:', entries.length);

            const images = [];
            let idx = 0;

            for (const entry of entries) {
                if (entry.isDirectory) continue;
                if (!IMAGE_EXT.test(entry.entryName)) continue;
                if (IGNORE_PATTERNS.some(p => p.test(entry.entryName))) continue;

                images.push({
                    name: path.basename(entry.entryName),
                    href: entry.entryName,
                    index: idx++,
                });
            }

            console.log('[epub] 找到图片:', images.length, '张');

            // 自然排序
            images.sort((a, b) =>
                a.href.localeCompare(b.href, undefined, { numeric: true })
            );
            images.forEach((img, i) => (img.index = i));

            resolve({
                success: true,
                images,
                imageCount: images.length,
            });
        } catch (e) {
            console.error('[epub] 解析失败:', e.message);
            resolve({ success: false, error: e.message || String(e) });
        }
    });
}

/**
 * 提取单张图片
 */
function extractEpubImage(epubPath, imageHref) {
    return new Promise((resolve) => {
        try {
            const zip = new AdmZip(epubPath);
            const entry = zip.getEntry(imageHref);
            if (!entry) {
                return resolve({ success: false, error: '图片不存在: ' + imageHref });
            }
            const buffer = entry.getData();
            const ext = path.extname(imageHref).slice(1).toLowerCase() || 'jpg';
            resolve({ success: true, buffer, ext });
        } catch (e) {
            resolve({ success: false, error: e.message || String(e) });
        }
    });
}

module.exports = { parseEpub, extractEpubImage };