FROM node:20-alpine as buildStage
WORKDIR /app
COPY src src/
COPY *.json .
RUN npm install
RUN npm run generate-contract-types && npm run build

FROM node:20-alpine
COPY --from=buildStage /app/dist ./dist
COPY --from=buildStage /app/node_modules ./node_modules
COPY package.json ./
EXPOSE 13000
CMD npm run migrations:execute:prod && node dist/main