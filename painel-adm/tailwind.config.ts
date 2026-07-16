import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["General Sans", "Montserrat", "sans-serif"],
        body: ["DM Sans", "Archivo", "sans-serif"],
      },
      colors: {
        genesis: {
          primary: "#6366F1",
          "primary-hover": "#4F46E5",
          secondary: "#20970B",
          neutral: "#9C9C9C",
          bg: "#FAFAFA",
          surface: "#FFFFFF",
          text: "#0A0A0A",
          muted: "#6B6B6B",
          border: "#E8E8EC",
          success: "#10B981",
          warning: "#F59E0B",
          error: "#EF4444",
        },
        navy: {
          950: "#0A0A0A",
          900: "#171717",
          800: "#262626",
        },
        radio: {
          blue: "#1360E8",
          sky: "#4A8EF0",
          red: "#EF3828",
          yellow: "#FFBE0B",
        },
      },
      boxShadow: {
        panel: "0 18px 55px rgba(10, 10, 10, 0.08)",
        focus: "0 0 0 4px rgba(99, 102, 241, 0.14)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 420ms ease-out both",
      },
    },
  },
  plugins: [],
} satisfies Config;
