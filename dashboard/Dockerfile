FROM node:20-alpine AS build

WORKDIR /app

COPY dashboard/package*.json ./
RUN npm ci

COPY dashboard ./
RUN npm run build

FROM nginx:alpine

COPY nginx/nginx.conf.template /etc/nginx/nginx.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
