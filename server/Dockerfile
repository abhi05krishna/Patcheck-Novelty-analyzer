FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-dev \
    build-essential \
    pkg-config \
    git \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
ENV PYTHON=/usr/bin/python3

RUN npm ci --only=production

COPY . .
# The API runs as the unprivileged `node` user. Multer must be able to create
# and remove its short-lived files in this directory (including when Docker
# initializes the named uploads volume from this image).
RUN mkdir -p uploads && chown node:node uploads
ENV NODE_ENV=production
EXPOSE 5000

USER node

CMD ["node", "server.js"]
