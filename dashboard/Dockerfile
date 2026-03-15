FROM node:20-alpine AS build

WORKDIR /app

COPY dashboard/package*.json ./
RUN npm i

COPY dashboard ./
RUN npm run build

FROM nginx:alpine

COPY nginx/nginx.base.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
