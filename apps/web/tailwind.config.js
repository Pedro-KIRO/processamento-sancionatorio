/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#00447f', 'primary-container': '#005ca8', 'primary-fixed': '#d4e3ff', 'primary-fixed-dim': '#a5c8ff',
        'on-primary': '#ffffff', 'on-primary-container': '#bbd5ff', 'on-primary-fixed': '#001c3a', 'on-primary-fixed-variant': '#004785',
        secondary: '#006497', 'secondary-container': '#6abdfe', 'secondary-fixed': '#cce5ff', 'secondary-fixed-dim': '#92ccff',
        'on-secondary': '#ffffff', 'on-secondary-container': '#004b74', 'on-secondary-fixed': '#001e31', 'on-secondary-fixed-variant': '#004b73',
        tertiary: '#004f25', 'tertiary-container': '#006a34', 'tertiary-fixed': '#67fe9a', 'tertiary-fixed-dim': '#45e180',
        'on-tertiary': '#ffffff', 'on-tertiary-container': '#56ef8d', 'on-tertiary-fixed': '#00210c', 'on-tertiary-fixed-variant': '#005227',
        error: '#ba1a1a', 'error-container': '#ffdad6', 'on-error': '#ffffff', 'on-error-container': '#93000a',
        // Faixa amarela do semáforo de prazos e cautelares. Existe porque o
        // documento de negócio exige verde/amarelo/vermelho e a paleta não tinha
        // nenhum amarelo — o `secondary` daqui é azul (#006497), então o
        // "amarelo" saía azul na tela. Três tons porque um só não resolve:
        // `atencao` tem contraste para texto, `atencao-dim` é o sinal saturado
        // que de fato lê como amarelo em bolinha e borda, e `atencao-container`
        // é o fundo claro das etiquetas.
        atencao: '#8a5000', 'atencao-container': '#ffddb0', 'atencao-dim': '#e8a300',
        background: '#f7f9ff', 'on-background': '#121d27',
        surface: '#f7f9ff', 'surface-bright': '#f7f9ff', 'surface-dim': '#d0dbe9', 'surface-variant': '#d8e4f2',
        'surface-container-lowest': '#ffffff', 'surface-container-low': '#edf4ff', 'surface-container': '#e4effd',
        'surface-container-high': '#dee9f8', 'surface-container-highest': '#d8e4f2',
        'on-surface': '#121d27', 'on-surface-variant': '#414751',
        outline: '#727782', 'outline-variant': '#c1c6d3',
        'inverse-surface': '#27313c', 'inverse-on-surface': '#e7f2ff', 'inverse-primary': '#a5c8ff', 'surface-tint': '#0a5fab',
        accent: '#3490ce',
      },
      borderRadius: { DEFAULT: '0.25rem', lg: '12px', xl: '16px', '2xl': '20px', full: '9999px' },
      spacing: { 'stack-lg': '24px', 'stack-md': '16px', 'stack-sm': '8px', 'margin-page': '32px', gutter: '24px', 'topbar-height': '72px', 'sidebar-width': '260px' },
      fontFamily: { sans: ['Open Sans', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'] },
      fontSize: {
        'headline-lg': ['30px', { lineHeight: '40px', letterSpacing: '-0.5px', fontWeight: '700' }],
        'headline-md': ['24px', { lineHeight: '32px', fontWeight: '600' }],
        'headline-sm': ['20px', { lineHeight: '28px', fontWeight: '600' }],
        'body-lg': ['16px', { lineHeight: '24px' }],
        'body-md': ['14px', { lineHeight: '20px' }],
        'label-lg': ['14px', { lineHeight: '20px', fontWeight: '600' }],
        'label-sm': ['12px', { lineHeight: '16px', fontWeight: '600' }],
      },
      boxShadow: { card: '0px 4px 12px rgba(47,58,69,0.08)' },
    },
  },
  plugins: [],
}
