const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const compression = require('compression');
require('dotenv').config();

const app = express();

// 启用压缩，但排除视频流
app.use(compression({
    filter: (req, res) => {
        const contentType = res.getHeader('Content-Type') || '';
        return !contentType.includes('video/') && !contentType.includes('audio/') && compression.filter(req, res);
    }
}));

// 从环境变量获取 Emby 服务器地址
const EMBY_SERVER = process.env.EMBY_SERVER || '';

// 健康检查端点
app.get('/healthz', (req, res) => {
    res.json({ status: 'healthy' });
});

// 配置代理选项
const proxyOptions = {
    target: EMBY_SERVER,
    changeOrigin: true,
    secure: false,
    ws: true,
    timeout: 60000,
    buffer: true,
    onProxyRes: (proxyRes, req, res) => {
        // 删除可能导致问题的响应头
        delete proxyRes.headers['strict-transport-security'];
        delete proxyRes.headers['content-security-policy'];
        
        // 添加 CORS 头
        proxyRes.headers['Access-Control-Allow-Origin'] = '*';
        proxyRes.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
        proxyRes.headers['Access-Control-Allow-Headers'] = '*';

        // 对视频流的特殊处理
        const contentType = proxyRes.headers['content-type'] || '';
        if (contentType.includes('video/') || contentType.includes('audio/')) {
            proxyRes.headers['Cache-Control'] = 'public, max-age=3600';
            proxyRes.headers['Transfer-Encoding'] = 'chunked';
            if (res.socket) {
                res.socket.setNoDelay(true);
            }
        }
    },
    onError: (err, req, res) => {
        console.error('Proxy Error:', err);
        if (!res.headersSent) {
            res.status(502).json({ 
                error: 'Proxy Error', 
                message: 'The request to Emby server failed',
                details: err.message 
            });
        }
    }
};

// 设置代理中间件
app.use('/', createProxyMiddleware(proxyOptions));

// 导出应用实例供 Vercel 使用
module.exports = app; 