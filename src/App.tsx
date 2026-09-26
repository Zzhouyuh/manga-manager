import { useEffect, useState } from 'react';
import Sidebar, { PageKey } from './components/Sidebar';
import Home from './pages/Home';
import Library from './pages/Library';
import SeriesDetail from './pages/SeriesDetail';
import ImageWall from './pages/ImageWall';
import Reader from './pages/Reader';
import Favorites from './pages/Favorites';
import Settings from './pages/Settings';
import { applyTheme } from './themes';
import ProgressBar from './components/ProgressBar';
import type { Route, Series, Tag, ThemeName } from './types';

// ⭐ 导入进度弹窗状态
type ImportUiState = {
    running: boolean;
    phase: 'scan' | 'import' | 'done';
    current: number;
    total: number;
    name: string;
    result: any;
} | null;

export default function App() {
    const [route, setRoute] = useState<Route>({ name: 'home' });
    const [keyword, setKeyword] = useState('');
    // ⭐ 标签
    const [tags, setTags] = useState<Tag[]>([]);
    const [activeTag, setActiveTag] = useState<Tag | null>(null);
    const [importUi, setImportUi] = useState<ImportUiState>(null);
    const [coverMode, setCoverMode] = useState<'dynamic' | 'static'>(() => {
        return (localStorage.getItem('coverMode') as any) || 'dynamic';
    });
    const [theme, setTheme] = useState<ThemeName>(() => {
        return (localStorage.getItem('theme') as ThemeName) || 'dark';
    });
    // ⭐ 上次在图片墙浏览的位置
    const [wallScrollTarget, setWallScrollTarget] = useState<{ chapterId: number; pageIndex: number } | null>(null);

    // 应用主题
    useEffect(() => {
        applyTheme(theme);
        localStorage.setItem('theme', theme);
    }, [theme]);

    useEffect(() => {
        localStorage.setItem('coverMode', coverMode);
    }, [coverMode]);

    // ⭐ 标签列表（侧边栏显示 + 筛选用）
    const loadTags = async () => {
        const api = (window as any).api;
        try {
            setTags(await api.listTags());
        } catch (e) {
            console.warn('加载标签失败:', e);
        }
    };

    useEffect(() => {
        loadTags();
    }, []);

    // ⭐ 导入进度推送
    useEffect(() => {
        const api = (window as any).api;
        if (!api.onImportProgress) return;
        const off = api.onImportProgress((p: any) => {
            setImportUi(prev => (prev && prev.running
                ? { ...prev, phase: p.phase, current: p.current, total: p.total, name: p.name || '' }
                : prev));
        });
        return off;
    }, []);

    // 导航
    const handleNavigate = (page: PageKey) => {
        if (page === 'home') setRoute({ name: 'home' });
        else if (page === 'library') setRoute({ name: 'library' });
        else if (page === 'favorites') setRoute({ name: 'favorites' });
        else if (page === 'settings') setRoute({ name: 'settings' });
    };

    // 侧边栏高亮
    const currentNav: PageKey = (() => {
        if (route.name === 'home') return 'home';
        if (route.name === 'library' || route.name === 'seriesDetail' || route.name === 'imageWall' || route.name === 'reader') return 'library';
        if (route.name === 'favorites') return 'favorites';
        if (route.name === 'settings') return 'settings';
        return 'home';
    })();

    // ========== 页面跳转函数 ==========

    const handleHomeOpenReader = (
        chapterId: number, chapterTitle: string,
        seriesId: number, seriesTitle: string, startPage: number
    ) => {
        setRoute({
            name: 'reader',
            chapterId, chapterTitle,
            seriesId, seriesTitle,
            startPage: startPage > 0 ? startPage - 1 : 0,
        });
    };

    const handleLibraryCardClick = (series: Series) => {
        setRoute({
            name: 'seriesDetail',
            seriesId: series.id,
            seriesTitle: series.title,
        });
    };

    const handleLibraryDirectReader = (
        chapterId: number, chapterTitle: string,
        seriesId: number, seriesTitle: string, _startPage: number
    ) => {
        setRoute({
            name: 'imageWall',
            chapterId, chapterTitle,
            seriesId, seriesTitle,
            isSingleChapter: true,
        });
    };

    const handleOpenImageWall = (chapterId: number, chapterTitle: string) => {
        if (route.name !== 'seriesDetail') return;
        setRoute({
            name: 'imageWall',
            chapterId, chapterTitle,
            seriesId: route.seriesId,
            seriesTitle: route.seriesTitle,
            isSingleChapter: false,
        });
    };

    const handleOpenReaderFromWall = (startPage: number) => {
        if (route.name !== 'imageWall') return;
        setRoute({
            name: 'reader',
            chapterId: route.chapterId,
            chapterTitle: route.chapterTitle,
            seriesId: route.seriesId,
            seriesTitle: route.seriesTitle,
            startPage,
        });
    };

    // ⭐ 阅读器里切上一话 / 下一话
    const handleSwitchChapter = (chapterId: number, chapterTitle: string) => {
        if (route.name !== 'reader') return;
        setRoute({
            name: 'reader',
            chapterId, chapterTitle,
            seriesId: route.seriesId,
            seriesTitle: route.seriesTitle,
            startPage: 0,
        });
    };

    // ⭐ 标签：筛选 / 删除
    const handleSelectTag = (tag: Tag | null) => {
        setActiveTag(tag);
        if (tag && route.name !== 'library') setRoute({ name: 'library' });
    };

    const handleDeleteTag = async (tag: Tag) => {
        if (!window.confirm(`删除标签「${tag.name}」？\n\n只删标签，不会删除任何漫画。`)) return;
        const api = (window as any).api;
        await api.deleteTag(tag.id);
        if (activeTag && activeTag.id === tag.id) setActiveTag(null);
        await loadTags();
    };

    const handleBack = (currentPage?: number) => {
        if (route.name === 'reader' && route.seriesId) {
            if (typeof currentPage === 'number') {
                setWallScrollTarget({ chapterId: route.chapterId, pageIndex: currentPage });
            }
            setRoute({
                name: 'imageWall',
                chapterId: route.chapterId,
                chapterTitle: route.chapterTitle,
                seriesId: route.seriesId,
                seriesTitle: route.seriesTitle,
                isSingleChapter: false,
            });
        } else if (route.name === 'imageWall') {
            setWallScrollTarget(null);
            if (route.isSingleChapter) {
                setRoute({ name: 'library' });
            } else {
                setRoute({
                    name: 'seriesDetail',
                    seriesId: route.seriesId,
                    seriesTitle: route.seriesTitle,
                });
            }
        } else if (route.name === 'seriesDetail') {
            setRoute({ name: 'library' });
        } else {
            setRoute({ name: 'home' });
        }
    };

    // 刷新漫画库：切到首页再切回，触发重新加载
    const refreshLibrary = () => {
        if (route.name === 'library') {
            setRoute({ name: 'home' });
            setTimeout(() => setRoute({ name: 'library' }), 0);
        } else {
            setRoute({ name: 'library' });
        }
    };

    // ⭐ 导入（带进度弹窗）
    const runImport = async (kind: 'folder' | 'files') => {
        const api = (window as any).api;
        const target = kind === 'folder' ? await api.pickDirectory() : await api.pickFiles();
        if (!target || (Array.isArray(target) && target.length === 0)) return;

        setImportUi({ running: true, phase: 'scan', current: 0, total: 0, name: '', result: null });
        try {
            const result = kind === 'folder'
                ? await api.scanAndImport(target)
                : await api.importFiles(target);
            setImportUi({ running: false, phase: 'done', current: 0, total: 0, name: '', result });
            if (result && result.success) refreshLibrary();
        } catch (e: any) {
            setImportUi({
                running: false, phase: 'done', current: 0, total: 0, name: '',
                result: { success: false, error: (e && e.message) || String(e) },
            });
        }
    };

    const handleImport = () => runImport('folder');
    const handleImportFiles = () => runImport('files');

    // ========== 渲染页面 ==========

    const renderPage = () => {
        switch (route.name) {
            case 'home':
                return (
                    <Home
                        onOpenSeries={(sid, st) => setRoute({ name: 'seriesDetail', seriesId: sid, seriesTitle: st })}
                        onOpenReader={handleHomeOpenReader}
                    />
                );

            case 'library':
                return (
                    <Library
                        keyword={keyword}
                        coverMode={coverMode}
                        onOpenSeries={handleLibraryCardClick}
                        onOpenReader={handleLibraryDirectReader}
                        tagFilter={activeTag}
                        onClearTagFilter={() => setActiveTag(null)}
                    />
                );

            case 'seriesDetail':
                return (
                    <SeriesDetail
                        seriesId={route.seriesId}
                        seriesTitle={route.seriesTitle}
                        onOpenImageWall={handleOpenImageWall}
                        onTagsChanged={loadTags}
                    />
                );

            case 'imageWall':
                return (
                    <ImageWall
                        chapterId={route.chapterId}
                        chapterTitle={route.chapterTitle}
                        seriesTitle={route.seriesTitle}
                        scrollTarget={
                            wallScrollTarget && wallScrollTarget.chapterId === route.chapterId
                                ? wallScrollTarget.pageIndex
                                : null
                        }
                        onBack={handleBack}
                        onOpenReader={handleOpenReaderFromWall}
                    />
                );

            case 'reader':
                return (
                    <Reader
                        chapterId={route.chapterId}
                        chapterTitle={route.chapterTitle}
                        seriesTitle={route.seriesTitle}
                        seriesId={route.seriesId}
                        startPage={route.startPage}
                        onBack={handleBack}
                        onSwitchChapter={handleSwitchChapter}
                    />
                );

            case 'favorites':
                return (
                    <Favorites
                        coverMode={coverMode}
                        onOpenSeries={(s) => setRoute({ name: 'seriesDetail', seriesId: s.id, seriesTitle: s.title })}
                        onOpenReader={handleHomeOpenReader}
                    />
                );

            case 'settings':
                return (
                    <Settings
                        theme={theme}
                        onThemeChange={setTheme}
                        coverMode={coverMode}
                        onCoverModeChange={setCoverMode}
                    />
                );
        }
    };

    const title = (() => {
        switch (route.name) {
            case 'home': return '🏠 首页';
            case 'library': return `📚 漫画库`;
            case 'seriesDetail': return `📖 ${route.seriesTitle}`;
            case 'imageWall': return `🖼️ ${route.chapterTitle}`;
            case 'reader': return `📖 ${route.chapterTitle}`;
            case 'favorites': return '⭐ 收藏';
            case 'settings': return '⚙️ 设置';
        }
    })();

    const fullscreen = route.name === 'reader' || route.name === 'imageWall';

    return (
        <div style={{ display: 'flex', width: '100vw', height: '100vh' }}>
            <Sidebar
                current={currentNav}
                onNavigate={handleNavigate}
                searchKeyword={keyword}
                onSearch={kw => {
                    setKeyword(kw);
                    if (kw && route.name !== 'library') {
                        setRoute({ name: 'library' });
                    }
                }}
                tags={tags}
                activeTagId={activeTag ? activeTag.id : null}
                onSelectTag={handleSelectTag}
                onDeleteTag={handleDeleteTag}
            />

            <main
                style={{
                    flex: 1,
                    overflowY: fullscreen ? 'hidden' : 'auto',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                }}
            >
                {!fullscreen && (
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            padding: '20px 24px 16px',
                        }}
                    >
                        {route.name !== 'home' && route.name !== 'library' && route.name !== 'favorites' && route.name !== 'settings' ? (
                            <button
                                onClick={() => handleBack()}
                                style={{
                                    padding: '6px 12px',
                                    background: 'var(--card)',
                                    borderRadius: 6,
                                    fontSize: 13,
                                }}
                            >
                                ← 返回
                            </button>
                        ) : null}
                        <h1 style={{ fontSize: 22, fontWeight: 600, flex: 1 }}>{title}</h1>

                        {/* ⭐ 导入按钮（首页 / 漫画库显示） */}
                        {(route.name === 'home' || route.name === 'library') && (
                            <>
                                <button
                                    onClick={handleImportFiles}
                                    disabled={!!(importUi && importUi.running)}
                                    style={{
                                        ...importBtnStyle,
                                        opacity: importUi && importUi.running ? 0.5 : 1,
                                    }}
                                >
                                    + 导入文件（MOBI）
                                </button>
                                <button
                                    onClick={handleImport}
                                    disabled={!!(importUi && importUi.running)}
                                    style={{
                                        ...importBtnAltStyle,
                                        opacity: importUi && importUi.running ? 0.5 : 1,
                                    }}
                                >
                                    + 导入文件夹
                                </button>
                            </>
                        )}
                    </div>
                )}

                <div
                    style={{
                        flex: 1,
                        overflow: 'auto',
                        padding: fullscreen ? 0 : '0 24px 24px',
                    }}
                >
                    {renderPage()}
                </div>
            </main>

            {/* ⭐ 导入进度 / 结果 */}
            {importUi && (
                <ImportDialog state={importUi} onClose={() => setImportUi(null)} />
            )}
        </div>
    );
}

