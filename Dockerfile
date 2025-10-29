FROM node:18-slim

# Install system dependencies and fonts
RUN apt-get update && apt-get install -y \
    fonts-liberation \
    fonts-dejavu-core \
    fontconfig \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy app files
COPY . .

# Create temp directory
RUN mkdir -p temp

# Expose port (if needed)
# EXPOSE 3000

# Start the application
CMD ["node", "index.js"]

