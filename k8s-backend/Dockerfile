FROM node:20-alpine

WORKDIR /app

# Install deps first for better layer caching
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY server.js auth.js git-relay.js ./

# Run as non-root
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup
USER appuser

EXPOSE 3001

CMD ["node", "server.js"]
