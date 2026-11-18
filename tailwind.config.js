/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        fg: 'rgb(var(--fg) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        faint: 'rgb(var(--faint) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        accentStrong: 'rgb(var(--accent-strong) / <alpha-value>)',
        accentSoft: 'rgb(var(--accent-soft) / <alpha-value>)',
        onAccent: 'rgb(var(--on-accent) / <alpha-value>)',
        deal: 'rgb(var(--deal) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        cream: 'rgb(var(--cream) / <alpha-value>)',
        navy: 'rgb(var(--navy) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter_400Regular'],
        medium: ['Inter_500Medium'],
        semibold: ['Inter_600SemiBold'],
        bold: ['Inter_700Bold'],
      },
      borderRadius: {
        // Shape lock: inputs 12, cards 16, hero/panels 24, actions pill.
        input: '12px',
        card: '16px',
        xl: '20px',
        panel: '24px',
        '2xl': '28px',
        pill: '9999px',
      },
      fontSize: {
        meta: ['12px', '16px'],
        body: ['14px', '20px'],
        title: ['16px', '22px'],
        price: ['15px', '20px'],
        h: ['20px', '26px'],
        display: ['26px', '32px'],
      },
    },
  },
  plugins: [],
};
