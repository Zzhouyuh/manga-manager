const fs = require('fs');

/**
 * MOBI / AZW / AZW3 解析（PalmDB 容器）
 *
 * 思路：不完整实现 MOBI 规范，只做「把书里的图片按顺序挖出来」这一件事。
 *  - PalmDB 头（78 字节）+ 记录索引表给出每个 record 在文件中的偏移和长度；
 *  - record 0 是 PalmDOC + MOBI 头，里面能拿到「第一张图片所在的 record 号」；
 *  - 从第一张图片开始，逐个 record 检查文件头签名（JPEG/PNG/GIF/BMP/WEBP/TIFF），
 *    是图片就按 record 顺序收下 —— 对漫画来说 record 顺序就是页顺序。
 *
 * 注意：亚马逊带 DRM 的书，加密的是文字 record，图片 record 通常仍是明文，
 * 所以漫画 MOBI 一般也能正常抽出图片。
 */

// 解析结果缓存：同一个文件反复取图时不必重新扫一遍
const cache = new Map();   // filePath -> { mtimeMs, size, info }

// 判断一个 record 头部是不是图片，返回扩展名或 null
function detectImageType(buf, len) {
    if (len >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
    if (len >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
        && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'png';
    if (len >= 6 && buf.toString('latin1', 0, 3) === 'GIF') return 'gif';
    if (len >= 12 && buf.toString('latin1', 0, 4) === 'RIFF'
        && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
    if (len >= 4) {
        const t = buf.toString('latin1', 0, 4);
        if (t === 'II*\u0000' || t === 'MM\u0000*') return 'tif';
    }
    if (len >= 30 && buf[0] === 0x42 && buf[1] === 0x4d) {
        // BMP 的 'BM' 太容易撞车，额外校验一下位深/平面数
        const fileSize = buf.readUInt32LE(2);
        const planes = buf.readUInt16LE(26);
        const bpp = buf.readUInt16LE(28);
        const okBpp = [1, 4, 8, 16, 24, 32].includes(bpp);
        if (planes === 1 && okBpp && (fileSize === 0 || fileSize <= len)) return 'bmp';
    }
    return null;
}

// 读取 PalmDB 记录表：返回 [{ index, start, length }]
function readRecords(fd, fileSize) {
    const header = Buffer.alloc(78);
    const hn = fs.readSync(fd, header, 0, 78, 0);
    if (hn < 78) throw new Error('文件太小，不是有效的 MOBI/AZW 文件');

    const recordCount = header.readUInt16BE(76);
    if (recordCount < 2) throw new Error('MOBI 记录数为 ' + recordCount + '，文件可能损坏');

    const tableBuf = Buffer.alloc(recordCount * 8);
    const tn = fs.readSync(fd, tableBuf, 0, tableBuf.length, 78);
    if (tn < tableBuf.length) throw new Error('记录索引表不完整，文件可能损坏');

    const offsets = [];
    for (let i = 0; i < recordCount; i++) {
        offsets.push(tableBuf.readUInt32BE(i * 8));
    }

    const records = [];
    for (let i = 0; i < recordCount; i++) {
        const start = offsets[i];
        const end = i + 1 < recordCount ? offsets[i + 1] : fileSize;
        if (start >= fileSize || end <= start || end > fileSize) {
            records.push(null);   // 偏移异常，跳过
        } else {
            records.push({ index: i, start, length: end - start });
        }
    }
    return { records, recordCount, creator: header.toString('latin1', 64, 68) };
}

/**
 * 解析 MOBI，返回内部图片列表（按 record 顺序 = 阅读顺序）
 * 返回 { success, images: [{ index, recordIndex, start, length, ext, name }], ... }
 */
function parseMobi(filePath) {
    let stat;
    try {
        stat = fs.statSync(filePath);
    } catch (e) {
        return { success: false, error: '文件不存在: ' + filePath };
    }

    const cached = cache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        return cached.info;
    }

    let fd = null;
    try {
        fd = fs.openSync(filePath, 'r');
        const { records, recordCount } = readRecords(fd, stat.size);

        // ---- 读 record 0 的 PalmDOC + MOBI 头 ----
        const rec0 = records[0];
        if (!rec0) throw new Error('第 0 个 record 异常，文件可能损坏');

        const headLen = Math.min(rec0.length, 512);
        const head = Buffer.alloc(headLen);
        fs.readSync(fd, head, 0, headLen, rec0.start);

        const compression = head.readUInt16BE(0);       // 1=不压缩 2=PalmDOC 17480=HUFF/CDIC
        const encryptionType = head.readUInt16BE(12);   // 0=无 DRM
        const isMobi = head.toString('latin1', 16, 20) === 'MOBI';
        const mobiVersion = isMobi ? head.readUInt32BE(36) : 0;

        // ---- 找第一张图片的 record 号 ----
        // MOBI 头里有两个可能的位置，谁指向的 record 真的是图片就信谁，
        // 都不对就退化成「从 record 1 开始全扫」。
        let startIndex = 1;
        let firstImageIndex = 0;
        if (isMobi) {
            const probe = Buffer.alloc(64);
            const candidates = [head.readUInt32BE(16 + 0x5c), head.readUInt32BE(16 + 0x6c)];
            for (const guess of candidates) {
                if (guess > 0 && guess < recordCount && records[guess]
                    && records[guess].length >= 64) {
                    const n = fs.readSync(fd, probe, 0, 64, records[guess].start);
                    if (detectImageType(probe, n)) {
                        startIndex = guess;
                        firstImageIndex = guess;
                        break;
                    }
                }
            }
        }

        // ---- 按顺序收集图片 record ----
        const images = [];
        const probe = Buffer.alloc(64);
        for (let i = startIndex; i < recordCount; i++) {
            const rec = records[i];
            if (!rec || rec.length < 64) continue;
            const n = fs.readSync(fd, probe, 0, 64, rec.start);
            const ext = detectImageType(probe, n);
            if (!ext) continue;
            const pageNo = images.length + 1;
            images.push({
                index: images.length,
                recordIndex: i,
                start: rec.start,
                length: rec.length,
                ext,
                name: `${String(pageNo).padStart(4, '0')}.${ext}`,
            });
        }

        const info = {
            success: true,
            images,
            recordCount,
            firstImageIndex,
            compression,
            encryptionType,
            mobiVersion,
            drm: encryptionType !== 0,
        };

        if (images.length === 0) {
            info.error = encryptionType !== 0
                ? '没找到图片，且该文件带 DRM 加密（encryptionType=' + encryptionType + '）'
                : '没找到图片，可能不是漫画类 MOBI（纯文字电子书）';
        }

        cache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, info });
        return info;
    } catch (e) {
        return { success: false, error: e.message || String(e) };
    } finally {
        if (fd !== null) {
            try { fs.closeSync(fd); } catch { /* ignore */ }
        }
    }
}

/**
 * 取 MOBI 里的第 index 张图片
 * 返回 { success, buffer, ext } 或 { success: false, error }
 */
function extractMobiImage(filePath, index) {
    const info = parseMobi(filePath);
    if (!info.success) return { success: false, error: info.error };

    const img = info.images[index];
    if (!img) return { success: false, error: '图片序号不存在: ' + index };

    let fd = null;
    try {
        fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(img.length);
        fs.readSync(fd, buffer, 0, img.length, img.start);
        return { success: true, buffer, ext: img.ext };
    } catch (e) {
        return { success: false, error: e.message || String(e) };
    } finally {
        if (fd !== null) {
            try { fs.closeSync(fd); } catch { /* ignore */ }
        }
    }
}

// 只想知道有几页时用这个（内部走缓存，和 parseMobi 一样快）
function getMobiPageCount(filePath) {
    const info = parseMobi(filePath);
    return info.success ? info.images.length : 0;
}

module.exports = { parseMobi, extractMobiImage, getMobiPageCount };
