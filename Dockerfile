FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY server.js ./
COPY public/ ./public/

# Default file root - can be overridden with -v mounts
RUN mkdir -p /data

ENV PORT=3000
ENV FILE_ROOT=/data
ENV SERVER_NAME="MT File Manager"

EXPOSE 3000

CMD ["node", "server.js"]
