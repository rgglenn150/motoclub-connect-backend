# --- 1. Define the Base Image (Missing in yours!) ---
FROM node:18-slim

# --- 2. Setup Work Directory ---
WORKDIR /app

# Fonts for SVG text rendered by sharp/librsvg (share cards, ID cards).
# node:18-slim ships none, so text would render blank. DejaVu covers ₱.
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-dejavu-core fontconfig-config \
  && rm -rf /var/lib/apt/lists/*

# --- 3. Install Dependencies ---
# We copy ONLY package.json first to cache the install step
COPY package*.json ./

# Install dependencies from scratch (Clean Install)
RUN npm install

# --- 4. Copy App Source ---
# This copies your code. 
# IMPORTANT: It will overwrite node_modules if .dockerignore is missing!
COPY . .

# --- 5. Expose Port ---
EXPOSE 4201

# --- 6. Start Command ---
CMD ["npm", "start"]
