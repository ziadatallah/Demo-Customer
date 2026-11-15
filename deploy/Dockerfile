FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip postgresql-client awscli ca-certificates curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN npm ci --omit=dev --prefix 03_Build_Engine && npm ci --omit=dev --prefix 07_Web_Service && pip3 install --break-system-packages --no-cache-dir openpyxl==3.1.5
RUN mkdir -p /app/runtime/repository /app/runtime/backups && chown -R node:node /app/runtime
USER node
ENV NODE_ENV=production PORT=3000 ISAF_REPOSITORY_DIR=/app/runtime/repository
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
WORKDIR /app/07_Web_Service
CMD ["node","server.js"]
