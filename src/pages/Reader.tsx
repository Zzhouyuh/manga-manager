import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Chapter, ChapterImage, ReaderMode, ReaderDirection, ReaderFit } from '../types';
import SeriesTags from '../components/SeriesTags';
import { formatDuration } from '../utils/format';

type Props = {
    chapterId: number;
    chapterTitle: string;
    seriesTitle: string;
    seriesId: number;
    startPage: number;
    onBack: (currentPage?: number) => void;
    onSwitchChapter: (chapterId: number, chapterTitle: string) => void;
};

const LS_KEY = 'readerSettings';

function loadSettings() {
    const defaults = {
        mode: 'page' as ReaderMode,
        direction: 'ltr' as ReaderDirection,
        fit: 'window' as ReaderFit,   // ⭐ 默认改成"适应窗口"
        autoSpread: true,             // ⭐ 跨页（躺倒的图）自动转正
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

// ⭐ 手动旋转记忆（按图片路径）与"这页别自动转"的黑名单
const ROT_LS_KEY = 'readerPageRotations';
const NOAUTO_LS_KEY = 'readerSpreadNoAuto';
const ROT_LS_MAX = 4000;

function loadMap(key: string): Record<string, any> {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return {};
        const obj = JSON.parse(raw);
        return obj && typeof obj === 'object' ? obj : {};
    } catch { return {}; }
}

function saveMap(key: string, map: Record<string, any>) {
    try {
        let entries = Object.entries(map);
        // 记太多就丢掉最旧的一部分（对象 key 顺序 = 插入顺序）
        if (entries.length > ROT_LS_MAX) entries = entries.slice(entries.length - ROT_LS_MAX);
        localStorage.setItem(key, JSON.stringify(Object.fromEntries(entries)));
    } catch { /* ignore */ }
}

const normDeg = (d: number) => ((Math.round(d / 90) * 90) % 360 + 360) % 360;

export default function Reader({
                                   chapterId, chapterTitle, seriesTitle, seriesId, startPage, onBack, onSwitchChapter,
                               }: Props) {
    const [images, setImages] = useState<ChapterImage[]>([]);
    // ⭐ 同一系列的所有章节，用来算「上一话 / 下一话」
    const [chapters, setChapters] = useState<Chapter[]>([]);
    const [current, setCurrent] = useState(startPage);
    const currentRef = useRef(current);
    useEffect(() => { currentRef.current = current; }, [current]);

    const [imgData, setImgData] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [imgError, setImgError] = useState(false);
    // manga:// 协议取不到时的兜底（回退到 IPC 取图）
    const [imgFallback, setImgFallback] = useState<string | null>(null);
    const [showToolbar, setShowToolbar] = useState(true);

    const [isPageFav, setIsPageFav] = useState(false);
    const [isSeriesFav, setIsSeriesFav] = useState(false);
    const [tagPanel, setTagPanel] = useState(false);

    const [settings, setSettings] = useState(loadSettings);
    const [userZoom, setUserZoom] = useState(1);
    const [isFullscreen, setIsFullscreen] = useState(false);
    // ⭐ 工具栏默认不显示：鼠标一动就出现，静止 3 秒后再次收起
    const [toolbarVisible, setToolbarVisible] = useState(false);
    const toolbarTimer = useRef<number | null>(null);
    const toolbarHover = useRef(false);
    const toolbarVisibleRef = useRef(false);
    // ⭐ 左键拖动平移
    const dragRef = useRef({ active: false, moved: false, x: 0, y: 0, left: 0, top: 0 });
    const [dragging, setDragging] = useState(false);

    const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
    const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
    const containerRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [scrollContainerWidth, setScrollContainerWidth] = useState(0);

    // ⭐ 旋转：手动按页记忆 + 跨页自动矫正
    const [manualRot, setManualRot] = useState<Record<string, number>>(() => loadMap(ROT_LS_KEY));
    const [noAutoRot, setNoAutoRot] = useState<Record<string, boolean>>(() => loadMap(NOAUTO_LS_KEY));
    useEffect(() => { saveMap(ROT_LS_KEY, manualRot); }, [manualRot]);
    useEffect(() => { saveMap(NOAUTO_LS_KEY, noAutoRot); }, [noAutoRot]);
    // 每页原始宽高（主进程只读文件头，很快）；拿不到就不做自动矫正
    const [pageSizes, setPageSizes] = useState<({ w: number; h: number; bytes?: number } | null)[] | null>(null);

    useEffect(() => {
        let alive = true;
        setPageSizes(null);
        (async () => {
            const api = (window as any).api;
            if (!api || !api.getChapterImageSizes) return;
            try {
                const sizes = await api.getChapterImageSizes(chapterId);
                if (alive) setPageSizes(Array.isArray(sizes) ? sizes : null);
            } catch { if (alive) setPageSizes(null); }
        })();
        return () => { alive = false; };
    }, [chapterId]);

    /**
     * ⭐ 跨页判定（纯几何，保守）
     * 躺倒的跨页有个稳定特征：把它转 90° 之后，宽高比正好约等于"两页并排"
     * （也就是本书正常页比例的 2 倍），并且它自己明显比正常页宽。
     * 只用比例判断会误伤 3:4 之类的普通页，所以两个条件都要满足。
     */
    const spreadFlags = useMemo(() => {
        if (!pageSizes || pageSizes.length === 0) return [] as boolean[];
        const ratios = pageSizes
            .filter((s): s is { w: number; h: number; bytes?: number } => !!s && s.w > 0 && s.h > 0)
            .map(s => s.w / s.h)
            .filter(r => r > 0.5 && r < 0.95)
            .sort((a, b) => a - b);
        if (ratios.length < 12) return pageSizes.map(() => false);
        const r0 = ratios[Math.floor(ratios.length / 2)];
        const flags = pageSizes.map(s => {
            if (!s || !s.w || !s.h) return false;
            if (s.w < 300 || s.h < 300) return false;         // 小图标/缩略图不算
            // ⭐ 空白页（版权页/说明页）压出来很小，直接排除，免得被当成跨页
            if (s.bytes && s.bytes / (s.w * s.h) < 0.06) return false;
            const r = s.w / s.h;
            if (r <= 0.5 || r >= 0.95) return false;           // 不是竖着存的
            if (r < r0 * 1.03) return false;                   // 没比正常页宽，肯定不是跨页
            const dev = Math.abs(1 / r - 2 * r0) / (2 * r0);
            return dev <= 0.05;                                // 转正后 ≈ 两页并排
        });
        // ⭐ 兜底保护：一话里超过一半都"疑似跨页"说明这批扫描彻底不规整，判定不可信，
        // 这种情况宁可不自动转（交回手动）。烙印战士这种跨页很多的卷（约 30%）不受影响。
        const hitCount = flags.filter(Boolean).length;
        if (hitCount > flags.length * 0.5) return flags.map(() => false);
        return flags;
    }, [pageSizes]);

    // 某一页最终该转多少度：手动优先 > 自动矫正
    const rotationFor = (index: number) => {
        const img = images[index];
        if (!img) return 0;
        const manual = manualRot[img.path];
        if (typeof manual === 'number') return normDeg(manual);
        if (settings.autoSpread !== false && spreadFlags[index] && !noAutoRot[img.path]) return 90;
        return 0;
    };
    const isAutoRotated = (index: number) => {
        const img = images[index];
        if (!img || typeof manualRot[img.path] === 'number') return false;
        return settings.autoSpread !== false && !!spreadFlags[index] && !noAutoRot[img.path];
    };

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

    // ⭐ 切话时重置页码（同一个 Reader 组件实例会被复用，state 不会自己复位）
    useEffect(() => {
        setCurrent(startPage);
        setImages([]);        // 清掉上一话的图片列表，避免闪一下旧内容
        setImgData(null);
        setImgError(false);
        setNaturalSize(null);
        setUserZoom(1);
    }, [chapterId, startPage]);

    // ⭐ 拉取同系列的章节列表，算出上一话/下一话
    useEffect(() => {
        (async () => {
            if (!seriesId) return;
            const api = (window as any).api;
            const list = await api.listChapters(seriesId);
            setChapters(list);
        })();
    }, [seriesId, chapterId]);

    const chapterIndex = chapters.findIndex(c => c.id === chapterId);
    const prevChapter = chapterIndex > 0 ? chapters[chapterIndex - 1] : null;
    const nextChapter = chapterIndex >= 0 && chapterIndex < chapters.length - 1
        ? chapters[chapterIndex + 1]
        : null;

    const goPrevChapter = () => {
        if (prevChapter) onSwitchChapter(prevChapter.id, prevChapter.title);
    };
    const goNextChapter = () => {
        if (nextChapter) onSwitchChapter(nextChapter.id, nextChapter.title);
    };

    // 翻页；到本章头/尾就自动切上一话/下一话
    const step = (dir: number) => {
        const target = currentRef.current + dir;
        if (target < 0) {
            if (prevChapter) goPrevChapter();
            return;
        }
        if (target >= images.length) {
            if (nextChapter) goNextChapter();
            return;
        }
        setCurrent(target);
    };

    useEffect(() => {
        if (settings.mode !== 'page') return;
        if (images.length === 0) return;
        if (current < 0 || current >= images.length) return;
        const api = (window as any).api;
        setNaturalSize(null);
        setImgError(false);
        setImgFallback(null);
        // ⭐ 直接给 URL 让浏览器加载（不再走 IPC + base64）
        setImgData(api.imageUrl(images[current].path));
        api.updateProgress(chapterId, current + 1);
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

    // ⭐ 旋转后的"有效尺寸"：转了 90/270 宽高互换，缩放要按转完的比例算
    const rotation = rotationFor(current);
    const swapped = rotation % 180 !== 0;
    const rotatedSize = naturalSize
        ? (swapped ? { w: naturalSize.h, h: naturalSize.w } : { w: naturalSize.w, h: naturalSize.h })
        : null;

    // ⭐ 基础缩放
    const baseScale = (() => {
        if (!rotatedSize || containerSize.w === 0 || containerSize.h === 0) return 1;
        const scaleW = containerSize.w / rotatedSize.w;
        const scaleH = containerSize.h / rotatedSize.h;
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
            if (e.key === '[') { e.preventDefault(); goPrevChapter(); return; }
            if (e.key === ']') { e.preventDefault(); goNextChapter(); return; }
            // ⭐ 旋转：, 左转 90°，. 右转 90°，r 复位
            if (e.key === ',') { e.preventDefault(); rotateBy(-90); return; }
            if (e.key === '.') { e.preventDefault(); rotateBy(90); return; }
            if (e.key === 'r' || e.key === 'R') { e.preventDefault(); resetRotation(); return; }
            if (settings.mode === 'page') {
                if (e.key === 'ArrowRight' || e.key === ' ') {
                    e.preventDefault();
                    const dir = settings.direction === 'ltr' ? 1 : -1;
                    step(dir);
                } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    const dir = settings.direction === 'ltr' ? -1 : 1;
                    step(dir);
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
    }, [images.length, images, onBack, settings.mode, settings.direction, settings.autoSpread,
        prevChapter?.id, nextChapter?.id, current, rotation, spreadFlags]);

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

    // ==================== ⭐ 工具栏自动收起 ====================
    useEffect(() => {
        const wake = () => {
            if (!toolbarVisibleRef.current) {
                toolbarVisibleRef.current = true;
                setToolbarVisible(true);
            }
            if (toolbarTimer.current) window.clearTimeout(toolbarTimer.current);
            toolbarTimer.current = window.setTimeout(() => {
                if (toolbarHover.current) return;
                toolbarVisibleRef.current = false;
                setToolbarVisible(false);
            }, 3000);
        };
        // 一开始不主动显示：鼠标动了（或滚轮）才滑出
        window.addEventListener('mousemove', wake);
        window.addEventListener('wheel', wake, { passive: true });
        return () => {
            window.removeEventListener('mousemove', wake);
            window.removeEventListener('wheel', wake);
            if (toolbarTimer.current) window.clearTimeout(toolbarTimer.current);
        };
    }, []);

    // ==================== ⭐ 左键拖动平移 ====================
    // 内容超出容器（放大后 / 长图）才允许拖，避免影响单击翻页
    const beginDrag = (e: React.MouseEvent, el: HTMLElement | null) => {
        if (e.button !== 0 || !el) return;
        if (el.scrollWidth <= el.clientWidth + 4 && el.scrollHeight <= el.clientHeight + 4) return;
        dragRef.current = {
            active: true, moved: false,
            x: e.clientX, y: e.clientY,
            left: el.scrollLeft, top: el.scrollTop,
        };
        setDragging(true);

        // 拖动中监听整个窗口，鼠标划出容器也不会断
        const onMove = (ev: MouseEvent) => {
            const d = dragRef.current;
            if (!d.active) return;
            const dx = ev.clientX - d.x;
            const dy = ev.clientY - d.y;
            if (!d.moved && Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
            el.scrollLeft = d.left - dx;
            el.scrollTop = d.top - dy;
        };
        const onUp = () => {
            dragRef.current.active = false;
            setDragging(false);
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            // 让紧随其后的 click 事件能读到 moved，然后复位
            window.setTimeout(() => { dragRef.current.moved = false; }, 0);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    // 单击翻页（刚拖动过就不翻）；连点两下 = 连翻两页，方便快速翻页
    const turnByClick = (dir: number) => (e: React.MouseEvent) => {
        if (dragRef.current.moved) return;
        step(dir);
    };

    // ==================== ⭐ 双击放大（以点击位置为中心）/ 复位 ====================
    const handleDoubleClick = (e: React.MouseEvent) => {
        const el = containerRef.current;
        if (!el) return;

        // 已经放大了：双击任意位置都算复位
        if (userZoom > 1.05) {
            setUserZoom(1);
            return;
        }

        // 没放大时：只有中间区域双击才放大
        // 左右各 20% 是翻页热区，快速连点那里 = 连翻两页，不该被误解成放大手势
        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const w = rect.width || 1;
        if (x < w * 0.2 || x > w * 0.8) return;

        const ox = e.clientX - rect.left;
        const oy = e.clientY - rect.top;
        const fx = (el.scrollLeft + ox) / Math.max(1, el.scrollWidth);
        const fy = (el.scrollTop + oy) / Math.max(1, el.scrollHeight);
        setUserZoom(2);
        // 等缩放应用完，再把点击位置滚回原处
        requestAnimationFrame(() => {
            const el2 = containerRef.current;
            if (!el2) return;
            el2.scrollLeft = fx * el2.scrollWidth - ox;
            el2.scrollTop = fy * el2.scrollHeight - oy;
        });
    };

    // 内容是否超出容器（用来决定鼠标指针形状）
    const canPan = userZoom > 1.05 || (settings.mode === 'page' && !!naturalSize && (
        (rotatedSize ? rotatedSize.w : naturalSize.w) * actualScale > containerSize.w + 4 ||
        (rotatedSize ? rotatedSize.h : naturalSize.h) * actualScale > containerSize.h + 4
    ));

    // ⭐ 右键菜单
    const handleContextMenu = async (e: React.MouseEvent) => {
        e.preventDefault();
        const api = (window as any).api;
        const chapter = await api.getChapter(chapterId);
        const filePath: string = (chapter && chapter.file_path) || '';

        const action = await api.contextMenu([
            { id: 'fav', label: isPageFav ? `取消收藏第 ${current + 1} 页` : `收藏第 ${current + 1} 页` },
            { separator: true },
            { id: 'rot-l', label: '左转 90°' },
            { id: 'rot-r', label: '右转 90°' },
            { id: 'rot-0', label: `恢复原方向${rotation ? '（当前 ' + rotation + '°）' : ''}`, enabled: rotation !== 0 },
            { separator: true },
            { id: 'reveal', label: '打开漫画文件所在位置', enabled: !!filePath },
            { id: 'copy', label: '复制文件路径', enabled: !!filePath },
            { separator: true },
            { id: 'toolbar', label: showToolbar ? '隐藏工具栏' : '显示工具栏' },
        ]);
        if (!action) return;

        if (action === 'fav') {
            await handleTogglePageFav();
        } else if (action === 'rot-l') {
            rotateBy(-90);
        } else if (action === 'rot-r') {
            rotateBy(90);
        } else if (action === 'rot-0') {
            resetRotation();
        } else if (action === 'toolbar') {
            setShowToolbar(v => !v);
            setToolbarVisible(true);
            toolbarVisibleRef.current = true;
        } else if (action === 'reveal') {
            const r = await api.revealPath(filePath);
            if (!r.success) alert('打开失败：' + (r.error || '未知错误'));
        } else if (action === 'copy') {
            await api.copyText(filePath);
        }
    };

    // ==================== ⭐ 阅读时长计时器 ====================
    // 只在本话里累计：窗口可见且聚焦时才计时（切走、最小化不算）
    const baseSecondsRef = useRef(0);      // 本话历史累计（来自数据库）
    const pendingRef = useRef(0);          // 还没写进数据库的秒数
    const baseInitedRef = useRef<number | null>(null);
    const [readSeconds, setReadSeconds] = useState(0);

    useEffect(() => {
        if (baseInitedRef.current === chapterId) return;   // 同一话只初始化一次
        baseInitedRef.current = chapterId;
        const me = chapters.find(c => c.id === chapterId);
        baseSecondsRef.current = (me && me.reading_seconds) || 0;
        pendingRef.current = 0;
        setReadSeconds(baseSecondsRef.current);
    }, [chapters, chapterId]);

    useEffect(() => {
        const timer = window.setInterval(() => {
            if (document.hidden || !document.hasFocus()) return;
            pendingRef.current += 1;
            setReadSeconds(s => s + 1);
        }, 1000);
        return () => window.clearInterval(timer);
    }, []);

    // 每 15 秒落一次库；切话或离开阅读器时也会落
    useEffect(() => {
        const flush = () => {
            const s = pendingRef.current;
            if (s <= 0) return;
            pendingRef.current = 0;
            baseSecondsRef.current += s;
            const api = (window as any).api;
            if (api && api.addReadingTime) api.addReadingTime(chapterId, s);
        };
        const timer = window.setInterval(flush, 15000);
        return () => {
            window.clearInterval(timer);
            flush();
        };
    }, [chapterId]);

    useEffect(() => {
        const handler = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', handler);
        return () => document.removeEventListener('fullscreenchange', handler);
    }, []);

    const prev = () => step(-1);
    const next = () => step(1);

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

    // ⭐ 旋转用 CSS transform 做：外面套一个"转完之后"尺寸的盒子，里面图片绕中心旋转
    const dispW = naturalSize ? Math.max(1, Math.round(naturalSize.w * actualScale)) : 0;
    const dispH = naturalSize ? Math.max(1, Math.round(naturalSize.h * actualScale)) : 0;
    const boxW = swapped ? dispH : dispW;
    const boxH = swapped ? dispW : dispH;

    const pageImgStyle: React.CSSProperties = naturalSize
        ? {
            position: 'absolute',
            left: Math.round((boxW - dispW) / 2),
            top: Math.round((boxH - dispH) / 2),
            width: dispW,
            height: dispH,
            transform: rotation ? `rotate(${rotation}deg)` : undefined,
            userSelect: 'none',
            display: 'block',
            maxWidth: 'none',
        }
        : {
            userSelect: 'none', display: 'block', maxWidth: '100%', maxHeight: '100%',
            transform: rotation ? `rotate(${rotation}deg)` : undefined,
        };

    const pageWrapStyle: React.CSSProperties = naturalSize
        ? { position: 'relative', width: boxW, height: boxH, flex: '0 0 auto' }
        : { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' };

    // ==================== ⭐ 手动旋转 / 撤销自动矫正 ====================
    const rotateBy = (delta: number) => {
        const img = images[current];
        if (!img) return;
        setManualRot(m => ({ ...m, [img.path]: normDeg(rotation + delta) }));
    };

    // 复位：回到"原图方向"；如果这页本来是自动转正的，就顺便拉黑，免得转回来又被自动转走
    const resetRotation = () => {
        const img = images[current];
        if (!img) return;
        setManualRot(m => {
            const next = { ...m };
            delete next[img.path];
            return next;
        });
        if (settings.autoSpread !== false && spreadFlags[current]) {
            setNoAutoRot(m => ({ ...m, [img.path]: true }));
        }
    };

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
            {showToolbar && toolbarVisible && (
                <div
                    onMouseEnter={() => { toolbarHover.current = true; setToolbarVisible(true); toolbarVisibleRef.current = true; }}
                    onMouseLeave={() => { toolbarHover.current = false; }}
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

                    {/* ⭐ 换话 */}
                    <button
                        onClick={goPrevChapter}
                        disabled={!prevChapter}
                        title="上一话（快捷键 [）"
                        style={{
                            ...toolBtnStyle,
                            opacity: prevChapter ? 1 : 0.35,
                            cursor: prevChapter ? 'pointer' : 'default',
                        }}
                    >
                        ⏮
                    </button>
                    {chapters.length > 1 && (
                        <span style={{ minWidth: 58, textAlign: 'center', opacity: 0.75 }}>
                            {chapterIndex + 1} / {chapters.length} 话
                        </span>
                    )}
                    <button
                        onClick={goNextChapter}
                        disabled={!nextChapter}
                        title="下一话（快捷键 ]）"
                        style={{
                            ...toolBtnStyle,
                            opacity: nextChapter ? 1 : 0.35,
                            cursor: nextChapter ? 'pointer' : 'default',
                        }}
                    >
                        ⏭
                    </button>

                    <button onClick={() => setUserZoom(z => Math.max(0.1, z - 0.25))} style={toolBtnStyle}>➖</button>
                    <span style={{ minWidth: 50, textAlign: 'center' }}>
            {settings.mode === 'page'
                ? `${Math.round(actualScale * 100)}%`
                : `${Math.round(userZoom * 100)}%`}
          </span>
                    <button onClick={() => setUserZoom(z => Math.min(5, z + 0.25))} style={toolBtnStyle}>➕</button>
                    <button onClick={() => setUserZoom(1)} style={toolBtnStyle}>⟳</button>

                    {/* ⭐ 旋转：手动左右转 + 一键还原 + 跨页自动更正开关 */}
                    <button onClick={() => rotateBy(-90)} title="左转 90°（快捷键 ,）" style={toolBtnStyle}>↺</button>
                    <button onClick={() => rotateBy(90)} title="右转 90°（快捷键 .）" style={toolBtnStyle}>↻</button>
                    {rotation !== 0 && (
                        <button onClick={resetRotation} title="恢复原方向（快捷键 R）" style={{
                            ...toolBtnStyle,
                            background: 'rgba(234,179,8,0.28)',
                            color: '#fbbf24',
                        }}>0°</button>
                    )}
                    <button
                        onClick={() => setSettings({ ...settings, autoSpread: settings.autoSpread === false })}
                        title="躺倒的跨页自动转正（按比例判断，仅对 mobi/文件夹生效）"
                        style={{
                            ...toolBtnStyle,
                            minWidth: 56,
                            background: settings.autoSpread !== false ? 'rgba(34,197,94,0.28)' : toolBtnStyle.background,
                            color: settings.autoSpread !== false ? '#86efac' : 'white',
                        }}
                    >
                        跨页矫正
                    </button>

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

                    {/* ⭐ 标签 */}
                    <button
                        onClick={() => setTagPanel(v => !v)}
                        title="给这本漫画打标签"
                        style={{
                            ...toolBtnStyle,
                            background: tagPanel ? 'rgba(255,255,255,0.3)' : toolBtnStyle.background,
                        }}
                    >
                        🏷
                    </button>

                    <button onClick={toggleFullscreen} style={toolBtnStyle}>
                        {isFullscreen ? '⤢' : '⛶'}
                    </button>

                    <div style={{ minWidth: 64, textAlign: 'right' }} title="本话累计阅读时长">
                        ⏱ {formatDuration(readSeconds)}
                    </div>

                    <div style={{ minWidth: 60, textAlign: 'right' }}>
                        {current + 1} / {images.length}
                    </div>
                </div>
            )}

            {/* ⭐ 标签小面板 */}
            {tagPanel && (
                <div
                    style={{
                        position: 'absolute',
                        top: 56,
                        right: 12,
                        zIndex: 20,
                        maxWidth: 'min(560px, 85vw)',
                        padding: 12,
                        borderRadius: 8,
                        background: 'rgba(0,0,0,0.92)',
                        border: '1px solid rgba(255,255,255,0.15)',
                    }}
                >
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: 8,
                        }}
                    >
                        <span style={{ color: '#bbb', fontSize: 11 }}>给「{seriesTitle}」打标签</span>
                        <button
                            onClick={() => setTagPanel(false)}
                            style={{ color: '#bbb', fontSize: 14, lineHeight: 1 }}
                        >
                            ×
                        </button>
                    </div>
                    <SeriesTags seriesId={seriesId} compact />
                </div>
            )}

            {/* ⭐ 自动矫正提示：告诉用户这页被转过，并给一键还原 */}
            {toolbarVisible && rotation !== 0 && isAutoRotated(current) && (
                <div
                    style={{
                        position: 'absolute',
                        top: 56,
                        left: 12,
                        zIndex: 15,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 10px',
                        borderRadius: 6,
                        background: 'rgba(34,197,94,0.22)',
                        border: '1px solid rgba(34,197,94,0.45)',
                        color: '#86efac',
                        fontSize: 11,
                    }}
                >
                    <span>检测到跨页，已自动转正</span>
                    <button
                        onClick={resetRotation}
                        style={{ ...toolBtnStyle, padding: '2px 8px', fontSize: 11 }}
                    >
                        还原
                    </button>
                </div>
            )}

            {settings.mode === 'page' && (
                <div
                    ref={containerRef}
                    onMouseDown={e => beginDrag(e, containerRef.current)}
                    onDoubleClick={handleDoubleClick}
                    onContextMenu={handleContextMenu}
                    onDragStart={e => e.preventDefault()}
                    style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        position: 'relative',
                        overflow: 'auto',
                        cursor: dragging ? 'grabbing' : (canPan ? 'grab' : 'default'),
                        userSelect: 'none',
                    }}
                >
                    {imgData ? (
                        <div style={pageWrapStyle}>
                            <img
                                src={imgFallback || imgData}
                                alt={`第 ${current + 1} 页`}
                                style={pageImgStyle}
                                draggable={false}
                                decoding="async"
                                onLoad={e => {
                                    const img = e.currentTarget;
                                    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
                                }}
                                onError={async () => {
                                    // manga:// 挂了就退回 IPC 取图（老路子，稳）
                                    if (!imgFallback) {
                                        const api = (window as any).api;
                                        const data = await api.getImage(images[current].path);
                                        if (data) { setImgFallback(data); return; }
                                    }
                                    setImgError(true);
                                    setImgData(null);
                                }}
                            />
                        </div>
                    ) : imgError ? (
                        <span style={{ color: '#888' }}>图片加载失败</span>
                    ) : (
                        <span style={{ color: '#888' }}>加载中...</span>
                    )}

                    {/* ⭐ 预加载下一页，翻页时基本无等待 */}
                    {settings.mode === 'page' && images[current + 1] && (
                        <img
                            src={(window as any).api.imageUrl(images[current + 1].path)}
                            alt=""
                            aria-hidden
                            draggable={false}
                            style={{
                                position: 'absolute',
                                width: 1,
                                height: 1,
                                opacity: 0,
                                pointerEvents: 'none',
                            }}
                        />
                    )}

                    {!loading && (
                        <>
                            <div
                                onClick={turnByClick(settings.direction === 'ltr' ? -1 : 1)}
                                style={{
                                    position: 'absolute', left: 0, top: 0, bottom: 0, width: '20%',
                                    cursor: canPan ? (dragging ? 'grabbing' : 'grab') : 'w-resize',
                                }}
                            />
                            <div
                                onClick={turnByClick(settings.direction === 'ltr' ? 1 : -1)}
                                style={{
                                    position: 'absolute', right: 0, top: 0, bottom: 0, width: '20%',
                                    cursor: canPan ? (dragging ? 'grabbing' : 'grab') : 'e-resize',
                                }}
                            />
                        </>
                    )}
                </div>
            )}

            {settings.mode === 'scroll' && (
                <div
                    ref={scrollContainerRef}
                    onMouseDown={e => beginDrag(e, scrollContainerRef.current)}
                    onContextMenu={handleContextMenu}
                    onDragStart={e => e.preventDefault()}
                    style={{
                        flex: 1,
                        overflowY: 'auto',
                        overflowX: 'auto',
                        background: '#000',
                        paddingTop: 60,
                        cursor: dragging ? 'grabbing' : (userZoom > 1.02 ? 'grab' : 'default'),
                        userSelect: 'none',
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
                                rotation={rotationFor(img.index)}
                            />
                        ))
                    )}
                </div>
            )}

            {showToolbar && toolbarVisible && (
                <div
                    onMouseEnter={() => { toolbarHover.current = true; setToolbarVisible(true); toolbarVisibleRef.current = true; }}
                    onMouseLeave={() => { toolbarHover.current = false; }}
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
                        ? '← → 翻页（到底自动切下一话）· 双击画面中间放大 · 放大后双击复位、左键拖动移动画面 · [ ] 换话 · +/− 缩放 · 0 复位缩放 · Ctrl+滚轮 缩放 · , . 左/右转 90° · R 恢复原方向 · F 隐藏工具栏 · F11 全屏 · ESC 返回'
                        : '↑ ↓ / PgUp PgDn 滚动 · 左键拖动移动画面 · [ ] 换话 · +/− 缩放 · 0 复位缩放 · Ctrl+滚轮 缩放 · , . 左/右转 90° · R 恢复原方向 · F 隐藏工具栏 · F11 全屏 · ESC 返回'}
                </div>
            )}
        </div>
    );
}

