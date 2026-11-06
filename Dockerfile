FROM node:22-bookworm

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# DB persistée via le volume monté sur /data (DB_PATH=/data/tournoi.db dans fly.toml)
ENV DB_PATH=/data/tournoi.db
EXPOSE 3000

CMD ["node", "src/server.js"]
