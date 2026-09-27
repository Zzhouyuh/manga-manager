import { useEffect, useState } from 'react';
import type { Series } from '../types';
import ProgressBar from './ProgressBar';

type Props = {
    series: Series;
    coverMode: 'dynamic' | 'static';
    onClick: (series: Series) => void;
    onDelete?: (series: Series) => void;
    onToggleFavorite?: (series: Series) => void;   // ⭐ 新增
    onOpenDetail?: (series: Series) => void;       // ⭐ 直接打开详情页（章节/标签）
    onContextMenu?: (series: Series) => void;      // ⭐ 右键菜单
};

export default function SeriesCard({
                                       series, coverMode, onClick, onDelete, onToggleFavorite, onOpenDetail, onContextMenu,
                                   }: Props) {
    // ⭐ 封面走 manga:// 协议，浏览器直接加载并自带缓存
    const [coverFailed, setCoverFailed] = useState(false);
    const [hover, setHover] = useState(false);
    const [isFav, setIsFav] = useState(series.is_favorite === 1);

    // series 属性变化时同步（比如刷新后）
    useEffect(() => {
        setIsFav(series.is_favorite === 1);
    }, [series.is_favorite]);

    // 换封面模式/换书时重置失败标记
    useEffect(() => {
        setCoverFailed(false);
    }, [series.id, coverMode]);

    const coverSrc = (window as any).api.coverUrl(series.id, coverMode);

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (onDelete) onDelete(series);
    };

    const handleToggleFav = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!onToggleFavorite) return;
        // 立即乐观更新（UI 先变，再等后端）
        const next = !isFav;
        setIsFav(next);
        onToggleFavorite({ ...series, is_favorite: next ? 1 : 0 });
    };

    return (
        <div
            onClick={() => onClick(series)}
            onContextMenu={e => {
                if (!onContextMenu) return;
                e.preventDefault();
                onContextMenu(series);
            }}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                background: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                overflow: 'hidden',
                cursor: 'pointer',
                transition: 'transform 0.15s, background 0.15s',
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
            }}
        >
            {/* 封面 */}
            <div
                style={{
                    width: '100%',
                    aspectRatio: '3 / 4',
                    background: 'var(--bg-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    position: 'relative',
                }}
            >
                {!coverFailed ? (
                    <img
                        src={coverSrc}
                        alt={series.title}
                        draggable={false}
                        loading="lazy"
                        decoding="async"
                        onError={() => setCoverFailed(true)}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                ) : (
                    <span style={{ color: 'var(--text-secondary)', fontSize: 40 }}>📕</span>
                )}

                {/* ⭐ 收藏按钮（右下角，常驻显示） */}
                {onToggleFavorite && (
                    <button
                        onClick={handleToggleFav}
                        title={isFav ? '取消收藏' : '收藏这本漫画'}
                        style={{
                            position: 'absolute',
                            bottom: 6,
                            left: 6,
                            width: 30,
                            height: 30,
                            borderRadius: 6,
                            background: 'rgba(0,0,0,0.6)',
                            color: isFav ? '#f87171' : 'white',
                            fontSize: 16,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            border: 'none',
                            cursor: 'pointer',
                            transition: 'transform 0.15s',
                            zIndex: 2,
                        }}
                        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.15)'}
                        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                    >
                        {isFav ? '❤️' : '♡'}
                    </button>
                )}

                {/* 悬停时的删除按钮（右上角） */}
                {hover && onDelete && (
                    <button
                        onClick={handleDelete}
                        title="删除这本漫画（不会删除本地文件）"
                        style={{
                            position: 'absolute',
                            top: 6,
                            right: 6,
                            width: 28,
                            height: 28,
                            borderRadius: 6,
                            background: 'rgba(0,0,0,0.65)',
                            color: 'white',
                            fontSize: 14,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            border: 'none',
                            cursor: 'pointer',
                            zIndex: 2,
                        }}
                    >
                        🗑️
                    </button>
                )}

                {/* ⭐ 悬停时的详情按钮（左上角）：章节 + 标签都在详情页里 */}
                {hover && onOpenDetail && (
                    <button
                        onClick={e => { e.stopPropagation(); onOpenDetail(series); }}
                        title="打开详情（章节 / 标签）"
                        style={{
                            position: 'absolute',
                            top: 6,
                            left: 6,
                            padding: '3px 9px',
                            borderRadius: 6,
                            background: 'rgba(0,0,0,0.65)',
                            color: 'white',
                            fontSize: 11,
                            border: 'none',
                            cursor: 'pointer',
                            zIndex: 2,
                        }}
                    >
                        详情
                    </button>
                )}
            </div>

            {/* 信息 */}
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div
                    style={{
                        fontSize: 13,
                        fontWeight: 600,
                        lineHeight: 1.35,
                        height: '2.7em',
                        overflow: 'hidden',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                    }}
                    title={series.title}
                >
                    {series.title}
                </div>

                <div
                    style={{
                        fontSize: 11,
                        color: 'var(--text-secondary)',
                        display: 'flex',
                        justifyContent: 'space-between',
                    }}
                >
                    <span>{series.chapter_count} 卷</span>
                    {isFav && <span style={{ color: '#f87171' }}>已收藏</span>}
                </div>

                <ProgressBar value={0} height={3} />
            </div>
        </div>
    );
}
