FROM node:20-alpine AS builder
WORKDIR /app
ARG VITE_API_BASE_URL
ARG VITE_DEFAULT_BACKEND_PUBLIC_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_DEFAULT_BACKEND_PUBLIC_URL=${VITE_DEFAULT_BACKEND_PUBLIC_URL}
COPY package.json package-lock.json* ./
RUN npm ci --include=dev
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
RUN cat <<'EOF' > /etc/nginx/conf.d/default.conf
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  location / {
    try_files $uri /index.html;
  }

  location /health {
    add_header Content-Type text/plain;
    return 200 'ok';
  }
}
EOF
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
