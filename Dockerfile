# 构建阶段
FROM node:18-slim AS builder

WORKDIR /app

# 复制 package.json 和 package-lock.json（如果存在）
COPY package*.json ./

# 安装依赖
RUN npm install --production

# 复制源代码
COPY . .

# 运行阶段
FROM node:18-slim

WORKDIR /app

# 从构建阶段复制必要的文件
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/app.js ./
COPY --from=builder /app/package.json ./

# 设置环境变量
ENV NODE_ENV=production

# 暴露端口
EXPOSE 7860

# 启动命令
CMD ["node", "app.js"] 