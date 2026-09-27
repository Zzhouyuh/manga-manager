import { useEffect, useState } from 'react';
import type { RecentItem } from '../types';
import ProgressBar from '../components/ProgressBar';

type Props = {
    onOpenSeries: (seriesId: number, seriesTitle: string) => void;
    onOpenReader: (chapterId: number, chapterTitle: string, seriesId: number, seriesTitle: string, startPage: number) => void;
};

export default function Home({ onOpenSeries, onOpenReader }: Props) {
    const [recent, setRecent] = useState<RecentItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            setLoading(true);
            const api = (window as any).api;
            const list = await api.recentReading();
            setRecent(list);
            setLoading(false);
        })();
    }, []);

    if (loading) {
        return <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-secondary)' }}>加载中...</div>;
    }

    if (recent.length === 0) {
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
                <div style={{ fontSize: 48, marginBottom: 16 }}>📖</div>
                <div style={{ fontSize: 16, marginBottom: 8 }}>还没有阅读记录</div>
                <div style={{ fontSize: 13 }}>去漫画库挑一本开始阅读吧</div>
            </div>
        );
    }

    return (
        <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: 'var(--text-secondary)' }}>
                继续阅读
            </h2>
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: 16,
                }}
            >
                {recent.map((item, i) => {
                    const total = item.page_count || 1;
                    const progress = item.last_read_page / total;
                    return (
                        <div
                            key={i}
                            onClick={() => onOpenReader(item.chapter_id, item.chapter_title, item.series_id, item.series_title, item.last_read_page)}
                            style={{
                                background: 'var(--card)',
                                border: '1px solid var(--border)',
                                borderRadius: 8,
                                padding: 16,
                                cursor: 'pointer',
                                transition: 'background 0.15s',
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--card-hover)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'var(--card)'}
                        >
                            <div
                                style={{
                                    fontSize: 14,
                                    fontWeight: 600,
                                    marginBottom: 6,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}
                                title={item.series_title}
                            >
                                {item.series_title}
                            </div>
                            <div
                                style={{
                                    fontSize: 12,
                                    color: 'var(--text-secondary)',
                                    marginBottom: 12,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                {item.chapter_title}
                            </div>
                            <ProgressBar value={progress} height={4} />
                            <div
                                style={{
                                    fontSize: 11,
                                    color: 'var(--text-secondary)',
                                    marginTop: 6,
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                }}
                            >
                                <span>第 {item.last_read_page} / {total} 页</span>
                                <span>点击继续 →</span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}