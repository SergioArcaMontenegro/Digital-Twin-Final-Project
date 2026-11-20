# ── Etapa 1: compilar las tres webs (visor 3D, administración y app móvil) ───────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Regenera los modelos 3D de los robots a partir de shared/robotSpecs.js, compila y
# comprueba que la distribución por defecto es válida
RUN npm run models:robots && npm run build && node tests/layout-test.mjs > /dev/null

# ── Etapa 2: servidor de simulación (Node + WebSocket) ───────────────────────────────
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
# En ejecución solo hace falta «ws»: la simulación (shared/) no tiene dependencias
RUN echo '{"name":"gemelo-madera-servidor","private":true,"type":"module","dependencies":{"ws":"^8.23.0"}}' > package.json \
 && npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:8080/salud >/dev/null || exit 1
CMD ["node", "server/index.mjs"]
