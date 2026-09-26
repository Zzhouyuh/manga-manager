import { useEffect, useRef, useState } from 'react';
import type { ChapterImage } from '../types';

type Props = {
    chapterId: number;
    chapterTitle: string;
    seriesTitle: string;
    scrollTarget: number | null;   // ⭐ 要滚动到的页码
    onBack: () => void;
    onOpenReader: (startPage: number) => void;
};

export default function ImageWall({
                                      chapterId, chapterTitle, seriesTitle, scrollTarget, onBack, onOpenReader,
                                  }: Props) {
    const [images, setImages] = useState<ChapterImage[]>([]);
    const [loading, setLoading] = useState(true);
    // ⭐ 收藏状态：{ pageIndex: true }
    const [favorites, setFavorites] = useState<Record<number, boolean>>({});
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // 加载图片列表
    useEffect(() => {
        (async () => {
            setLoading(true);
            const api = (window as any).api;
            const list = await api.listChapterImages(chapterId);
            setImages(list);
            setLoading(false);
        })();
    }, [chapterId]);

    // ⭐ 加载收藏状态
    useEffect(() => {
        if (images.length === 0) return;
        (async () => {
            const api = (window as any).api;
            const favMap: Record<number, boolean> = {};
            // 批量查询（也可以逐个查，但会慢）
            const allFavs = await api.listFavoritePages();
            for (const f of allFavs) {
                if (f.chapter_id === chapterId) {
                    favMap[f.page_index] = true;
                }
            }
            setFavorites(favMap);
        })();
    }, [images, chapterId]);

    // ⭐ 滚动到指定位置
    useEffect(() => {
        if (scrollTarget === null || images.length === 0 || loading) return;
        // 等 DOM 渲染完成
        const timer = setTimeout(() => {
            const container = scrollContainerRef.current;
            if (!container) return;
            const targetEl = container.querySelector(`[data-page-index="${scrollTarget}"]`) as HTMLElement;
            if (targetEl) {
                targetEl.scrollIntoView({ block: 'center', behavior: 'instant' as any });
                // ⭐ 高亮一下
                targetEl.style.outline = '3px solid var(--primary)';
                setTimeout(() => {
                    targetEl.style.outline = '';
                }, 1500);
            }
        }, 150);
        return () => clearTimeout(timer);
    }, [scrollTarget, images, loading]);

    // ⭐ 切换收藏
    const handleToggleFav = async (img: ChapterImage, e: React.MouseEvent) => {
        e.stopPropagation();
        const api = (window as any).api;
        const isFav = !!favorites[img.index];
        if (isFav) {
            await api.unfavoritePage(chapterId, img.index);
            setFavorites(prev => {
                const next = { ...prev };
                delete next[img.index];
                return next;
            });
        } else {
            await api.favoritePage(chapterId, img.index, img.path);
            setFavorites(prev => ({ ...prev, [img.index]: true }));
        }
    };

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* 顶栏 */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--border)',
                    background: 'var(--bg-secondary)',
                }}
            >
                <button
                    onClick={onBack}
                    style={{
                        padding: '6px 12px',
                        background: 'var(--card)',
                        borderRadius: 6,
                        fontSize: 13,
                    }}
                >
                    ← 返回
                </button>
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{chapterTitle}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{seriesTitle}</div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    共 {images.length} 页
                </div>
            </div>

            {/* 图片墙 */}
            <div ref={scrollContainerRef} style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
                {loading ? (
                    <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>
                        加载中...
                    </div>
                ) : images.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>
                        该章节没有图片
                    </div>
                ) : (
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                            gap: 12,
                        }}
                    >
                        {images.map(img => (
                            <LazyImageWrapper
                                key={img.index}
                                imagePath={img.path}
                                index={img.index}
                                isFavorite={!!favorites[img.index]}
                                onToggleFav={e => handleToggleFav(img, e)}
                                onClick={() => onOpenReader(img.index)}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// 单个缩略图
function LazyImageWrapper({
                              imagePath, index, isFavorite, onToggleFav, onClick,
                          }: {
    imagePath: string;
    index: number;
    isFavorite: boolean;
    onToggleFav: (e: React.MouseEvent) => void;
    onClick: () => void;
}) {
    const [shouldLoad, setShouldLoad] = useState(false);
    const [fallback, setFallback] = useState<string | null>(null);

    // ⭐ 走 manga:// 协议直接由浏览器加载缩略图（不再 IPC + base64）
    const src = shouldLoad ? (window as any).api.imageUrl(imagePath, 320) : null;

    return (
        <div
            data-page-index={index}
            ref={el => {
                if (!el) return;
                const observer = new IntersectionObserver(
                    entries => {
                        if (entries[0].isIntersecting) {
                            setShouldLoad(true);
                            observer.disconnect();
                        }
                    },
                    { rootMargin: '300px' }
                );
                observer.observe(el);
            }}
            onClick={onClick}
            style={{
                aspectRatio: '3 / 4',
                background: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                overflow: 'hidden',
                cursor: 'pointer',
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'transform 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.03)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
        >
            {src ? (
                <img
                    src={fallback || src}
                    alt={`第 ${index + 1} 页`}
                    onError={async () => {
                        // 协议取不到就退回 IPC 生成的缩略图
                        if (fallback) return;
                        const api = (window as any).api;
                        const data = await api.getThumbnail(imagePath, 320);
                        if (data) setFallback(data);
                    }}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
            ) : (
                <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>·</span>
            )}

            {/* ⭐ 收藏按钮（右下角） */}
            <button
                onClick={onToggleFav}
                title={isFavorite ? '取消收藏' : '收藏本页'}
                style={{
                    position: 'absolute',
                    bottom: 4,
                    left: 4,
                    width: 26,
                    height: 26,
                    borderRadius: 6,
                    background: 'rgba(0,0,0,0.65)',
                    color: isFavorite ? '#fbbf24' : 'white',
                    fontSize: 13,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: 'none',
                    cursor: 'pointer',
                    zIndex: 2,
                }}
            >
                {isFavorite ? '⭐' : '☆'}
            </button>

            {/* 页码 */}
            <div
                style={{
                    position: 'absolute',
                    bottom: 4,
                    right: 6,
                    fontSize: 11,
                    padding: '2px 6px',
                    background: 'rgba(0,0,0,0.6)',
                    color: 'white',
                    borderRadius: 4,
                }}
            >
                {index + 1}
            </div>
        </div>
    );
}
