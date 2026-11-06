FROM node:20-slim

# JANGAN install chromium via apt — biarkan Puppeteer unduh sendiri
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
# HAPUS PUPPETEER_SKIP_CHROMIUM_DOWNLOAD agar Puppeteer unduh Chromium-nya
RUN npm ci --omit=dev
COPY . .

# JANGAN set PUPPETEER_EXECUTABLE_PATH
CMD ["node", "index.js"]
