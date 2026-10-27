# Panel bramki AI: Node 22, zero zależności npm.
FROM node:22.20.0-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY *.mjs index.html ./
USER node
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "/app/server.mjs"]
