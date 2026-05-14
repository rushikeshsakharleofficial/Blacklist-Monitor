/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'app': 'var(--bg-app)',
        'surface': 'var(--bg-surface)',
        'subtle': 'var(--bg-subtle)',
        'hover-bg': 'var(--bg-hover)',
        'border-base': 'var(--border)',
        'border-strong': 'var(--border-strong)',
        'text-base': 'var(--text-primary)',
        'text-sec': 'var(--text-secondary)',
        'text-muted': 'var(--text-muted)',
        'accent': 'var(--accent)',
        'accent-hover': 'var(--accent-hover)',
        'accent-subtle': 'var(--accent-subtle)',
        'success': 'var(--success)',
        'success-bg': 'var(--success-bg)',
        'danger': 'var(--danger)',
        'danger-bg': 'var(--danger-bg)',
        'warning': 'var(--warning)',
        'warning-bg': 'var(--warning-bg)',
        // Legacy aliases so existing code still compiles
        'background': 'var(--bg-app)',
        'foreground': 'var(--text-primary)',
        'nav-bg': 'var(--sidebar-bg)',
        'nav-text': 'var(--sidebar-text)',
        'nav-active': 'var(--sidebar-active-bg)',
        'panel-border': 'var(--border)',
        'panel-hdr': 'var(--bg-subtle)',
        'row-alt': 'var(--bg-subtle)',
        'muted': 'var(--text-muted)',
        'primary': 'var(--accent)',
        'primary-hover': 'var(--accent-hover)',
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Courier New"', 'monospace'],
      },
    },
  },
  plugins: [],
}
