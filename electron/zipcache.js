const fs = require('fs');
const AdmZip = require('adm-zip');

/**
 * 压缩包缓存
 *
 * adm-zip 每 new 一次就会把整个压缩包读进内存，翻页时每页都重开一次 =
 * 每翻一页重新读一遍整个文件（几百 MB 的漫画尤其明显）。
 * 这里做个小 LRU：同一个包在连续翻页时复用同一个 AdmZip 实例。
 */

const MAX_CACHED_FILES = 3;
const MAX_CACHED_SIZE = 300 * 1024 * 1024;   // 超过 300MB 不缓存，避免内存爆掉

const cache = new Map();   // filePath -> { mtimeMs, size, zip }

function getZip(filePath) {
    let stat;
    try {
        stat = fs.statSync(filePath);
    } catch {
        return null;
    }

    const hit = cache.get(filePath);
    if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
        cache.delete(filePath);
        cache.set(filePath, hit);      // LRU：挪到末尾
        return hit.zip;
    }

    const zip = new AdmZip(filePath);
    if (stat.size <= MAX_CACHED_SIZE) {
        cache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, zip });
        while (cache.size > MAX_CACHED_FILES) {
            cache.delete(cache.keys().next().value);
        }
    }
    return zip;
}

function clearZipCache(filePath) {
    if (filePath) cache.delete(filePath);
    else cache.clear();
}

module.exports = { getZip, clearZipCache };
