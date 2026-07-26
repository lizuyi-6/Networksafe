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
                sans: ['"HarmonyOS Sans"', '"Segoe UI"', 'Arial', 'sans-serif'],
                mono: ['Consolas', '"Liberation Mono"', 'monospace'],
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

                danger: "hsl(var(--danger) / <alpha-value>)",
                success: "hsl(var(--success) / <alpha-value>)",
                warning: "hsl(var(--warning) / <alpha-value>)",
                accent: {
                    DEFAULT: "hsl(var(--accent) / <alpha-value>)",
                    foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
                },
            },
            boxShadow: {
                'soft': '0 10px 30px rgb(15 23 42 / 0.07)',
                'panel': '0 1px 2px rgb(15 23 42 / 0.06), 0 8px 24px rgb(15 23 42 / 0.04)',
            },
        },
    },
    plugins: [],
}
