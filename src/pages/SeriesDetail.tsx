import { useEffect, useState } from 'react';
import type { Chapter } from '../types';
import ProgressBar from '../components/ProgressBar';

type Props = {
    seriesId: number;
    seriesTitle: string;
    onOpenImageWall: (chapterId: number, chapterTitle: string) => void;
};

export default function SeriesDetail({ seriesId, seriesTitle, onOpenImageWall }: Props) {
    const [chapters, setChapters] = useState<Chapter[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            setLoading(true);
            const api = (window as any).api;
            const list = await api.listChapters(seriesId);
            setChapters(list);
            setLoading(false);
        })();
    }, [seriesId]);

    if (loading) {
        return <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-secondary)' }}>加载中...</div>;
    }

    if (chapters.length === 0) {
        return <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-secondary)' }}>这本漫画还没有章节</div>;
    }

    return (
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
            {chapters.map((ch, i) => {
                const total = ch.page_count || 1;
                const progress = ch.last_read_page / total;
                const status = ch.is_read ? '已读' : (ch.last_read_page > 0 ? '在读' : '未读');
                const statusColor = ch.is_read
                    ? 'var(--primary)'
                    : (ch.last_read_page > 0 ? '#eab308' : 'var(--text-secondary)');

                return (
                    <div
                        key={ch.id}
                        onClick={() => onOpenImageWall(ch.id, ch.title)}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 16,
                            padding: '14px 16px',
                            borderBottom: '1px solid var(--border)',
                            cursor: 'pointer',
                            transition: 'background 0.15s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--card)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                        {/* 序号 */}
                        <div
                            style={{
                                width: 40,
                                fontSize: 13,
                                color: 'var(--text-secondary)',
                                textAlign: 'center',
                            }}
                        >
                            {i + 1}
                        </div>

                        {/* 章节名 */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                                style={{
                                    fontSize: 14,
                                    fontWeight: 500,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}
                                title={ch.title}
                            >
                                {ch.title}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                                {ch.page_count} 页
                            </div>
                        </div>

                        {/* 进度条 */}
                        <div style={{ width: 120 }}>
                            <ProgressBar value={progress} height={3} />
                        </div>

                        {/* 状态 */}
                        <div style={{ width: 50, fontSize: 12, color: statusColor, textAlign: 'right' }}>
                            {status}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}