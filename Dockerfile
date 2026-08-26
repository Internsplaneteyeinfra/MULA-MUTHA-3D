# --- build (Vite static assets) ---
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Root path on Railway custom domains / *.up.railway.app
ARG VITE_BASE=/
ENV VITE_BASE=$VITE_BASE

RUN npm run build && npm run smoke

# --- serve (Caddy on Railway $PORT) ---
FROM caddy:2-alpine
WORKDIR /app

COPY Caddyfile ./
RUN caddy fmt Caddyfile --overwrite

COPY --from=build /app/dist ./dist

EXPOSE 3000
CMD ["caddy", "run", "--config", "Caddyfile", "--adapter", "caddyfile"]
