import { useEffect, useRef, useState } from 'react';
import SeriesCard from '../components/SeriesCard';
import { formatDuration } from '../utils/format';
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

type SortBy = 'added' | 'pages' | 'title' | 'lastRead';
type SortDir = 'asc' | 'desc';
type ViewMode = 'grid' | 'list';

type ViewState = {
    mode: ViewMode;
    cardSize: number;      // 封面模式下的卡片最小宽度
    sortBy: SortBy;
    sortDir: SortDir;
};

const LS_KEY = 'libraryView';
const DEFAULT_VIEW: ViewState = { mode: 'grid', cardSize: 180, sortBy: 'added', sortDir: 'desc' };

function loadView(): ViewState {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) return { ...DEFAULT_VIEW, ...JSON.parse(raw) };
    } catch { /* ignore */ }
    return DEFAULT_VIEW;
}

function shortDate(v?: string) {
    return v ? String(v).slice(0, 10) : '';
}

export default function Library({
                                    keyword, coverMode, onOpenSeries, onOpenReader,
                                    tagFilter, onClearTagFilter,
                                }: Props) {
    const [series, setSeries] = useState<Series[]>([]);
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState<ViewState>(loadView);
    const containerRef = useRef<HTMLDivElement>(null);

    // 视图设置记在本地，下次打开还是这个样子
    useEffect(() => {
        try { localStorage.setItem(LS_KEY, JSON.stringify(view)); } catch { /* ignore */ }
    }, [view]);

    // ⭐ Ctrl + 滚轮缩放卡片
    // 要点：只有"按住 Ctrl 期间"才挂非 passive 的 wheel 监听。
    // 非 passive 的 wheel 监听会让滚动走同步路径（等 JS 处理完才滚），平时不挂滚动才顺滑。
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const onWheel = (e: WheelEvent) => {
            if (!e.ctrlKey) return;
            e.preventDefault();      // 拦住浏览器自带的整页缩放
            setView(v => ({
                ...v,
                cardSize: Math.max(110, Math.min(360, v.cardSize + (e.deltaY > 0 ? -16 : 16))),
            }));
        };
        const attach = (e: KeyboardEvent) => {
            if (e.key === 'Control') el.addEventListener('wheel', onWheel, { passive: false });
        };
        const detach = (e: KeyboardEvent) => {
            if (e.key === 'Control') el.removeEventListener('wheel', onWheel);
        };
        const onBlur = () => el.removeEventListener('wheel', onWheel);

        window.addEventListener('keydown', attach);
        window.addEventListener('keyup', detach);
        window.addEventListener('blur', onBlur);
        return () => {
            el.removeEventListener('wheel', onWheel);
            window.removeEventListener('keydown', attach);
            window.removeEventListener('keyup', detach);
            window.removeEventListener('blur', onBlur);
        };
    }, []);

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
        await load();
    };

    // ⭐ 排序
    // ⭐ 右键菜单
    const handleContextMenu = async (s: Series) => {
        const api = (window as any).api;
        const action = await api.contextMenu([
            { id: 'detail', label: '查看详情' },
            { id: 'reveal', label: '打开文件所在位置' },
            { id: 'copy', label: '复制文件路径' },
            { separator: true },
            { id: 'fav', label: s.is_favorite ? '取消收藏' : '收藏' },
            { separator: true },
            { id: 'delete', label: '从库中删除（不动原始文件）' },
        ]);
        if (!action) return;

        if (action === 'detail') {
            onOpenSeries(s);
        } else if (action === 'fav') {
            await handleToggleFavorite(s);
        } else if (action === 'delete') {
            await handleDelete(s);
        } else if (action === 'reveal' || action === 'copy') {
            const chapters = await api.listChapters(s.id);
            const p = chapters.length ? chapters[0].file_path : '';
            if (!p) { alert('找不到文件路径'); return; }
            if (action === 'reveal') {
                const r = await api.revealPath(p);
                if (!r.success) alert('打开失败：' + (r.error || '未知错误'));
            } else {
                await api.copyText(p);
            }
        }
    };

    const dir = view.sortDir === 'asc' ? 1 : -1;
    const sorted = [...series].sort((a, b) => {
        if (view.sortBy === 'pages') {
            return ((a.page_count || 0) - (b.page_count || 0)) * dir;
        }
        if (view.sortBy === 'title') {
            const ka = (a.title_pinyin || a.title || '').split('|')[0].toLowerCase();
            const kb = (b.title_pinyin || b.title || '').split('|')[0].toLowerCase();
            return ka.localeCompare(kb, 'zh') * dir;
        }
        if (view.sortBy === 'lastRead') {
            // 没读过的（空值）排最后（递减时）
            return String(a.last_read_at || '').localeCompare(String(b.last_read_at || '')) * dir;
        }
        return String(a.created_at || '').localeCompare(String(b.created_at || '')) * dir;
    });

    return (
        <div ref={containerRef}>
            {tagFilter && <TagFilterBar tag={tagFilter} onClear={onClearTagFilter} />}

            {!loading && series.length > 0 && (
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        flexWrap: 'wrap',
                        marginBottom: 14,
                    }}
                >
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        共 {series.length} 本
                    </span>
                    <div style={{ flex: 1 }} />

                    {/* 卡片大小（只在封面模式下有意义，也可以用 Ctrl+滚轮） */}
                    {view.mode === 'grid' && (
                        <label
                            title="拖动调整卡片大小；也可以按住 Ctrl 滚轮"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                fontSize: 12,
                                color: 'var(--text-secondary)',
                            }}
                        >
                            卡片
                            <input
                                type="range"
                                min={110}
                                max={360}
                                step={10}
                                value={view.cardSize}
                                onChange={e => setView(v => ({ ...v, cardSize: Number(e.target.value) }))}
                                style={{ width: 90 }}
                            />
                            <span style={{ width: 42 }}>{view.cardSize}px</span>
                        </label>
                    )}

                    {/* 封面 / 文本 */}
                    <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                        {(['grid', 'list'] as ViewMode[]).map(m => (
                            <button
                                key={m}
                                onClick={() => setView(v => ({ ...v, mode: m }))}
                                style={{
                                    padding: '4px 12px',
                                    fontSize: 12,
                                    background: view.mode === m ? 'var(--primary)' : 'transparent',
                                    color: view.mode === m ? 'white' : 'var(--text-secondary)',
                                }}
                            >
                                {m === 'grid' ? '封面' : '文本'}
                            </button>
                        ))}
                    </div>

                    {/* 排序 */}
                    <select
                        value={view.sortBy}
                        onChange={e => setView(v => ({ ...v, sortBy: e.target.value as SortBy }))}
                        style={{
                            padding: '4px 8px',
                            fontSize: 12,
                            background: 'var(--card)',
                            color: 'var(--text)',
                            border: '1px solid var(--border)',
                            borderRadius: 6,
                            cursor: 'pointer',
                        }}
                    >
                        <option value="added">按添加时间</option>
                        <option value="pages">按漫画页数</option>
                        <option value="title">按首字母</option>
                        <option value="lastRead">按上次阅读</option>
                    </select>
                    <button
                        onClick={() => setView(v => ({ ...v, sortDir: v.sortDir === 'asc' ? 'desc' : 'asc' }))}
                        title="点击切换递增 / 递减"
                        style={{
                            padding: '4px 10px',
                            fontSize: 12,
                            background: 'var(--card)',
                            color: 'var(--text)',
                            border: '1px solid var(--border)',
                            borderRadius: 6,
                        }}
                    >
                        {view.sortDir === 'asc' ? '↑ 递增' : '↓ 递减'}
                    </button>
                </div>
            )}

            {loading ? (
                <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-secondary)' }}>加载中...</div>
            ) : series.length === 0 ? (
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
            ) : view.mode === 'grid' ? (
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: `repeat(auto-fill, minmax(${view.cardSize}px, 1fr))`,
                        gap: 16,
                    }}
                >
                    {sorted.map(s => (
                        <SeriesCard
                            key={s.id}
                            series={s}
                            coverMode={coverMode}
                            onClick={handleClick}
                            onDelete={handleDelete}
                            onToggleFavorite={handleToggleFavorite}
                            onOpenDetail={onOpenSeries}
                            onContextMenu={handleContextMenu}
                        />
                    ))}
                </div>
            ) : (
                <div>
                    {sorted.map(s => (
                        <div
                            key={s.id}
                            onClick={() => handleClick(s)}
                            onContextMenu={e => { e.preventDefault(); handleContextMenu(s); }}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 12,
                                padding: '9px 10px',
                                borderBottom: '1px solid var(--border)',
                                cursor: 'pointer',
                                fontSize: 13,
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--card)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                            <button
                                onClick={e => { e.stopPropagation(); handleToggleFavorite(s); }}
                                title={s.is_favorite ? '取消收藏' : '收藏'}
                                style={{
                                    width: 18,
                                    color: s.is_favorite ? '#f87171' : 'var(--text-secondary)',
                                    fontSize: 13,
                                }}
                            >
                                {s.is_favorite ? '❤' : '♡'}
                            </button>
                            <span
                                style={{
                                    flex: 1,
                                    minWidth: 0,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}
                                title={s.title}
                            >
                                {s.title}
                            </span>
                            <span style={{ width: 56, textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)' }}>
                                {s.chapter_count} 卷
                            </span>
                            <span style={{ width: 80, textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)' }}>
                                {s.page_count || 0} 页
                            </span>
                            <span
                                style={{ width: 96, textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)' }}
                                title="累计阅读时长"
                            >
                                {formatDuration(s.reading_seconds || 0)}
                            </span>
                            <span style={{ width: 92, textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)' }}>
                                {shortDate(s.created_at)}
                            </span>
                            <button
                                onClick={e => { e.stopPropagation(); handleDelete(s); }}
                                title="删除（不会删本地文件）"
                                style={{ fontSize: 13, color: 'var(--text-secondary)' }}
                            >
                                🗑️
                            </button>
                        </div>
                    ))}
                </div>
            )}
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
