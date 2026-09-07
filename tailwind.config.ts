import type { Config } from 'tailwindcss';

/**
 * 視覺方向：「一座夜裡的宮廟，只有香爐和燭火發光，其他都在暗處。」
 *
 * 調色盤刻意極小，只有四個角色：
 *   void  — 夜。頁面的地，近黑但帶木頭/香灰的暖度，不是純黑也不是藍黑。
 *   ash   — 被微光照到的字。永遠不是純白，因為夜裡沒有純白。
 *   ember — 香爐的火光（暖橘紅）。只用在「真的是光」的地方。
 *   flame — 燭火／燈火（暖金）。同樣只用在光源本身。
 *   paper — 紙。只准出現在真的是紙的東西上：籤紙、祈願卡。
 *
 * 沒有第五種顏色。沒有裝飾色、沒有品牌色、沒有狀態色階——
 * 質感來自字體、留白、光影，不是來自更多顏色。
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        void: {
          DEFAULT: '#0c0a09',
          deep: '#050404',
          raised: '#141110',
          line: '#211c19',
        },
        ash: {
          100: '#e6e0d6',
          300: '#b0a89b',
          500: '#7d766c',
          700: '#4e4842',
          900: '#2a2624',
        },
        ember: {
          core: '#ff9152',
          DEFAULT: '#d9622c',
          deep: '#8a3a17',
        },
        flame: {
          core: '#ffd9a0',
          DEFAULT: '#e3b26b',
          deep: '#8c6a38',
        },
        paper: {
          DEFAULT: '#f2e9d8',
          shade: '#e0d4bd',
          ink: '#2b2419',
        },
      },
      fontFamily: {
        display: ['"Noto Serif TC"', 'serif'],
        body: ['"Noto Sans TC"', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        sm: '2px',
        md: '3px',
        lg: '4px',
        xl: '6px',
      },
      letterSpacing: {
        ritual: '0.28em',
        wide: '0.08em',
      },
      transitionTimingFunction: {
        ceremony: 'cubic-bezier(0.22, 1, 0.36, 1)',
        settle: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
} satisfies Config;
