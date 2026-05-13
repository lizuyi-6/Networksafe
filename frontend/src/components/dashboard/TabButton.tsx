import { ReactNode } from 'react';

interface TabButtonProps {
    active: boolean;
    onClick: () => void;
    children: ReactNode;
}

export const TabButton = ({ active, onClick, children }: TabButtonProps) => (
    <button
        onClick={onClick}
        className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
            active
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
        }`}
    >
        {children}
    </button>
);
