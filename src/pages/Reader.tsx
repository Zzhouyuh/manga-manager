import { useEffect, useRef, useState } from 'react';
import type { ChapterImage, ReaderMode, ReaderDirection, ReaderFit } from '../types';

type Props = {
    chapterId: number;
    chapterTitle: string;
    seriesTitle: string;
    seriesId: number;
    startPage: number;
    onBack: (currentPage?: number) => void;
};

const LS_KEY = 'readerSettings';

function loadSettings() {
    const defaults = {
        mode: 'page' as ReaderMode,
        direction: 'ltr' as ReaderDirection,
        fit: 'window' as ReaderFit,   // ⭐ 默认改成"适应窗口"
    };
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) return { ...defaults, ...JSON.parse(raw) };
    } catch { /* ignore */ }
    return defaults;
}

function saveSettings(s: any) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export default function Reader({
                                   chapterId, chapterTitle, seriesTitle, seriesId, startPage, onBack,
                               }: Props) {
    const [images, setImages] = useState<ChapterImage[]>([]);
    const [current, setCurrent] = useState(startPage);
    const currentRef = useRef(current);
    useEffect(() => { currentRef.current = current; }, [current]);

    const [imgData, setImgData] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [showToolbar, setShowToolbar] = useState(true);

    const [isPageFav, setIsPageFav] = useState(false);
    const [isSeriesFav, setIsSeriesFav] = useState(false);

    const [settings, setSettings] = useState(loadSettings);
    const [userZoom, setUserZoom] = useState(1);
    const [isFullscreen, setIsFullscreen] = useState(false);

    const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
    const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
    const containerRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [scrollContainerWidth, setScrollContainerWidth] = useState(0);

    useEffect(() => { saveSettings(settings); }, [settings]);

    useEffect(() => {
        if (settings.mode !== 'page') return;
        const el = containerRef.current;
        if (!el) return;
        const update = () => {
            if (containerRef.current) {
                setContainerSize({
                    w: containerRef.current.clientWidth,
                    h: containerRef.current.clientHeight,
                });
            }
        };
        requestAnimationFrame(update);
        window.addEventListener('resize', update);
        return () => window.removeEventListener('resize', update);
    }, [settings.mode, loading]);

    useEffect(() => {
        if (settings.mode !== 'scroll') return;
        const el = scrollContainerRef.current;
        if (!el) return;
        const update = () => setScrollContainerWidth(el.clientWidth);
        requestAnimationFrame(update);
        window.addEventListener('resize', update);
        return () => window.removeEventListener('resize', update);
    }, [settings.mode]);

    useEffect(() => {
        (async () => {
            setLoading(true);
            const api = (window as any).api;
            const list = await api.listChapterImages(chapterId);
            setImages(list);
            setLoading(false);
        })();
    }, [chapterId]);

    useEffect(() => {
        if (settings.mode !== 'page') return;
        if (images.length === 0) return;
        if (current < 0 || current >= images.length) return;
        let cancelled = false;
        setLoading(true);
        setNaturalSize(null);
        (async () => {
            const api = (window as any).api;
            const data = await api.getImage(images[current].path);
            if (cancelled) return;
            setImgData(data);
            setLoading(false);
            api.updateProgress(chapterId, current + 1);
        })();
        return () => { cancelled = true; };
    }, [current, images, chapterId, settings.mode]);

    useEffect(() => {
        (async () => {
            const api = (window as any).api;
            const fav = await api.isPageFavorited(chapterId, current);
            setIsPageFav(fav);
        })();
    }, [chapterId, current]);

    useEffect(() => {
        (async () => {
            const api = (window as any).api;
            const all = await api.listFavoriteSeries();
            setIsSeriesFav(all.some((s: any) => s.id === seriesId));
        })();
    }, [seriesId]);

    // ⭐ 基础缩放
    const baseScale = (() => {
        if (!naturalSize || containerSize.w === 0 || containerSize.h === 0) return 1;
        const scaleW = containerSize.w / naturalSize.w;
        const scaleH = containerSize.h / naturalSize.h;
        if (settings.fit === 'window') return Math.min(scaleW, scaleH);   // ⭐ 适应窗口
        if (settings.fit === 'width') return scaleW;
        if (settings.fit === 'height') return scaleH;
        return 1; // original
    })();

    const actualScale = baseScale * userZoom;

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === '+' || e.key === '=') { e.preventDefault(); setUserZoom(z => Math.min(z + 0.25, 5)); return; }
            if (e.key === '-') { e.preventDefault(); setUserZoom(z => Math.max(z - 0.25, 0.1)); return; }
            if (e.key === '0') { e.preventDefault(); setUserZoom(1); return; }
            if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); return; }
            if (settings.mode === 'page') {
                if (e.key === 'ArrowRight' || e.key === ' ') {
                    e.preventDefault();
                    const dir = settings.direction === 'ltr' ? 1 : -1;
                    setCurrent(c => Math.max(0, Math.min(c + dir, images.length - 1)));
                } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    const dir = settings.direction === 'ltr' ? -1 : 1;
                    setCurrent(c => Math.max(0, Math.min(c + dir, images.length - 1)));
                }
            } else {
                const el = scrollContainerRef.current;
                if (!el) return;
                if (e.key === 'PageDown' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    el.scrollBy({ top: el.clientHeight * 0.9, behavior: 'smooth' });
                } else if (e.key === 'PageUp' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    el.scrollBy({ top: -el.clientHeight * 0.9, behavior: 'smooth' });
                }
            }
            if (e.key === 'Escape') onBack(currentRef.current);
            else if (e.key === 'f' || e.key === 'F') setShowToolbar(v => !v);
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [images.length, onBack, settings.mode, settings.direction]);

    const handleWheel = (e: React.WheelEvent) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            setUserZoom(z => Math.max(0.1, Math.min(5, z + delta)));
        }
    };

    const toggleFullscreen = () => {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen();
        else document.exitFullscreen();
    };

    useEffect(() => {
        const handler = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', handler);
        return () => document.removeEventListener('fullscreenchange', handler);
    }, []);

    const prev = () => setCurrent(c => Math.max(c - 1, 0));
    const next = () => setCurrent(c => Math.min(c + 1, images.length - 1));

    const handleTogglePageFav = async () => {
        const api = (window as any).api;
        if (isPageFav) {
            await api.unfavoritePage(chapterId, current);
            setIsPageFav(false);
        } else {
            if (images.length === 0) return;
            await api.favoritePage(chapterId, current, images[current].path);
            setIsPageFav(true);
        }
    };

    const handleToggleSeriesFav = async () => {
        const api = (window as any).api;
        const result = await api.toggleFavoriteSeries(seriesId);
        if (result.success) setIsSeriesFav(result.is_favorite === 1);
    };

    const pageImgStyle: React.CSSProperties = naturalSize
        ? {
            width: Math.round(naturalSize.w * actualScale),
            height: Math.round(naturalSize.h * actualScale),
            userSelect: 'none',
            display: 'block',
        }
        : { userSelect: 'none', display: 'block', maxWidth: '100%', maxHeight: '100%' };

    useEffect(() => {
        if (settings.mode !== 'scroll') return;
        const el = scrollContainerRef.current;
        if (!el) return;
        let ticking = false;
        const handler = () => {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(() => {
                const centerY = el.scrollTop + el.clientHeight / 2;
                const pages = el.querySelectorAll('[data-scroll-page]');
                let nearest = currentRef.current;
                let minDist = Infinity;
                pages.forEach(p => {
                    const htmlP = p as HTMLElement;
                    const mid = htmlP.offsetTop + htmlP.clientHeight / 2;
                    const dist = Math.abs(mid - centerY);
                    if (dist < minDist) {
                        minDist = dist;
                        nearest = parseInt(htmlP.dataset.scrollPage || '0', 10);
                    }
                });
                if (nearest !== currentRef.current) {
                    currentRef.current = nearest;
                    setCurrent(nearest);
                    (window as any).api.updateProgress(chapterId, nearest + 1);
                }
                ticking = false;
            });
        };
        el.addEventListener('scroll', handler);
        return () => el.removeEventListener('scroll', handler);
    }, [settings.mode, chapterId]);

    useEffect(() => {
        if (settings.mode !== 'scroll') return;
        if (images.length === 0) return;
        const el = scrollContainerRef.current;
        if (!el) return;
        const timer = setTimeout(() => {
            const target = el.querySelector(`[data-scroll-page="${startPage}"]`);
            if (target) (target as HTMLElement).scrollIntoView({ block: 'start' });
        }, 300);
        return () => clearTimeout(timer);
    }, [settings.mode, images.length]);

    return (
        <div
            onWheel={handleWheel}
            style={{
                height: '100%',
                background: '#000',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
            }}
        >
            {showToolbar && (
                <div
                    style={{
                        position: 'absolute',
                        top: 0, left: 0, right: 0,
                        padding: '8px 16px',
                        background: 'rgba(0,0,0,0.85)',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        zIndex: 10,
                        fontSize: 12,
                        flexWrap: 'wrap',
                    }}
                >
                    <button onClick={() => onBack(currentRef.current)} style={toolBtnStyle}>← 返回</button>

                    <div style={{ flex: 1, textAlign: 'center', overflow: 'hidden', minWidth: 100 }}>
                        <span style={{ fontWeight: 600 }}>{chapterTitle}</span>
                        <span style={{ marginLeft: 12, opacity: 0.7 }}>{seriesTitle}</span>
                    </div>

                    <button onClick={() => setUserZoom(z => Math.max(0.1, z - 0.25))} style={toolBtnStyle}>➖</button>
                    <span style={{ minWidth: 50, textAlign: 'center' }}>
            {settings.mode === 'page'
                ? `${Math.round(actualScale * 100)}%`
                : `${Math.round(userZoom * 100)}%`}
          </span>
                    <button onClick={() => setUserZoom(z => Math.min(5, z + 0.25))} style={toolBtnStyle}>➕</button>
                    <button onClick={() => setUserZoom(1)} style={toolBtnStyle}>⟳</button>

                    {settings.mode === 'page' && (
                        <select
                            value={settings.fit}
                            onChange={e => setSettings({ ...settings, fit: e.target.value as ReaderFit })}
                            style={selectStyle}
                        >
                            {/* ⭐ 顺序：适应窗口在最前面 */}
                            <option value="window">适应窗口</option>
                            <option value="width">适应宽度</option>
                            <option value="height">适应高度</option>
                            <option value="original">原始尺寸</option>
                        </select>
                    )}

                    <select
                        value={settings.direction}
                        onChange={e => setSettings({ ...settings, direction: e.target.value as ReaderDirection })}
                        style={selectStyle}
                    >
                        <option value="ltr">左→右</option>
                        <option value="rtl">右→左</option>
                    </select>

                    <select
                        value={settings.mode}
                        onChange={e => setSettings({ ...settings, mode: e.target.value as ReaderMode })}
                        style={selectStyle}
                    >
                        <option value="page">翻页模式</option>
                        <option value="scroll">滚动模式</option>
                    </select>

                    <button onClick={handleTogglePageFav} style={{
                        ...toolBtnStyle,
                        background: isPageFav ? 'rgba(234,179,8,0.3)' : 'rgba(255,255,255,0.15)',
                        color: isPageFav ? '#fbbf24' : 'white',
                    }}>
                        {isPageFav ? '⭐' : '☆'}
                    </button>
                    <button onClick={handleToggleSeriesFav} style={{
                        ...toolBtnStyle,
                        background: isSeriesFav ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.15)',
                        color: isSeriesFav ? '#f87171' : 'white',
                    }}>
                        {isSeriesFav ? '❤️' : '♡'}
                    </button>

                    <button onClick={toggleFullscreen} style={toolBtnStyle}>
                        {isFullscreen ? '⤢' : '⛶'}
                    </button>

                    <div style={{ minWidth: 60, textAlign: 'right' }}>
                        {current + 1} / {images.length}
                    </div>
                </div>
            )}

            {settings.mode === 'page' && (
                <div
                    ref={containerRef}
                    style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        position: 'relative',
                        overflow: 'auto',
                    }}
                >
                    {loading ? (
                        <span style={{ color: '#888' }}>加载中...</span>
                    ) : imgData ? (
                        <img
                            src={imgData}
                            alt={`第 ${current + 1} 页`}
                            style={pageImgStyle}
                            draggable={false}
                            onLoad={e => {
                                const img = e.currentTarget;
                                setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
                            }}
                            onDoubleClick={() => setUserZoom(1)}
                        />
                    ) : (
                        <span style={{ color: '#888' }}>图片加载失败</span>
                    )}

                    {!loading && (
                        <>
                            <div
                                onClick={settings.direction === 'ltr' ? prev : next}
                                style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '20%', cursor: 'w-resize' }}
                            />
                            <div
                                onClick={settings.direction === 'ltr' ? next : prev}
                                style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '20%', cursor: 'e-resize' }}
                            />
                        </>
                    )}
                </div>
            )}

            {settings.mode === 'scroll' && (
                <div
                    ref={scrollContainerRef}
                    style={{
                        flex: 1,
                        overflowY: 'auto',
                        overflowX: 'auto',
                        background: '#000',
                        paddingTop: 60,
                    }}
                >
                    {images.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>加载中...</div>
                    ) : (
                        images.map(img => (
                            <ScrollPage
                                key={img.index}
                                imagePath={img.path}
                                index={img.index}
                                userZoom={userZoom}
                                containerWidth={scrollContainerWidth}
                            />
                        ))
                    )}
                </div>
            )}

            {showToolbar && (
                <div
                    style={{
                        position: 'absolute',
                        bottom: 0, left: 0, right: 0,
                        padding: '6px 16px',
                        background: 'rgba(0,0,0,0.7)',
                        color: '#aaa',
                        fontSize: 11,
                        textAlign: 'center',
                    }}
                >
                    {settings.mode === 'page'
                        ? '← → 翻页 · +/− 缩放 · 0 复位 · Ctrl+滚轮 缩放 · 双击复位 · F 隐藏工具栏 · F11 全屏 · ESC 返回'
                        : '↑ ↓ / PgUp PgDn 滚动 · +/− 缩放 · 0 复位 · Ctrl+滚轮 缩放 · F 隐藏工具栏 · F11 全屏 · ESC 返回'}
                </div>
            )}
        </div>
    );
}

