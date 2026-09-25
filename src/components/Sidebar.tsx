import { useState } from 'react';

export type PageKey = 'home' | 'library' | 'favorites' | 'settings';

type Props = {
    current: PageKey;
    onNavigate: (page: PageKey) => void;
    searchKeyword: string;
    onSearch: (kw: string) => void;
};

const NAV_ITEMS: { key: PageKey; label: string; icon: string }[] = [
    { key: 'home', label: '首页', icon: '🏠' },
    { key: 'library', label: '漫画库', icon: '📚' },
    { key: 'favorites', label: '收藏', icon: '⭐' },
    { key: 'settings', label: '设置', icon: '⚙️' },
];

export default function Sidebar({ current, onNavigate, searchKeyword, onSearch }: Props) {
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