// ⭐ 导入进度 / 结果弹窗
function ImportDialog({ state, onClose }: { state: NonNullable<ImportUiState>; onClose: () => void }) {
    const { running, phase, current, total, name, result } = state;
    const ok = !!(result && result.success);
    const title = running
        ? (phase === 'import' ? '正在写入漫画库…' : '正在扫描文件…')
        : (ok ? '导入完成' : '导入失败');

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 200,
            }}
        >
            <div
                style={{
                    width: 520,
                    maxWidth: '92vw',
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    padding: 22,
                    color: 'var(--text)',
                }}
            >
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>{title}</div>

                {running ? (
                    <>
                        <ProgressBar value={total ? current / total : 0} height={6} />
                        <div
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                gap: 12,
                                fontSize: 12,
                                color: 'var(--text-secondary)',
                                marginTop: 10,
                            }}
                        >
                            <span
                                style={{
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}
                                title={name}
                            >
                                {name || '准备中…'}
                            </span>
                            <span style={{ flexShrink: 0 }}>{total ? `${current} / ${total}` : ''}</span>
                        </div>
                    </>
                ) : (
                    <>
                        {ok ? (
                            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 2 }}>
                                <div>
                                    扫描到 <b style={{ color: 'var(--text)' }}>{result.total}</b> 个文件
                                </div>
                                <div>
                                    新导入 <b style={{ color: 'var(--text)' }}>{result.imported}</b> 个
                                    {result.updated ? `，更新 ${result.updated} 个` : ''}
                                    {result.skipped ? `，已存在 ${result.skipped} 个` : ''}
                                </div>
                                {result.failures && result.failures.length > 0 && (
                                    <div style={{ marginTop: 10 }}>
                                        <div style={{ color: '#eab308' }}>
                                            ⚠️ {result.failures.length} 个文件有问题：
                                        </div>
                                        {result.failures.slice(0, 6).map((f: any, i: number) => (
                                            <div
                                                key={i}
                                                style={{
                                                    fontSize: 12,
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                }}
                                                title={`${f.file} — ${f.reason}`}
                                            >
                                                · {String(f.file).replace(/^.*[\\/]/, '')}：{f.reason}
                                            </div>
                                        ))}
                                        {result.failures.length > 6 && (
                                            <div style={{ fontSize: 12 }}>
                                                …还有 {result.failures.length - 6} 个
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div style={{ fontSize: 13, color: '#f87171' }}>
                                {(result && result.error) || '未知错误'}
                            </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
                            <button
                                onClick={onClose}
                                style={{
                                    padding: '6px 18px',
                                    background: 'var(--primary)',
                                    color: 'white',
                                    borderRadius: 6,
                                    fontSize: 13,
                                }}
                            >
                                知道了
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

const importBtnStyle: React.CSSProperties = {
    padding: '8px 16px',
    background: 'var(--primary)',
    color: 'white',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
};

const importBtnAltStyle: React.CSSProperties = {
    ...importBtnStyle,
    background: 'var(--card)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    fontWeight: 400,
};
