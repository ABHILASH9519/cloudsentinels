FROM node:22-alpine AS build
WORKDIR /src
RUN npm install -g pnpm@9.15.9
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY src/frontend/package.json src/frontend/package.json
RUN pnpm install --frozen-lockfile
COPY src/frontend src/frontend
ENV VITE_LOCAL_OPERATOR=true VITE_CLOUDSENTINELS_API_URL=http://127.0.0.1:8082
RUN pnpm --filter @cloudsentinels/frontend build

FROM nginx:stable-alpine
COPY --from=build /src/src/frontend/dist /usr/share/nginx/html
