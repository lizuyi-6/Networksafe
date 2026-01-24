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
                sans: ['Inter', 'sans-serif'],
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
            },
        },
    },
    plugins: [],
}
