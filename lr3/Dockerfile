# Образ API ЛР3 на базі node:24.21.0-slim; секрети не в образі, а в змінних середовища.
FROM node:24.21.0-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# лише пакети з dependencies, без wrangler і без необов’язкових пакетів firebase-admin
RUN npm ci --omit=dev --omit=optional
COPY . .
# процес працює від користувача node, не від root
USER node
# значення картки — з config.env; змінна середовища (PORT від Render) важливіша за файл
CMD ["node", "--env-file=config.env", "server.mjs"]
