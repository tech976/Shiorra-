import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        studio: { 50: '#FFFFFF', 100: '#FAFAFA', 200: '#F4F4F4', 300: '#E5E5E5' },
        ink:    { 900: '#0A0A0A', 700: '#3A3A3A', 500: '#6B6B6B', 400: '#8A8A8A', 300: '#C7C7C7' },
        ginger: { DEFAULT: '#2E8B57', soft: '#E0F0E5', deep: '#144B30' },
        iron:   { DEFAULT: '#FF3D8E', soft: '#FFE4F0', deep: '#C21B62' },
        energy: { DEFAULT: '#EA580C', soft: '#FFEDD5', deep: '#7C2D12' },
      },
      fontFamily: {
        display: ['"Helvetica Neue"', 'Helvetica', 'Arial', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'studio-light': 'radial-gradient(ellipse at 50% 30%, #FFFFFF 0%, #FAFAFA 60%, #F4F4F4 100%)',
      },
      dropShadow: {
        contact: '0 24px 40px rgba(40, 40, 40, 0.08)',
      },
      transitionTimingFunction: {
        'pharma-out': 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};

export default config;
