# syntax=docker/dockerfile:1
FROM node:22-alpine

WORKDIR /app

# Install production deps first so this layer caches between deploys
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy the rest of the app
COPY . .

ENV NODE_ENV=production

CMD ["node", "server/server.js"]
