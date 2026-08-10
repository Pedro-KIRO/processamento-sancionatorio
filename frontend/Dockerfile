# Dockerfile do frontend (React + Vite)
# Multi-stage: build gera os estáticos, nginx serve em produção.
#
# Build:   docker build -t processamento-web ./frontend
# Dev:     docker-compose up web (usa volume mount + vite dev server)

# --- Stage: build ---
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- Stage: production ---
FROM nginx:alpine AS production

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
