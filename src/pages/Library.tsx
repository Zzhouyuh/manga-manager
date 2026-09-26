import { useEffect, useState } from 'react';
import SeriesCard from '../components/SeriesCard';
import type { Series, Tag } from '../types';

type Props = {
    keyword: string;
    coverMode: 'dynamic' | 'static';
    onOpenSeries: (series: Series) => void;
    onOpenReader: (chapterId: number, chapterTitle: string, seriesId: number, seriesTitle: string, startPage: number) => void;
    // ⭐ 标签筛选
    tagFilter: Tag | null;
    onClearTagFilter: () => void;
};

export default function Library({
                                    keyword, coverMode, onOpenSeries, onOpenReader,
                                    tagFilter, onClearTagFilter,
                                }: Props) {
    const [series, setSeries] = useState<Series[]>([]);
    const [loading, setLoading] = useState(true);

    const load = async () => {
        setLoading(true);
        const api = (window as any).api;
        const tagId = tagFilter ? tagFilter.id : null;
        const list = (keyword || tagId)
            ? await api.searchSeries(keyword, tagId)
            : await api.listSeries();
        setSeries(list);
        setLoading(false);
    };

    useEffect(() => {
        load();
    }, [keyword, tagFilter ? tagFilter.id : null]);

    const handleClick = async (s: Series) => {
        const api = (window as any).api;
        const chapters = await api.listChapters(s.id);

        if (chapters.length === 0) {
            alert('这本漫画还没有章节');
            return;
        }

        if (chapters.length === 1) {
            onOpenReader(chapters[0].id, chapters[0].title, s.id, s.title, 0);
        } else {
            onOpenSeries(s);
        }
    };

    const handleDelete = async (s: Series) => {
        const ok = window.confirm(
            `确定要删除《${s.title}》吗？\n\n` +
            `这会从库中移除这本漫画的所有记录，但不会删除你电脑上的原始文件。\n\n` +
            `（当前有 ${s.chapter_count} 卷）`
        );
        if (!ok) return;

        const api = (window as any).api;
        const result = await api.deleteSeries(s.id);
        if (result.success) {
            await load();
        } else {
            alert('删除失败：' + result.error);
        }
    };

    // ⭐ 切换收藏
    const handleToggleFavorite = async (s: Series) => {
        const api = (window as any).api;
        await api.toggleFavoriteSeries(s.id);
        // 重新加载（让收藏的排到前面）
        await load();
    };

    if (loading) {
        return <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-secondary)' }}>加载中...</div>;
    }

    if (series.length === 0) {
        return (
            <div>
                {tagFilter && <TagFilterBar tag={tagFilter} onClear={onClearTagFilter} />}
                <div
                    style={{
                        padding: 80,
                        textAlign: 'center',
                        color: 'var(--text-secondary)',
                        border: '2px dashed var(--border)',
                        borderRadius: 12,
                    }}
                >
                    <div style={{ fontSize: 48, marginBottom: 16 }}>📚</div>
                    <div style={{ fontSize: 16 }}>
                        {keyword
                            ? `没有找到匹配"${keyword}"的漫画`
                            : tagFilter
                                ? `标签「${tagFilter.name}」下还没有漫画`
                                : '还没有漫画，点右上角"导入文件"（MOBI/EPUB/CBZ）或"导入文件夹"开始吧'}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div>
            {tagFilter && <TagFilterBar tag={tagFilter} onClear={onClearTagFilter} />}
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                    gap: 16,
                }}
            >
                {series.map(s => (
                    <SeriesCard
                        key={s.id}
                        series={s}
                        coverMode={coverMode}
                        onClick={handleClick}
                        onDelete={handleDelete}
                        onToggleFavorite={handleToggleFavorite}
                        onOpenDetail={onOpenSeries}
                    />
                ))}
            </div>
        </div>
    );
}

// ⭐ 标签筛选提示条
function TagFilterBar({ tag, onClear }: { tag: Tag; onClear: () => void }) {
    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 16,
                fontSize: 13,
                color: 'var(--text-secondary)',
            }}
        >
            <span
                style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    background: tag.color || 'var(--primary)',
                }}
            />
            正在按标签筛选：
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>{tag.name}</span>
            <button onClick={onClear} style={{ fontSize: 12, color: 'var(--primary)' }}>
                清除筛选
            </button>
        </div>
    );
}
