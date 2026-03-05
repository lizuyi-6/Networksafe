/** @type {import('tailwindcss').Config} */
export default {
    darkMode: 'class',
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['"HarmonyOS Sans"', 'sans-serif'],
                mono: ['JetBrains Mono', 'monospace'],
            },
            fontSize: {
                xxs: '0.65rem',
            },
            colors: {
                background: "hsl(var(--background) / <alpha-value>)",
                surface: "hsl(var(--surface) / <alpha-value>)",
                border: "hsl(var(--border) / <alpha-value>)",
                foreground: "hsl(var(--foreground) / <alpha-value>)",

                primary: {
                    DEFAULT: "hsl(var(--primary) / <alpha-value>)",
                    foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
                },
                muted: {
                    DEFAULT: "hsl(var(--muted) / <alpha-value>)",
                    foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
                },
                card: {
                    DEFAULT: "hsl(var(--card) / <alpha-value>)",
                    foreground: "hsl(var(--card-foreground) / <alpha-value>)",
                },

                // Functional Colors
                danger: '#EF4444',
                success: '#10B981',
                warning: '#F59E0B',

                // New Landing Page Theme (Graphite Authority)
                "concrete-bg": "#E9ECEF",
                "surface-light": "#F8F9FA",
                "surface-mid": "#DEE2E6",
                "primary-new": "#4361EE", // Renamed to avoid conflict with existing primary, or override if intended. HTML uses 'text-primary' which maps to this.
                // existing primary is var(--primary) which is 3B82F6 (Blue 500). 
                // The new one is 4361EE (Indigo). I will add it as 'indigo-primary' or just override 'primary' for the landing page context if possible.
                // To be safe and support both, I will add these specific keys.
                "obsidian": "#000000",
                "obsidian-light": "#111827",
                "text-main": "#0f172a",
                "text-secondary": "#334155",
                "divider": "#CBD5E1",
            },
            boxShadow: {
                'soft': '0 10px 40px rgba(0, 0, 0, 0.06)',
                'deep': '0 30px 60px -10px rgba(0, 0, 0, 0.35), 0 10px 20px -5px rgba(0,0,0,0.2)',
                'glow': '0 0 25px rgba(67, 97, 238, 0.4)',
                'glass': '0 8px 32px 0 rgba(11, 12, 16, 0.1)',
                'sharp': '4px 4px 0px rgba(11, 12, 16, 0.1)',
            },
            backgroundImage: {
                'concrete-gradient': 'linear-gradient(135deg, #F8F9FA 0%, #E9ECEF 100%)',
                'obsidian-gradient': 'linear-gradient(135deg, #1A1D24 0%, #0B0C10 100%)',
            },
        },
    },
    plugins: [],
}
