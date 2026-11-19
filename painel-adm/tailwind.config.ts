import type { Config } from "tailwindcss";

const semanticColor = (token: string) => `hsl(var(--${token}) / <alpha-value>)`;
const genesisColor = (token: string) => `rgb(var(--genesis-${token}) / <alpha-value>)`;

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["General Sans", "Montserrat", "sans-serif"],
        body: ["DM Sans", "Archivo", "sans-serif"],
      },
      colors: {
        background: semanticColor("background"),
        foreground: semanticColor("foreground"),
        card: { DEFAULT: semanticColor("card"), foreground: semanticColor("card-foreground") },
        popover: { DEFAULT: semanticColor("popover"), foreground: semanticColor("popover-foreground") },
        primary: { DEFAULT: semanticColor("primary"), foreground: semanticColor("primary-foreground") },
        secondary: { DEFAULT: semanticColor("secondary"), foreground: semanticColor("secondary-foreground") },
        muted: { DEFAULT: semanticColor("muted"), foreground: semanticColor("muted-foreground") },
        accent: { DEFAULT: semanticColor("accent"), foreground: semanticColor("accent-foreground") },
        destructive: { DEFAULT: semanticColor("destructive"), foreground: semanticColor("destructive-foreground") },
        border: semanticColor("border"),
        input: semanticColor("input"),
        ring: semanticColor("ring"),
        chart: {
          1: semanticColor("chart-1"),
          2: semanticColor("chart-2"),
          3: semanticColor("chart-3"),
          4: semanticColor("chart-4"),
          5: semanticColor("chart-5"),
        },
        genesis: {
          primary: genesisColor("primary"),
          "primary-hover": genesisColor("primary-hover"),
          secondary: genesisColor("secondary"),
          neutral: genesisColor("neutral"),
          bg: genesisColor("bg"),
          surface: genesisColor("surface"),
          text: genesisColor("text"),
          muted: genesisColor("muted"),
          border: genesisColor("border"),
          success: genesisColor("success"),
          warning: genesisColor("warning"),
          error: genesisColor("error"),
        },
        navy: { 950: "#0A0A0A", 900: "#171717", 800: "#262626" },
        radio: { blue: "#1360E8", sky: "#4A8EF0", red: "#EF3828", yellow: "#FFBE0B" },
        sidebar: {
          DEFAULT: semanticColor("sidebar-background"),
          foreground: semanticColor("sidebar-foreground"),
          primary: semanticColor("sidebar-primary"),
          "primary-foreground": semanticColor("sidebar-primary-foreground"),
          accent: semanticColor("sidebar-accent"),
          "accent-foreground": semanticColor("sidebar-accent-foreground"),
          border: semanticColor("sidebar-border"),
          ring: semanticColor("sidebar-ring"),
        },
      },
      backgroundColor: {
        // Legacy ink backgrounds belong to logos/buttons, not text surfaces.
        "genesis-text": genesisColor("ink"),
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        panel: "0 18px 55px rgb(var(--panel-shadow) / 0.08)",
        focus: "0 0 0 4px rgb(var(--genesis-primary) / 0.14)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: { "fade-up": "fade-up 420ms ease-out both" },
    },
  },
  plugins: [],
} satisfies Config;
