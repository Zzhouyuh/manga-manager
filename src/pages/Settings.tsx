import { themes } from '../themes';
import type { ThemeName } from '../types';

type Props = {
    theme: ThemeName;
    onThemeChange: (t: ThemeName) => void;
    coverMode: 'dynamic' | 'static';
    onCoverModeChange: (m: 'dynamic' | 'static') => void;
};

export default function Settings({ theme, onThemeChange, coverMode, onCoverModeChange }: Props) {
    return (
        <div style={{ maxWidth: 700 }}>
            {/* 主题 */}
            <section style={{ marginBottom: 40 }}>
                <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>🎨 主题</h2>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                    选择你喜欢的界面配色
                </p>

                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                        gap: 12,
                    }}
                >
                    {(Object.keys(themes) as ThemeName[]).map(key => {
                        const t = themes[key];
                        const active = theme === key;
                        return (
                            <div
                                key={key}
                                onClick={() => onThemeChange(key)}
                                style={{
                                    border: active ? `2px solid var(--primary)` : '2px solid var(--border)',
                                    borderRadius: 8,
                                    padding: 12,
                                    cursor: 'pointer',
                                    background: 'var(--card)',
                                    transition: 'border 0.15s',
                                }}
                            >
                                {/* 主题预览 */}
                                <div
                                    style={{
                                        background: t.bg,
                                        borderRadius: 4,
                                        padding: 10,
                                        marginBottom: 10,
                                        height: 60,
                                        display: 'flex',
                                        gap: 6,
                                    }}
                                >
                                    <div
                                        style={{
                                            width: 20,
                                            background: t.bgSecondary,
                                            borderRadius: 3,
                                        }}
                                    />
                                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                        <div style={{ height: 8, background: t.card, borderRadius: 3 }} />
                                        <div style={{ height: 8, background: t.primary, borderRadius: 3, width: '60%' }} />
                                    </div>
                                </div>

                                <div style={{ fontSize: 13, fontWeight: active ? 600 : 400, textAlign: 'center' }}>
                                    {t.name}
                                    {active && <span style={{ marginLeft: 4, color: 'var(--primary)' }}>✓</span>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>

            {/* 封面策略 */}
            <section>
                <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>🖼️ 封面显示方式</h2>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                    决定漫画卡片上的封面显示哪一张图
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <label
                        style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 12,
                            padding: 14,
                            background: coverMode === 'dynamic' ? 'var(--card)' : 'transparent',
                            border: `1px solid ${coverMode === 'dynamic' ? 'var(--primary)' : 'var(--border)'}`,
                            borderRadius: 8,
                            cursor: 'pointer',
                        }}
                    >
                        <input
                            type="radio"
                            checked={coverMode === 'dynamic'}
                            onChange={() => onCoverModeChange('dynamic')}
                            style={{ marginTop: 3 }}
                        />
                        <div>
                            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
                                跟随阅读进度（推荐）
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                封面自动显示你当前正在读的那一卷的第一张图
                            </div>
                        </div>
                    </label>

                    <label
                        style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 12,
                            padding: 14,
                            background: coverMode === 'static' ? 'var(--card)' : 'transparent',
                            border: `1px solid ${coverMode === 'static' ? 'var(--primary)' : 'var(--border)'}`,
                            borderRadius: 8,
                            cursor: 'pointer',
                        }}
                    >
                        <input
                            type="radio"
                            checked={coverMode === 'static'}
                            onChange={() => onCoverModeChange('static')}
                            style={{ marginTop: 3 }}
                        />
                        <div>
                            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
                                固定第一卷
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                封面永远显示第一卷的第一张图，不随阅读进度变化
                            </div>
                        </div>
                    </label>
                </div>
            </section>

            {/* 关于 */}
            <section style={{ marginTop: 40, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
                <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>ℹ️ 关于</h2>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                    <div>版本：v0.1.0</div>
                    <div>技术栈：Electron + React + TypeScript + SQLite</div>
                    <div>当前进度：阶段 3（阅读器 + 漫画库）完成</div>
                </div>
            </section>
        </div>
    );
}