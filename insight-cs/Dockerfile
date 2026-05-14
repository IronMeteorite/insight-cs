# Insight CS · Hugging Face Spaces Dockerfile
# HF Spaces 要求容器监听 7860 端口,通过 PORT 环境变量传递

FROM node:20-slim

# better-sqlite3 需要 python 和 build-essential 来编译
RUN apt-get update && apt-get install -y \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# HF Spaces 要求用 user 1000 运行(权限模型)
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH

WORKDIR /home/user/app

# 先拷贝依赖文件,利用 Docker 层缓存
COPY --chown=user package.json package-lock.json ./
RUN npm ci

# 拷贝源码并构建
COPY --chown=user . .
RUN npm run build

# HF Spaces 默认监听 7860
ENV PORT=7860 \
    NODE_ENV=production

EXPOSE 7860

CMD ["node", "dist/index.cjs"]
