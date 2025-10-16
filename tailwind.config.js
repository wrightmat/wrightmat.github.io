/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './sheets/**/*.html',
    './sheets/js/**/*.js'
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: '#0f1115',
        panel: '#171a21',
        muted: '#9aa4af',
        accent: '#6aa1ff',
        success: '#3bd671',
        warning: '#f4c152',
        danger: '#ff6a6a'
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'sans-serif']
      },
      boxShadow: {
        panel: '0 8px 20px rgba(12, 15, 20, 0.35)'
      },
      spacing: {
        18: '4.5rem',
        22: '5.5rem'
      }
    }
  },
  safelist: [
    { pattern: /grid-cols-(1|2|3|4|5|6)/ },
    { pattern: /(col|row)-span-(1|2|3|4|5|6)/ },
    'flex-1',
    'shrink-0'
  ],
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography')
  ]
};
