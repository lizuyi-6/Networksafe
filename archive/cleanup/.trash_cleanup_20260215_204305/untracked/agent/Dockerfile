FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

RUN npm prune --production

ENV NODE_ENV=production
ENV BACKEND_URL=http://backend:3005
ENV HEARTBEAT_INTERVAL=30000
ENV METRICS_INTERVAL=10000

CMD ["node", "dist/index.js"]
