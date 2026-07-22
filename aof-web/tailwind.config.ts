import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
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
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
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
        sidebar: {
          DEFAULT: "hsl(var(--sidebar))",
          foreground: "hsl(var(--sidebar-foreground))",
          border: "hsl(var(--sidebar-border))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xl: "calc(var(--radius) + 4px)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glass: "0 1px 0 0 hsl(0 0% 100% / 0.04) inset, 0 8px 30px -12px hsl(0 0% 0% / 0.6)",
        // Neomorphism — dual-light, theme-aware via CSS vars (--neo-light / --neo-dark)
        neo: "-6px -6px 14px hsl(var(--neo-light)), 6px 6px 16px hsl(var(--neo-dark))",
        "neo-sm": "-3px -3px 7px hsl(var(--neo-light)), 3px 3px 8px hsl(var(--neo-dark))",
        "neo-inset":
          "inset -3px -3px 7px hsl(var(--neo-light)), inset 4px 4px 9px hsl(var(--neo-dark))",
        // Legacy accent-glow names repurposed to neutral neomorphic elevation so existing
        // `shadow-glow` / `shadow-glow-sm` usages upgrade without touching every component.
        glow: "-6px -6px 14px hsl(var(--neo-light)), 6px 6px 16px hsl(var(--neo-dark))",
        "glow-sm": "-3px -3px 7px hsl(var(--neo-light)), 3px 3px 8px hsl(var(--neo-dark))",
        // Neutral card shadows — soft in light, near-invisible in dark
        "card-soft": "0 1px 2px 0 hsl(0 0% 0% / 0.04), 0 8px 24px -14px hsl(0 0% 0% / 0.12)",
        "card-hover": "0 2px 6px 0 hsl(0 0% 0% / 0.06), 0 14px 34px -14px hsl(0 0% 0% / 0.16)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        "pulse-glow": {
          "0%, 100%": { opacity: "0.45" },
          "50%": { opacity: "1" },
        },
        "aurora-shift": {
          "0%, 100%": { transform: "translate3d(0,0,0) scale(1)" },
          "50%": { transform: "translate3d(2%, -2%, 0) scale(1.05)" },
        },
        // Gentle vertical drift for the logo + subtle ambient lift
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-5px)" },
        },
        // Slow, barely-there particle drift
        "drift-slow": {
          "0%, 100%": { transform: "translate3d(0, 0, 0)", opacity: "0.0" },
          "20%": { opacity: "0.35" },
          "50%": { transform: "translate3d(8px, -16px, 0)", opacity: "0.5" },
          "80%": { opacity: "0.3" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.4s ease-out both",
        shimmer: "shimmer 1.8s infinite",
        "pulse-glow": "pulse-glow 2.4s ease-in-out infinite",
        "aurora-shift": "aurora-shift 18s ease-in-out infinite",
        float: "float 6s ease-in-out infinite",
        "drift-slow": "drift-slow 14s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
