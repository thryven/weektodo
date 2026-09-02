FROM node:22-alpine
WORKDIR /app
COPY package.json /app
COPY pnpm-lock.yaml /app
RUN corepack enable && pnpm install --frozen-lockfile
COPY . /app
CMD pnpm run dev --host 0.0.0.0
EXPOSE 5173
