# --- Stage 1: Build ---
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including devDeps for build)
RUN npm ci

# Copy source files
COPY src/ ./src/

# Build the project
RUN npm run build

# --- Stage 2: Production ---
FROM node:20-alpine

WORKDIR /app

# Set environment
ENV NODE_ENV=production

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Create logs directory
RUN mkdir -p logs

# Expose port (if needed for health checks or metrics)
EXPOSE 3000

# Start the bot
CMD ["node", "dist/index.js"]
