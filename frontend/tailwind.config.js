/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg:       '#0d1117',
        surface:  '#161b22',
        surface2: '#1c2333',
        border:   '#30363d',
        border2:  '#21262d',
        text:     '#e6edf3',
        muted:    '#8b949e',
        muted2:   '#6e7681',
        accent:   '#f0a500',
        accent2:  '#3B82F6',
        err:      '#f85149',
        warn:     '#d29922',
        info:     '#58a6ff',
        ok:       '#3fb950',
        teal:     '#39d3bb',
      },
      fontFamily: {
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Consolas', 'monospace'],
      },
      boxShadow: {
        'glow-accent': '0 0 12px rgba(240,165,0,0.25)',
        'glow-err':    '0 0 12px rgba(248,81,73,0.20)',
        'card':        '0 1px 3px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3)',
      },
    },
  },
  plugins: [],
}
