type Props = {
    value: number;     // 0~1
    height?: number;
    showText?: boolean;
};

export default function ProgressBar({ value, height = 4, showText = false }: Props) {
    const pct = Math.max(0, Math.min(1, value)) * 100;
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
                style={{
                    flex: 1,
                    height,
                    background: 'var(--progress-bg)',
                    borderRadius: height / 2,
                    overflow: 'hidden',
                }}
            >
                <div
                    style={{
                        width: `${pct}%`,
                        height: '100%',
                        background: 'var(--progress-fill)',
                        borderRadius: height / 2,
                        transition: 'width 0.3s',
                    }}
                />
            </div>
            {showText && (
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 36 }}>
          {Math.round(pct)}%
        </span>
            )}
        </div>
    );
}