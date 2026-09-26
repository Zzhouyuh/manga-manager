import { useState } from 'react';
import type { Tag } from '../types';

export type PageKey = 'home' | 'library' | 'favorites' | 'settings';

type Props = {
    current: PageKey;
    onNavigate: (page: PageKey) => void;
    searchKeyword: string;
    onSearch: (kw: string) => void;
    // ⭐ 标签
    tags: Tag[];
    activeTagId: number | null;
    onSelectTag: (tag: Tag | null) => void;
    onDeleteTag: (tag: Tag) => void;
};

const NAV_ITEMS: { key: PageKey; label: string; icon: string }[] = [
    { key: 'home', label: '首页', icon: '🏠' },
    { key: 'library', label: '漫画库', icon: '📚' },
    { key: 'favorites', label: '收藏', icon: '⭐' },
    { key: 'settings', label: '设置', icon: '⚙️' },
];

export default function Sidebar({
                                    current, onNavigate, searchKeyword, onSearch,
                                    tags, activeTagId, onSelectTag, onDeleteTag,
                                }: Props) {
    const [local, setLocal] = useState(searchKeyword);

    const handleSearch = (val: string) => {
        setLocal(val);
        onSearch(val);
    };

    return (
        <aside
            style={{
                width: 220,
                height: '100%',
                background: 'var(--bg-secondary)',
                borderRight: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                flexShrink: 0,
            }}
        >
            {/* Logo */}
            <div
                style={{
                    padding: '20px 20px 16px',
                    fontSize: 18,
                    fontWeight: 700,
                    letterSpacing: 0.5,
                }}
            >
                📚 漫画管理器
            </div>

            {/* 搜索框 */}
            <div style={{ padding: '0 16px 16px' }}>
                <input
                    type="text"
                    placeholder="🔍 搜索漫画..."
                    value={local}
                    onChange={e => handleSearch(e.target.value)}
                    onFocus={() => onNavigate('library')}
                    style={{
                        width: '100%',
                        padding: '8px 12px',
                        background: 'var(--card)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        fontSize: 13,
                        color: 'var(--text)',
                    }}
                />
            </div>

            {/* 导航 */}
            <nav style={{ padding: '0 12px', flex: 1 }}>
                {NAV_ITEMS.map(item => {
                    const active = current === item.key;
                    return (
                        <button
                            key={item.key}
                            onClick={() => onNavigate(item.key)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 12,
                                width: '100%',
                                padding: '10px 12px',
                                marginBottom: 4,
                                borderRadius: 6,
                                fontSize: 14,
                                fontWeight: active ? 600 : 400,
                                background: active ? 'var(--card)' : 'transparent',
                                color: active ? 'var(--text)' : 'var(--text-secondary)',
                                textAlign: 'left',
                            }}
                            onMouseEnter={e => {
                                if (!active) e.currentTarget.style.background = 'var(--card)';
                            }}
                            onMouseLeave={e => {
                                if (!active) e.currentTarget.style.background = 'transparent';
                            }}
                        >
                            <span style={{ fontSize: 16 }}>{item.icon}</span>
                            <span>{item.label}</span>
                        </button>
                    );
                })}
            </nav>

            {/* ⭐ 标签列表（点击筛选，右侧 × 删除） */}
            <div
                style={{
                    borderTop: '1px solid var(--border)',
                    padding: '10px 12px 6px',
                    maxHeight: 240,
                    overflowY: 'auto',
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: 11,
                        color: 'var(--text-secondary)',
                        padding: '0 8px 8px',
                    }}
                >
                    <span>标签</span>
                    {activeTagId !== null && (
                        <button
                            onClick={() => onSelectTag(null)}
                            style={{ fontSize: 11, color: 'var(--primary)' }}
                        >
                            清除筛选
                        </button>
                    )}
                </div>

                {tags.length === 0 ? (
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', padding: '0 8px 6px', lineHeight: 1.7 }}>
                        还没有标签，<br />在漫画详情页里添加
                    </div>
                ) : (
                    tags.map(t => {
                        const active = t.id === activeTagId;
                        return (
                            <div
                                key={t.id}
                                onClick={() => onSelectTag(active ? null : t)}
                                title={`${t.name}（${t.series_count ?? 0} 本）`}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    padding: '6px 8px',
                                    marginBottom: 2,
                                    borderRadius: 6,
                                    fontSize: 13,
                                    cursor: 'pointer',
                                    background: active ? 'var(--card)' : 'transparent',
                                    color: active ? 'var(--text)' : 'var(--text-secondary)',
                                }}
                                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--card)'; }}
                                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                            >
                                <span
                                    style={{
                                        width: 8,
                                        height: 8,
                                        borderRadius: 4,
                                        background: t.color || 'var(--primary)',
                                        flexShrink: 0,
                                    }}
                                />
                                <span
                                    style={{
                                        flex: 1,
                                        minWidth: 0,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    {t.name}
                                </span>
                                <span style={{ fontSize: 11, opacity: 0.7 }}>{t.series_count ?? 0}</span>
                                <button
                                    onClick={e => { e.stopPropagation(); onDeleteTag(t); }}
                                    title="删除这个标签"
                                    style={{
                                        fontSize: 12,
                                        lineHeight: 1,
                                        color: 'var(--text-secondary)',
                                        padding: '0 2px',
                                    }}
                                >
                                    ×
                                </button>
                            </div>
                        );
                    })
                )}
            </div>

            {/* 底部版本号 */}
            <div
                style={{
                    padding: 16,
                    fontSize: 11,
                    color: 'var(--text-secondary)',
                    textAlign: 'center',
                }}
            >
                v0.1.0 · 开发中
            </div>
        </aside>
    );
}
