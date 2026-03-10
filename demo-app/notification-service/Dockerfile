FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY ../shared ../shared
COPY . .

EXPOSE 3004

CMD ["npx", "tsx", "src/index.ts"]
