FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]
