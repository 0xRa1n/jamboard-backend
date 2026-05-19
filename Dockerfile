FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# Install only production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --silent

# Copy backend files
COPY server.js ./
COPY database.js ./
COPY config ./config
COPY controllers ./controllers
COPY middleware ./middleware
COPY routes ./routes
COPY services ./services
COPY shared ./shared

# Ensure upload subdirectories exist (if needed for the backend)
RUN mkdir -p ./uploads/avatars ./uploads/board_images

EXPOSE 3000
CMD ["node", "server.js"]
