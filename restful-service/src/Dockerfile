FROM node:22-alpine

WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force && chown -R node:node /app

COPY --chown=node:node app.js index.js ./

USER node
EXPOSE 8080

CMD ["node", "index.js"]
