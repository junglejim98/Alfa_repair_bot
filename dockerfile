FROM node:20.14.0-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++ postgresql-dev

COPY package*.json ./
RUN npm install --production

COPY . .

CMD ["sh", "-c", "node server.js & node bot.js"]