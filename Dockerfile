FROM node:20-alpine as buildStage
WORKDIR /app
COPY src src/
COPY *.json .
RUN npm install
RUN npm run migrations:execute
RUN npm run build

FROM node:20-alpine
COPY --from=buildStage dist dist/
EXPOSE 13000
ENTRYPOINT ["node", "dist/main"]