// ⭐ memo：阅读时长每秒刷新时，不要连带把整列页面重新渲染一遍
const ScrollPage = memo(function ScrollPageInner({
                        imagePath, index, userZoom, containerWidth, rotation,
                    }: {
    imagePath: string;
    index: number;
    userZoom: number;
    containerWidth: number;
    rotation: number;
}) {
    const [shouldLoad, setShouldLoad] = useState(false);
    const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
    const [fallback, setFallback] = useState<string | null>(null);
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
            { rootMargin: '450px' }   // 预取范围收小：滚动时不会一次解码太多大图
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    // ⭐ 走 manga:// 协议直接加载原图
    const src: string | null = shouldLoad ? (window as any).api.imageUrl(imagePath) : null;

    // ⭐ 转了 90/270 时宽高互换：外框按"转完之后"的尺寸，图片按原尺寸绕中心转
    const swapped = rotation % 180 !== 0;
    const baseWidth = containerWidth || 800;
    const dispW = natural
        ? baseWidth * userZoom
        : baseWidth * userZoom;
    const natW = natural ? (swapped ? natural.h : natural.w) : 1;
    const natH = natural ? (swapped ? natural.w : natural.h) : 1;
    const dispH = natural ? (natH / natW) * dispW : 0;
    const imgW = natural ? (swapped ? dispH : dispW) : dispW;
    const imgH = natural ? (swapped ? dispW : dispH) : undefined;

    const boxStyle: React.CSSProperties = natural
        ? { position: 'relative', width: dispW, height: dispH, flex: '0 0 auto' }
        : { position: 'relative', width: dispW, flex: '0 0 auto' };

    const imgStyle: React.CSSProperties = natural
        ? {
            position: 'absolute',
            left: Math.round((dispW - imgW) / 2),
            top: Math.round((dispH - (imgH || 0)) / 2),
            width: imgW,
            height: imgH,
            maxWidth: 'none',
            display: 'block',
            userSelect: 'none',
            transform: rotation ? `rotate(${rotation}deg)` : undefined,
        }
        : { width: imgW, height: 'auto', maxWidth: 'none', display: 'block', userSelect: 'none' };

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
                <div style={boxStyle}>
                    <img
                        src={fallback || src}
                        alt={`第 ${index + 1} 页`}
                        style={imgStyle}
                        draggable={false}
                        decoding="async"
                        onLoad={e => {
                            const img = e.currentTarget;
                            setNatural({ w: img.naturalWidth, h: img.naturalHeight });
                        }}
                        onError={async () => {
                            if (fallback) return;
                            const api = (window as any).api;
                            const data = await api.getImage(imagePath);
                            if (data) setFallback(data);
                        }}
                    />
                </div>
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
});

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
