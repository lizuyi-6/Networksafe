import React from 'react';
import { motion } from 'framer-motion';
import logoImg from '../assets/brand/aetherguard-logo.svg';
import { useTheme } from '../context/ThemeContext';

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
    const { resolvedTheme } = useTheme();
    const badge = getBadgeConfig(tier || null);
    const textColor = resolvedTheme === 'dark' ? 'text-white' : 'text-gray-900';
    const hoverColor = resolvedTheme === 'dark' ? 'group-hover:text-slate-200' : 'group-hover:text-slate-700';

    return (
        <div className={`flex select-none items-center gap-3 ${className}`}>
            <div className="group flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card transition-transform duration-200 hover:scale-[1.03]">
                <img src={logoImg} alt="AetherGuard Logo" className="h-8 w-8 object-contain" />
            </div>

            {(showText || badge) && (
                <div className="flex flex-col justify-center">
                    <div className="flex items-center gap-2">
                        {showText && (
                            <span className={`text-xl font-bold tracking-tight transition-colors ${textColor} ${hoverColor}`}>
                                AetherGuard
                            </span>
                        )}

                        {badge && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.92, y: 2 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                key={tier}
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide ${badge.className}`}
                            >
                                {badge.text}
                            </motion.div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default Logo;
