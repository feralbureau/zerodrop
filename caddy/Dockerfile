FROM node:20-alpine AS build

WORKDIR /app

COPY dashboard/package*.json ./
RUN npm i

COPY dashboard ./
RUN npm run build

FROM caddy:2-alpine

COPY caddy/caddy.json /etc/caddy/caddy.json
COPY --from=build /app/dist /srv

CMD ["caddy", "run", "--config", "/etc/caddy/caddy.json"]
