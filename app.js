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
    ws: true, // 启用 WebSocket
    proxyTimeout: 8000, // 8 秒代理超时
    timeout: 8000, // 8 秒请求超时
    onProxyRes: (proxyRes, req, res) => {
        // 删除可能导致问题的响应头
        delete proxyRes.headers['strict-transport-security'];
        delete proxyRes.headers['content-security-policy'];
        
        // 添加 CORS 头
        proxyRes.headers['Access-Control-Allow-Origin'] = '*';
        proxyRes.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
        proxyRes.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    },
    onError: (err, req, res) => {
        console.error('Proxy Error:', err);
        if (!res.headersSent) {
            res.status(502).json({ 
                error: 'Proxy Error', 
                message: 'The request to Emby server timed out or failed',
                details: err.message 
            });
        }
    }
};

// WebSocket 特殊处理
app.use('/embywebsocket', (req, res, next) => {
    if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
        res.status(426).json({
            error: 'WebSocket Upgrade Required',
            message: 'WebSocket connections are not supported in this environment. Please use HTTP fallback.'
        });
    } else {
        next();
    }
});

// 设置代理中间件
app.use('/', createProxyMiddleware(proxyOptions));

// 导出应用实例供 Vercel 使用
module.exports = app; 