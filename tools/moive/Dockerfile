FROM node:22-alpine AS deps

WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-alpine AS build

WORKDIR /app
ARG VITE_BASE_PATH=/tools/movie/
ARG VITE_CMS_API_BASE=/tools/movie/cms-api/api.php/provide/vod/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}
ENV VITE_CMS_API_BASE=${VITE_CMS_API_BASE}

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
