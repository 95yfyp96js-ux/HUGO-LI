import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#f7f6f3',
          100: '#eeece5',
          200: '#dcd8ca',
          300: '#c2bba4',
          400: '#a3987a',
          500: '#8a7c5c',
          600: '#6f6249',
          700: '#584d3a',
          800: '#3d3527',
          900: '#221d16',
          950: '#141210',
        },
        ember: {
          50: '#fdf3ee',
          100: '#fbe3d6',
          200: '#f5c3a8',
          300: '#eb9c74',
          400: '#df7644',
          500: '#c85a2c',
          600: '#a34423',
          700: '#7f3520',
          800: '#5f291c',
          900: '#3f1c14',
        },
        jade: {
          50: '#eef4f1',
          100: '#d6e6dd',
          200: '#adccbc',
          300: '#82ae99',
          400: '#5c9077',
          500: '#417a5f',
          600: '#3a6650',
          700: '#2c4f3d',
          800: '#1f382b',
          900: '#13221a',
        },
        gold: {
          400: '#d8b26a',
          500: '#bd934a',
          600: '#977338',
        },
        surface: {
          DEFAULT: '#faf8f4',
          raised: '#ffffff',
          sunken: '#f1ede4',
          dark: '#171310',
          'dark-raised': '#1f1a15',
        },
      },
      fontFamily: {
        display: ['"Noto Serif TC"', 'serif'],
        body: ['"Noto Sans TC"', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        sm: '6px',
        md: '10px',
        lg: '16px',
        xl: '24px',
      },
      boxShadow: {
        soft: '0 1px 2px rgba(20,18,16,0.04), 0 4px 16px rgba(20,18,16,0.06)',
        raised: '0 2px 4px rgba(20,18,16,0.06), 0 8px 24px rgba(20,18,16,0.10)',
      },
      transitionTimingFunction: {
        ceremony: 'cubic-bezier(0.22, 1, 0.36, 1)',
        settle: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  darkMode: 'class',
  plugins: [],
} satisfies Config;
