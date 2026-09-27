import { useEffect, useRef, useState } from 'react';

type Props = {
    src: string | null;    // 如果是 null 或空字符串，不加载
    alt?: string;
    style?: React.CSSProperties;
    fallback?: React.ReactNode;   // 没图片时显示的占位
    onClick?: () => void;
    preload?: boolean;      // 是否立即加载（不懒加载）
};

export default function LazyImage({ src, alt, style, fallback, onClick, preload = false }: Props) {
    const ref = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(preload);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        if (preload || visible) return;
        const el = ref.current;
        if (!el) return;

        const observer = new IntersectionObserver(
            entries => {
                if (entries[0].isIntersecting) {
                    setVisible(true);
                    observer.disconnect();
                }
            },
            { rootMargin: '200px' }   // 提前 200px 就开始加载
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [preload, visible]);

    return (
        <div
            ref={ref}
            onClick={onClick}
            style={{
                ...style,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
            }}
        >
            {!visible ? (
                fallback || <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>·</span>
            ) : src ? (
                <>
                    {!loaded && (
                        <span style={{ color: 'var(--text-secondary)', fontSize: 12, position: 'absolute' }}>
              加载中
            </span>
                    )}
                    <img
                        src={src}
                        alt={alt || ''}
                        onLoad={() => setLoaded(true)}
                        style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            opacity: loaded ? 1 : 0,
                            transition: 'opacity 0.2s',
                        }}
                    />
                </>
            ) : (
                fallback || <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>无图</span>
            )}
        </div>
    );
}