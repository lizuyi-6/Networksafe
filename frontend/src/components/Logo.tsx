import React from 'react';
import { motion } from 'framer-motion';
import logoImg from '../assets/logo_new.png';

// Types for the subscription tiers
export type PlanTier = 'starter' | 'professional' | 'enterprise' | null;

interface LogoProps {
    tier?: PlanTier;
    className?: string;
    showText?: boolean;
}

const Logo: React.FC<LogoProps> = ({ tier, className = "", showText = true }) => {
    // Badge Configuration
    const getBadgeConfig = (tier: PlanTier) => {
        switch (tier) {
            case 'starter':
                return { text: 'STARTER', color: 'bg-gray-700 text-gray-200 border-gray-500' };
            case 'professional':
                return { text: 'PRO', color: 'bg-gradient-to-r from-blue-600 to-blue-400 text-white border-blue-400' };
            case 'enterprise':
                return { text: 'ULTRA', color: 'bg-gradient-to-r from-purple-600 to-red-500 text-white border-purple-400' };
            default:
                return null;
        }
    };

    const badge = getBadgeConfig(tier || null);

    return (
        <div className={`flex items-center gap-3 select-none ${className}`}>
            {/* Logo Image - Refined: No box, just the shield */}
            <div className="relative group w-10 h-10 transition-transform group-hover:scale-110 duration-300">
                <img
                    src={logoImg}
                    alt="FluxGuard Logo"
                    className="w-full h-full object-contain filter drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]"
                />

                {/* Glow Effect based on tier */}
                {tier === 'professional' && <div className="absolute inset-0 bg-blue-500/40 blur-xl rounded-full -z-10 animate-pulse"></div>}
                {tier === 'enterprise' && <div className="absolute inset-0 bg-purple-500/40 blur-xl rounded-full -z-10 animate-pulse"></div>}
            </div>

            {/* Text & Badge */}
            {(showText || badge) && (
                <div className="flex flex-col justify-center">
                    <div className="flex items-center gap-2">
                        {showText && (
                            <span className="font-bold text-xl tracking-tight text-white group-hover:text-green-50 transition-colors">
                                FluxGuard
                            </span>
                        )}

                        {/* Dynamic Badge */}
                        {badge && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.8, x: -10 }}
                                animate={{ opacity: 1, scale: 1, x: 0 }}
                                key={tier} // Re-animate on toggle
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border shadow-lg ${badge.color} backdrop-blur-md`}
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
