/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#F8F9FF",
        foreground: "#1E293B",
        card: "#FFFFFF",
        "card-foreground": "#1E293B",
        primary: "#FF4F00",
        "primary-foreground": "#FFFFFF",
        secondary: "#F1F5F9",
        "secondary-foreground": "#1E293B",
        muted: "#F8FAFC",
        "muted-foreground": "#64748B",
        accent: "#FFF7ED",
        "accent-foreground": "#FF4F00",
        destructive: "#EF4444",
        "destructive-foreground": "#FFFFFF",
        border: "#E2E8F0",
        input: "#F1F5F9",
        ring: "#FF4F00",
      },
      borderRadius: {
        'xl': '1rem',
        '2xl': '1.5rem',
      },
      boxShadow: {
        'soft': '0 2px 15px -3px rgba(0, 0, 0, 0.07), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
      }
    },
  },
  plugins: [],
}
