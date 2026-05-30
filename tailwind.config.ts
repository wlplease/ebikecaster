import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        nsh: {
          bg: "#0a0a0a",
          "bg-secondary": "#0d0d0d",
          card: "#111111",
          border: "#1a1a1a",
          emerald: "#00ff41",
          "emerald-dim": "#00cc33",
          "emerald-dark": "#003d10",
          error: "#ff6b6b",
          warn: "#f0a500",
          info: "#4ecdc4",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"SF Mono"', '"Fira Code"', '"Cascadia Code"', '"Consolas"', "monospace"],
        grotesk: ['"Inter"', '"SF Pro Display"', "system-ui", "sans-serif"],
      },
      keyframes: {
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
        "cursor-pulse": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
        "rune-flash": {
          "0%": { opacity: "1" },
          "100%": { opacity: "0" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(3px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in": {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(0)" },
        },
        "logo-pulse": {
          "0%, 100%": { textShadow: "0 0 8px rgba(0,255,65,0.3)" },
          "50%": { textShadow: "0 0 16px rgba(0,255,65,0.6), 0 0 32px rgba(0,255,65,0.15)" },
        },
      },
      animation: {
        blink: "blink 1s step-end infinite",
        "cursor-pulse": "cursor-pulse 1.2s ease-in-out infinite",
        "rune-flash": "rune-flash 0.6s ease-out forwards",
        "fade-in": "fade-in 0.2s ease-out",
        "slide-in": "slide-in 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
        "logo-pulse": "logo-pulse 3s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
