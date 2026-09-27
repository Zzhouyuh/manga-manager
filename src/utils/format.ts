// 秒 → 1小时02分 / 3分15秒 / 45秒
export function formatDuration(total: number) {
    const s = Math.max(0, Math.floor(total || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}小时${String(m).padStart(2, '0')}分`;
    if (m > 0) return `${m}分${String(sec).padStart(2, '0')}秒`;
    return `${sec}秒`;
}
