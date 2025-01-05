const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
require('dotenv').config();

const app = express();

// 从环境变量获取 Emby 服务器地址
const EMBY_SERVER = process.env.EMBY_SERVER;

if (!EMBY_SERVER) {
    console.error('EMBY_SERVER environment variable is not set');
    process.exit(1);
}

// 健康检查端点
app.get('/healthz', (req, res) => {
    res.json({ status: 'healthy' });
});

// 配置代理选项
const proxyOptions = {
    target: EMBY_SERVER,
    changeOrigin: true,
    secure: false,
    onProxyRes: (proxyRes) => {
        // 删除可能导致问题的响应头
        delete proxyRes.headers['strict-transport-security'];
        delete proxyRes.headers['content-security-policy'];
    },
    onError: (err, req, res) => {
        console.error('Proxy Error:', err);
        res.status(502).json({ error: 'Proxy Error', message: err.message });
    }
};

// 设置代理中间件
app.use('/', createProxyMiddleware(proxyOptions));

// 导出应用实例供 Vercel 使用
module.exports = app; 