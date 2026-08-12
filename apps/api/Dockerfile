# syntax=docker/dockerfile:1
# ---- Build ----
FROM node:20-alpine AS build
WORKDIR /app

# Copia manifests e instala dependências (cache eficiente: só reinstala se mudar o lock).
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/

# Usa BuildKit secret para autenticar no GitHub Packages durante npm ci.
# O .npmrc é criado temporariamente e removido após a instalação.
RUN --mount=type=secret,id=github_token \
    GITHUB_TOKEN=$(cat /run/secrets/github_token) && \
    echo "//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}" > .npmrc && \
    echo "@detran:registry=https://npm.pkg.github.com" >> .npmrc && \
    npm ci --workspace=apps/api && \
    rm -f .npmrc

# Copia o código e compila TypeScript.
COPY apps/api ./apps/api
COPY prisma ./prisma

# O Prisma Client precisa existir antes do tsc, senão os tipos de @prisma/client
# não resolvem e o build falha.
RUN npx prisma generate --schema=prisma/schema.prisma
RUN npm run build:api

# ---- Produção ----
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

# OpenSSL necessário para o Prisma engine.
RUN apk add --no-cache openssl

# wget é usado pelo healthcheck do docker-compose de homologação.
RUN apk add --no-cache wget

# Copia apenas o necessário para rodar (sem devDependencies).
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY prisma ./prisma

# Gera o Prisma Client e ajusta permissões para o usuário app.
RUN npx prisma generate --schema=prisma/schema.prisma

# Usuário sem privilégios (boas práticas de segurança em contêiner).
RUN addgroup -S app && adduser -S app -G app
RUN chown -R app:app /app

USER app

ENV PORT=3001
EXPOSE 3001
CMD ["node", "dist/main"]
