import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    '../packages/ui/src/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        sage: {
          50: '#f4f8f5',
          100: '#e8f1eb',
          200: '#d1e3d7',
          300: '#a9cab5',
          400: '#7fad90',
          500: '#5d9372',
          600: '#467658',
          700: '#395f48',
          800: '#304d3c',
          900: '#283f32'
        }
      },
      boxShadow: {
        soft: '0 2px 8px rgba(15, 23, 42, 0.06), 0 12px 32px rgba(15, 23, 42, 0.04)'
      }
    }
  },
  plugins: []
}

export default config
