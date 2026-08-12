# Dockerfile do frontend (React + Vite) — contexto de build é a RAIZ do monorepo.
#
# Build: docker build -f apps/web/Dockerfile -t detran-dti-processamento-front .
#
# Convenção da plataforma: o frontend serve na porta 3000.

# ---- Build ----
FROM node:20-alpine AS build
WORKDIR /app

# Copia manifests e instala dependências (cache eficiente).
COPY package*.json ./
COPY apps/web/package*.json ./apps/web/
RUN npm ci --workspace=apps/web

# Copia o código e compila (Vite gera assets estáticos em dist/).
COPY apps/web ./apps/web

# Variáveis VITE_ precisam estar disponíveis em build time.
ARG VITE_ENTRA_TENANT_ID
ARG VITE_ENTRA_CLIENT_ID
ARG VITE_REDIRECT_URI
ARG VITE_BASE_PATH
RUN npm run build:web

# ---- Produção (nginx serve os estáticos) ----
FROM nginx:alpine AS production

COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
