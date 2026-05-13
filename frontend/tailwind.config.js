/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#f0f2f5',
        foreground: '#2c3e50',
        'nav-bg': '#1e2d3d',
        'nav-text': '#c8d6e5',
        'nav-active': '#1a3a5c',
        'panel-hdr': '#2c3e50',
        'panel-border': '#ccd4dc',
        'row-alt': '#f7f9fc',
        'muted': '#6c7a89',
        primary: '#336699',
        'primary-hover': '#2a5580',
        success: '#27ae60',
        'success-bg': '#e8f8ee',
        danger: '#e74c3c',
        'danger-bg': '#fce8e6',
        warning: '#f39c12',
        'warning-bg': '#fef9e7',
        border: '#ccd4dc',
        muted: '#7f8c8d',
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', '"Courier New"', 'monospace'],
      },
    },
  },
  plugins: [],
}
