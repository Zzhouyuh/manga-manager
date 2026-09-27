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

    // ⭐ 后台预热整话缩略图：低优先级排队，等你没在等图的时候慢慢做，
    // 这样第二次滚动（或往下翻）基本是秒开
    useEffect(() => {
        if (images.length === 0) return;
        const api = (window as any).api;
        if (api.warmThumbnails) api.warmThumbnails(chapterId, 320);
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

    // ⭐ 切换收藏（按钮和右键菜单共用）
    const toggleFavPage = async (img: ChapterImage) => {
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

    const handleToggleFav = async (img: ChapterImage, e: React.MouseEvent) => {
        e.stopPropagation();
        await toggleFavPage(img);
    };

    // ⭐ 右键菜单（图片上 / 空白处都可以）
    const handleContextMenu = async (e: React.MouseEvent, index?: number) => {
        e.preventDefault();
        e.stopPropagation();

        const api = (window as any).api;
        const chapter = await api.getChapter(chapterId);
        const filePath: string = (chapter && chapter.file_path) || '';

        const items: any[] = [];
        if (typeof index === 'number') {
            items.push({ id: 'read', label: `从第 ${index + 1} 页开始阅读` });
            items.push({ id: 'fav', label: favorites[index] ? '取消收藏本页' : '收藏本页' });
            items.push({ separator: true });
        }
        items.push({ id: 'reveal', label: '打开漫画文件所在位置', enabled: !!filePath });
        items.push({ id: 'copy', label: '复制文件路径', enabled: !!filePath });
        items.push({ separator: true });
        items.push({ id: 'back', label: '返回上一页' });

        const action = await api.contextMenu(items);
        if (!action) return;

        if (action === 'read' && typeof index === 'number') onOpenReader(index);
        else if (action === 'fav' && typeof index === 'number') await toggleFavPage(images[index]);
        else if (action === 'back') onBack();
        else if (action === 'reveal') {
            const r = await api.revealPath(filePath);
            if (!r.success) alert('打开失败：' + (r.error || '未知错误'));
        } else if (action === 'copy') {
            await api.copyText(filePath);
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
            <div
                ref={scrollContainerRef}
                onContextMenu={e => handleContextMenu(e)}
                style={{ flex: 1, overflowY: 'auto', padding: 16 }}
            >
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
                                onContextMenu={e => handleContextMenu(e, img.index)}
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
                              imagePath, index, isFavorite, onToggleFav, onClick, onContextMenu,
                          }: {
    imagePath: string;
    index: number;
    isFavorite: boolean;
    onToggleFav: (e: React.MouseEvent) => void;
    onClick: () => void;
    onContextMenu: (e: React.MouseEvent) => void;
}) {
    const [shouldLoad, setShouldLoad] = useState(false);
    const [fallback, setFallback] = useState<string | null>(null);
    const boxRef = useRef<HTMLDivElement>(null);
    const loadedRef = useRef(false);

    // ⭐ 走 manga:// 协议直接由浏览器加载缩略图（不再 IPC + base64）
    const src = shouldLoad ? (window as any).api.imageUrl(imagePath, 320) : null;

    // 进入视口附近才开始加载；划走的、还没加载完的会撤销请求，
    // 免得"已经划过去的图"还排在你正在看的图前面
    useEffect(() => {
        const el = boxRef.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            entries => {
                if (entries[0].isIntersecting) {
                    setShouldLoad(true);
                } else if (!loadedRef.current) {
                    setShouldLoad(false);   // 撤销：浏览器会取消还没回来的请求
                }
            },
            { rootMargin: '200px' }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    return (
        <div
            data-page-index={index}
            ref={boxRef}
            onClick={onClick}
            onContextMenu={onContextMenu}
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
                    decoding="async"
                    onLoad={() => { loadedRef.current = true; }}
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
