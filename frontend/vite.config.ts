/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    /*
      O que o Vite repassa ao backend em desenvolvimento.

      Era uma lista de vinte prefixos que precisava acompanhar à mão os routers
      de `backend/app/api/routes/*.py`, e prefixo esquecido não dava erro de
      conexão: o Vite respondia 404 à chamada da tela, e o sintoma chegava como
      "a tela não abre" — foi o que aconteceu quando a tela de Prazos entrou.

      Com a API inteira sob `/api`, virou uma entrada só e a lista deixou de
      existir. Endpoint novo passa a funcionar aqui sem ninguém mexer neste
      arquivo.

      Só vale para `npm run dev`. Em produção o backend serve o build e as
      chamadas são de mesma origem, sem proxy.
    */
    proxy: {
      '/api': 'http://localhost:8080',
      // Documentação do FastAPI, útil em desenvolvimento.
      '/docs': 'http://localhost:8080',
      '/openapi.json': 'http://localhost:8080',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
})
