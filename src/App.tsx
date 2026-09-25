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
import type { Route, Series, ThemeName } from './types';

export default function App() {
    const [route, setRoute] = useState<Route>({ name: 'home' });
    const [keyword, setKeyword] = useState('');
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

    // ⭐ 导入文件夹
    const handleImport = async () => {
        const api = (window as any).api;
        const dir = await api.pickDirectory();
        if (!dir) return;
        const result = await api.scanAndImport(dir);
        if (result.success) {
            alert(`扫描到 ${result.total} 个，新导入 ${result.imported} 个`);
            // 触发刷新：切到首页再切回
            if (route.name === 'library') {
                setRoute({ name: 'home' });
                setTimeout(() => setRoute({ name: 'library' }), 0);
            } else {
                setRoute({ name: 'library' });
            }
        } else {
            alert('导入失败：' + result.error);
        }
    };

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
                    />
                );

            case 'seriesDetail':
                return (
                    <SeriesDetail
                        seriesId={route.seriesId}
                        seriesTitle={route.seriesTitle}
                        onOpenImageWall={handleOpenImageWall}
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
                            <button
                                onClick={handleImport}
                                style={{
                                    padding: '8px 16px',
                                    background: 'var(--primary)',
                                    color: 'white',
                                    borderRadius: 6,
                                    fontSize: 13,
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                }}
                            >
                                + 导入文件夹
                            </button>
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
        </div>
    );
}