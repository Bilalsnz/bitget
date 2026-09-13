import type { Config } from 'tailwindcss';

/**
 * AfterHours AI design tokens.
 *
 * The palette is intentionally vivid but the *semantics* are fixed:
 * every verdict and risk level has exactly one hue family, and that hue is
 * never the only signal — the UI always renders the word next to the colour.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      /**
       * The default opacity scale is coarse (0,5,10,20,25,30,40,…). Glass
       * panels need in-between values — `border-white/12` reads far better at
       * this contrast than either /10 or /20 — and the colour opacity modifier
       * resolves against this scale, so adding them here is what makes
       * `border-white/12` and friends valid class names.
       */
      opacity: {
        12: '0.12',
        15: '0.15',
        35: '0.35',
        45: '0.45',
        55: '0.55',
        65: '0.65',
        85: '0.85',
      },
      colors: {
        // Base surfaces — a deep, slightly blue-black rather than pure grey.
        ink: {
          950: '#04050C',
          900: '#070917',
          850: '#0B0E20',
          800: '#11152C',
          700: '#1A1F3D',
          600: '#262C52',
        },
        // Verdict hues. Each pair is (vivid, deep) for gradient work.
        verdict: {
          buy: '#14F195',
          buyDeep: '#00B37E',
          hold: '#7C8CFF',
          holdDeep: '#4C5BD4',
          reduce: '#FFB020',
          reduceDeep: '#E07B00',
          avoid: '#FF4D6D',
          avoidDeep: '#C81E4A',
        },
        accent: {
          cyan: '#38E8FF',
          violet: '#A855F7',
          pink: '#FF5FA2',
        },
        pos: '#14F195',
        neg: '#FF4D6D',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        xl2: '1.25rem',
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(255,255,255,0.06), 0 18px 50px -20px rgba(0,0,0,0.9)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'sheen': {
          '0%': { backgroundPosition: '0% 50%' },
          '100%': { backgroundPosition: '200% 50%' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '0.35' },
          '50%': { opacity: '0.9' },
        },
        'sweep': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 320ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'sheen': 'sheen 6s linear infinite',
        'pulse-soft': 'pulse-soft 2.4s ease-in-out infinite',
        'sweep': 'sweep 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
