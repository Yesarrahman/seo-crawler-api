# Use official Playwright image (has browsers + Xvfb for headful mode)
FROM mcr.microsoft.com/playwright:v1.45.0-jammy

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

# Start the server (npm start should be "node dist/server.js")
CMD ["npm", "start"]