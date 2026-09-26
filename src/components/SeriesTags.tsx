import { useEffect, useState } from 'react';
import type { Tag } from '../types';

type Props = {
    seriesId: number;
    onChanged?: () => void;
    // 紧凑模式（阅读器里的小面板用）
    compact?: boolean;
};

/**
 * 标签编辑区：输入名字回车即添加（重名自动复用），点 × 移除
 * 详情页和阅读器的小面板共用
 */
export default function SeriesTags({ seriesId, onChanged, compact = false }: Props) {
    const [tags, setTags] = useState<Tag[]>([]);
    const [allTags, setAllTags] = useState<Tag[]>([]);
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);

    const load = async () => {
        const api = (window as any).api;
        try {
            const [mine, every] = await Promise.all([
                api.getSeriesTags(seriesId),
                api.listTags(),
            ]);
            setTags(mine || []);
            setAllTags(every || []);
        } catch (e) {
            console.warn('加载标签失败（preload 没更新？重启 npm run dev 试试）:', e);
        }
    };

    useEffect(() => {
        load();
    }, [seriesId]);

    const apply = async (ids: number[]) => {
        const api = (window as any).api;
        setBusy(true);
        try {
            const r = await api.setSeriesTags(seriesId, ids);
            if (!r || !r.success) {
                alert('保存标签失败：' + ((r && r.error) || '未知错误'));
                return;
            }
            await load();
            if (onChanged) onChanged();
        } finally {
            setBusy(false);
        }
    };

    const handleAdd = async () => {
        const name = input.trim();
        if (!name || busy) return;
        const api = (window as any).api;
        const r = await api.createTag(name);
        const created = r && r.tag;
        if (!r || !r.success || !created) {
            alert('创建标签失败：' + ((r && r.error) || '接口不可用，请重启 npm run dev'));
            return;
        }
        if (!tags.some(t => t.id === created.id)) {
            await apply([...tags.map(t => t.id), created.id]);
        }
        setInput('');
    };

    return (
        <div
            style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 8,
                marginBottom: compact ? 0 : 18,
                minHeight: 30,
            }}
        >
            {!compact && (
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>🏷 标签</span>
            )}

            {tags.map(t => (
                <span
                    key={t.id}
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '3px 10px',
                        borderRadius: 12,
                        fontSize: 12,
                        border: `1px solid ${t.color || 'var(--border)'}`,
                        background: 'var(--card)',
                    }}
                >
                    <span
                        style={{
                            width: 6,
                            height: 6,
                            borderRadius: 3,
                            background: t.color || 'var(--primary)',
                        }}
                    />
                    {t.name}
                    <button
                        onClick={() => apply(tags.filter(x => x.id !== t.id).map(x => x.id))}
                        disabled={busy}
                        title="移除这个标签"
                        style={{ fontSize: 13, lineHeight: 1, color: 'var(--text-secondary)' }}
                    >
                        ×
                    </button>
                </span>
            ))}

            <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
                list={`series-tag-options-${seriesId}`}
                placeholder="+ 输入标签名，回车添加"
                style={{
                    width: compact ? 150 : 190,
                    padding: '4px 10px',
                    fontSize: 12,
                    borderRadius: 14,
                    border: '1px solid var(--border)',
                    background: 'var(--card)',
                    color: 'var(--text)',
                }}
            />
            <datalist id={`series-tag-options-${seriesId}`}>
                {allTags
                    .filter(a => !tags.some(t => t.id === a.id))
                    .map(a => <option key={a.id} value={a.name} />)}
            </datalist>

            {tags.length === 0 && (
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    还没有标签，输入名字按回车就能加
                </span>
            )}
        </div>
    );
}
