# Insight CS · Hugging Face Spaces Dockerfile
# HF Spaces 要求容器监听 7860 端口,通过 PORT 环境变量传递

FROM node:20-slim

# better-sqlite3 需要 python 和 build-essential 来编译
RUN apt-get update && apt-get install -y \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# HF Spaces 基础镜像已预创建 UID 1000 的 user,直接用即可(不再 useradd)
# 先用 root 建目录并 chown,再切换到 user
WORKDIR /home/user/app
RUN chown -R 1000:1000 /home/user

USER 1000
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH

# 先拷贝依赖文件,利用 Docker 层缓存
COPY --chown=1000:1000 package.json package-lock.json ./
RUN npm ci

# 拷贝源码并构建
COPY --chown=1000:1000 . .
RUN npm run build

# HF Spaces 默认监听 7860
ENV PORT=7860 \
    NODE_ENV=production

EXPOSE 7860

CMD ["node", "dist/index.cjs"]
