import { ReactNode, useEffect, useRef, useState } from 'react';
import { ResponsiveContainer } from 'recharts';

export default function StableResponsiveChart({
    children,
    minHeight = 300,
    loadingText = 'Preparing chart surface...',
}: {
    children: ReactNode;
    minHeight?: number;
    loadingText?: string;
}) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const element = containerRef.current;
        if (!element) {
            return;
        }

        let frameId: number | null = null;
        const updateReadyState = () => {
            if (frameId !== null) {
                cancelAnimationFrame(frameId);
            }
            frameId = window.requestAnimationFrame(() => {
                const { width, height } = element.getBoundingClientRect();
                setReady(width > 16 && height > 16);
            });
        };

        updateReadyState();
        const observer = new ResizeObserver(updateReadyState);
        observer.observe(element);

        return () => {
            observer.disconnect();
            if (frameId !== null) {
                cancelAnimationFrame(frameId);
            }
        };
    }, []);

    return (
        <div
            ref={containerRef}
            className="w-full"
            style={{ minHeight }}
        >
            {ready ? (
                <ResponsiveContainer width="100%" height={minHeight}>
                    {children}
                </ResponsiveContainer>
            ) : (
                <div
                    className="flex items-center justify-center rounded-xl border border-dashed border-border bg-muted/10 text-xs text-muted-foreground"
                    style={{ minHeight }}
                >
                    {loadingText}
                </div>
            )}
        </div>
    );
}
