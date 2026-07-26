import React from 'react';
import logoImg from '../assets/logo.png';

export type PlanTier = 'starter' | 'professional' | 'enterprise' | null;

interface LogoProps {
    tier?: PlanTier;
    className?: string;
    showText?: boolean;
}

const getBadgeConfig = (tier: PlanTier) => {
    switch (tier) {
        case 'starter':
            return { text: 'STARTER', className: 'border-border bg-muted text-muted-foreground' };
        case 'professional':
            return { text: 'PRO', className: 'border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-400' };
        case 'enterprise':
            return { text: 'ULTRA', className: 'border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400' };
        default:
            return null;
    }
};

const Logo: React.FC<LogoProps> = ({ tier, className = '', showText = true }) => {
    const badge = getBadgeConfig(tier || null);

    return (
        <div className={`flex select-none items-center gap-2.5 ${className}`}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-white p-1 shadow-sm">
                <img src={logoImg} alt="" className="h-full w-full object-contain" />
            </div>

            {(showText || badge) && (
                <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                        {showText && (
                            <span className="truncate text-base font-semibold text-foreground">
                                AetherGuard
                            </span>
                        )}

                        {badge && (
                            <span className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold ${badge.className}`}>
                                {badge.text}
                            </span>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default Logo;
