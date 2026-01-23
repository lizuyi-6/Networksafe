FROM node:18-alpine

WORKDIR /app

# Copy root config
COPY package.json tsconfig.json ./

# Install root dependencies
RUN npm config set registry https://registry.npmmirror.com/
RUN npm install

# Copy source
COPY src ./src
COPY backend ./backend
COPY installer ./installer

# Expose port
EXPOSE 3005

# Run server
# Using tsx to run directly without separate build step for simplicity
CMD ["npx", "tsx", "backend/src/server.ts"]
