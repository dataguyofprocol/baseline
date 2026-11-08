# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.node.json ./
COPY bin bin
COPY src src
COPY web web
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:22-alpine
# PID 1 must forward SIGTERM, or `docker stop` waits out its timeout and kills the server
RUN apk add --no-cache tini github-cli && mkdir /data && chown node:node /data
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/bin bin
COPY --from=build /app/dist dist
COPY --from=build /app/web/dist web/dist
RUN chmod +x bin/baseline.js && ln -s /app/bin/baseline.js /usr/local/bin/baseline
ENV NODE_ENV=production \
    BASELINE_DB=/data/baseline.db \
    BASELINE_HOST=0.0.0.0 \
    BASELINE_PORT=7770 \
    BASELINE_REQUIRE_SIGN_IN=1
USER node
VOLUME /data
EXPOSE 7770
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.BASELINE_PORT||7770)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server/index.js"]
