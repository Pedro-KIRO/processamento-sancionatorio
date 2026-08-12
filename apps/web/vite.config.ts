/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Em homologação/produção o frontend é servido sob /<sistema>/.
  // VITE_BASE_PATH configura o prefixo; em dev fica na raiz.
  base:
    process.env.NODE_ENV === 'production'
      ? (process.env.VITE_BASE_PATH ?? '/')
      : '/',
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

      O destino é a API NestJS (3001), conforme o padrão da plataforma. Enquanto
      a migração do backend Python não termina, a própria API NestJS repassa os
      caminhos ainda não portados para o FastAPI — ver
      `apps/api/src/app/legacy/legacy-proxy.middleware.ts`. Por isso aqui existe
      um destino só, e ele não muda mais.

      Só vale para `npm run dev`. Em produção o nginx faz o roteamento.
    */
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
})
