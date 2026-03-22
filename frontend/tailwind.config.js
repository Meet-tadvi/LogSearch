/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg:      '#0e1117',
        surface: '#161b22',
        border:  '#30363d',
        text:    '#e6edf3',
        muted:   '#8b949e',
        accent:  '#f0a500',
        err:     '#f85149',
        warn:    '#d29922',
        info:    '#58a6ff',
        ok:      '#3fb950',
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
