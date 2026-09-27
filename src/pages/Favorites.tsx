import { useEffect, useState } from 'react';
import type { Series } from '../types';
import SeriesCard from '../components/SeriesCard';

type FavoritePage = {
    id: number;
    chapter_id: number;
    page_index: number;
    image_path: string;
    note: string;
    created_at: string;
    chapter_title: string;
    format: string;
    series_id: number;
    series_title: string;
};

type Props = {
    coverMode: 'dynamic' | 'static';
    onOpenSeries: (series: Series) => void;
    onOpenReader: (chapterId: number, chapterTitle: string, seriesId: number, seriesTitle: string, startPage: number) => void;
};

type Tab = 'pages' | 'series';

export default function Favorites({ coverMode, onOpenSeries, onOpenReader }: Props) {
    const [tab, setTab] = useState<Tab>('pages');
    const [pages, setPages] = useState<FavoritePage[]>([]);
    const [series, setSeries] = useState<Series[]>([]);
    const [loading, setLoading] = useState(true);

    const load = async () => {
        setLoading(true);
        const api = (window as any).api;
        const [p, s] = await Promise.all([
            api.listFavoritePages(),
            api.listFavoriteSeries(),
        ]);
        setPages(p);
        setSeries(s);
        setLoading(false);
    };

    useEffect(() => {
        load();
    }, []);

    // 删除收藏的单页
    const handleDeletePage = async (favId: number) => {
        const ok = window.confirm('确定要取消收藏这张图片吗？');
        if (!ok) return;
        const api = (window as any).api;
        await api.deleteFavoritePage(favId);
        await load();
    };

    // 点击收藏的图片 → 跳到阅读器对应页
    const handleClickPage = (p: FavoritePage) => {
        onOpenReader(p.chapter_id, p.chapter_title, p.series_id, p.series_title, p.page_index);
    };

    // 点击收藏的漫画 → 进详情
    const handleClickSeries = async (s: Series) => {
        const api = (window as any).api;
        const chapters = await api.listChapters(s.id);
        if (chapters.length === 1) {
            onOpenReader(chapters[0].id, chapters[0].title, s.id, s.title, 0);
        } else {
            onOpenSeries(s);
        }
    };

    const handleToggleFavorite = async (s: Series) => {
        const api = (window as any).api;
        await api.toggleFavoriteSeries(s.id);
        await load();
    };

    if (loading) {
        return <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-secondary)' }}>加载中...</div>;
    }

    return (
        <div>
            {/* Tab 切换 */}
            <div
                style={{
                    display: 'flex',
                    gap: 8,
                    marginBottom: 20,
                    borderBottom: '1px solid var(--border)',
                }}
            >
                <TabButton active={tab === 'pages'} onClick={() => setTab('pages')}>
                    🖼️ 图片收藏 ({pages.length})
                </TabButton>
                <TabButton active={tab === 'series'} onClick={() => setTab('series')}>
                    ❤️ 漫画收藏 ({series.length})
                </TabButton>
            </div>

            {/* 图片收藏 */}
            {tab === 'pages' && (
                <>
                    {pages.length === 0 ? (
                        <Empty
                            icon="🖼️"
                            text="还没有收藏的图片"
                            hint="在阅读器里点击「☆ 收藏本页」，图片就会出现在这里"
                        />
                    ) : (
                        <PagesGrouped
                            pages={pages}
                            onDelete={handleDeletePage}
                            onClick={handleClickPage}
                        />
                    )}
                </>
            )}

            {/* 漫画收藏 */}
            {tab === 'series' && (
                <>
                    {series.length === 0 ? (
                        <Empty
                            icon="❤️"
                            text="还没有收藏的漫画"
                            hint="在漫画卡片左下角点击「♡」，或在阅读器里点击「♡ 收藏漫画」"
                        />
                    ) : (
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
                                    onClick={handleClickSeries}
                                    onToggleFavorite={handleToggleFavorite}
                                />
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

// ==================== 子组件 ====================

function TabButton({
                       active, onClick, children,
                   }: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            style={{
                padding: '10px 16px',
                fontSize: 14,
                fontWeight: active ? 600 : 400,
                color: active ? 'var(--text)' : 'var(--text-secondary)',
                borderBottom: active ? '2px solid var(--primary)' : '2px solid transparent',
                marginBottom: -1,
                cursor: 'pointer',
            }}
        >
            {children}
        </button>
    );
}

function Empty({ icon, text, hint }: { icon: string; text: string; hint: string }) {
    return (
        <div
            style={{
                padding: 80,
                textAlign: 'center',
                color: 'var(--text-secondary)',
                border: '2px dashed var(--border)',
                borderRadius: 12,
            }}
        >
            <div style={{ fontSize: 48, marginBottom: 16 }}>{icon}</div>
            <div style={{ fontSize: 16, marginBottom: 8, color: 'var(--text)' }}>{text}</div>
            <div style={{ fontSize: 13 }}>{hint}</div>
        </div>
    );
}

// 按漫画分组显示收藏的图片
function PagesGrouped({
                          pages, onDelete, onClick,
                      }: {
    pages: FavoritePage[];
    onDelete: (id: number) => void;
    onClick: (p: FavoritePage) => void;
}) {
    // 按 series_title 分组
    const groups: Record<string, FavoritePage[]> = {};
    for (const p of pages) {
        const key = p.series_title;
        if (!groups[key]) groups[key] = [];
        groups[key].push(p);
    }

    return (
        <div>
            {Object.entries(groups).map(([seriesTitle, items]) => (
                <section key={seriesTitle} style={{ marginBottom: 32 }}>
                    <h3
                        style={{
                            fontSize: 14,
                            fontWeight: 600,
                            marginBottom: 12,
                            color: 'var(--text)',
                            paddingBottom: 8,
                            borderBottom: '1px solid var(--border)',
                        }}
                    >
                        📖 {seriesTitle}
                        <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-secondary)', fontWeight: 400 }}>
              {items.length} 张
            </span>
                    </h3>

                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                            gap: 12,
                        }}
                    >
                        {items.map(p => (
                            <FavoriteThumb key={p.id} page={p} onDelete={onDelete} onClick={onClick} />
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}

// 单个收藏缩略图
function FavoriteThumb({
                           page, onDelete, onClick,
                       }: {
    page: FavoritePage;
    onDelete: (id: number) => void;
    onClick: (p: FavoritePage) => void;
}) {
    const [hover, setHover] = useState(false);

    // ⭐ 走 manga:// 协议加载缩略图
    const src: string | null = (window as any).api.imageUrl(page.image_path, 320);

    return (
        <div
            onClick={() => onClick(page)}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                aspectRatio: '3 / 4',
                background: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                overflow: 'hidden',
                cursor: 'pointer',
                position: 'relative',
                transition: 'transform 0.15s',
                transform: hover ? 'scale(1.02)' : 'scale(1)',
            }}
        >
            {src ? (
                <img
                    src={src}
                    alt={page.chapter_title}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
            ) : (
                <div
                    style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--text-secondary)',
                        fontSize: 12,
                    }}
                >
                    加载中
                </div>
            )}

            {/* 信息条 */}
            <div
                style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    padding: '6px 8px',
                    background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
                    color: 'white',
                    fontSize: 11,
                }}
            >
                <div
                    style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {page.chapter_title}
                </div>
                <div style={{ opacity: 0.7 }}>第 {page.page_index + 1} 页</div>
            </div>

            {/* 删除按钮 */}
            {hover && (
                <button
                    onClick={e => {
                        e.stopPropagation();
                        onDelete(page.id);
                    }}
                    title="取消收藏"
                    style={{
                        position: 'absolute',
                        top: 6,
                        right: 6,
                        width: 26,
                        height: 26,
                        borderRadius: 6,
                        background: 'rgba(0,0,0,0.65)',
                        color: 'white',
                        fontSize: 13,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: 'none',
                        cursor: 'pointer',
                    }}
                >
                    🗑️
                </button>
            )}
        </div>
    );
}