function ScrollPage({
                        imagePath, index, userZoom, containerWidth,
                    }: {
    imagePath: string;
    index: number;
    userZoom: number;
    containerWidth: number;
}) {
    const [src, setSrc] = useState<string | null>(null);
    const [shouldLoad, setShouldLoad] = useState(false);
    const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
    const pageRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = pageRef.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            entries => {
                if (entries[0].isIntersecting) {
                    setShouldLoad(true);
                    observer.disconnect();
                }
            },
            { rootMargin: '800px' }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!shouldLoad) return;
        let cancelled = false;
        (async () => {
            const api = (window as any).api;
            const data = await api.getImage(imagePath);
            if (!cancelled) setSrc(data);
        })();
        return () => { cancelled = true; };
    }, [shouldLoad, imagePath]);

    const imgStyle: React.CSSProperties = (() => {
        const baseWidth = containerWidth || 800;
        if (!natural) {
            return { width: baseWidth * userZoom, height: 'auto', maxWidth: 'none', display: 'block' };
        }
        const displayWidth = baseWidth * userZoom;
        const displayHeight = (natural.h / natural.w) * displayWidth;
        return {
            width: displayWidth,
            height: displayHeight,
            maxWidth: 'none',
            display: 'block',
            userSelect: 'none',
        };
    })();

    return (
        <div
            ref={pageRef}
            data-scroll-page={index}
            style={{
                display: 'flex',
                justifyContent: 'center',
                minHeight: shouldLoad ? 0 : 400,
            }}
        >
            {src ? (
                <img
                    src={src}
                    alt={`第 ${index + 1} 页`}
                    style={imgStyle}
                    draggable={false}
                    onLoad={e => {
                        const img = e.currentTarget;
                        setNatural({ w: img.naturalWidth, h: img.naturalHeight });
                    }}
                />
            ) : (
                <div
                    style={{
                        width: (containerWidth || 800) * userZoom,
                        aspectRatio: '3 / 4',
                        background: '#111',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#444',
                        fontSize: 12,
                    }}
                >
                    第 {index + 1} 页
                </div>
            )}
        </div>
    );
}

const toolBtnStyle: React.CSSProperties = {
    padding: '4px 8px',
    background: 'rgba(255,255,255,0.15)',
    color: 'white',
    borderRadius: 4,
    fontSize: 12,
    cursor: 'pointer',
    minWidth: 32,
};

const selectStyle: React.CSSProperties = {
    padding: '4px 6px',
    background: 'rgba(255,255,255,0.15)',
    color: 'white',
    borderRadius: 4,
    fontSize: 12,
    border: 'none',
    cursor: 'pointer',
    outline: 'none',
};