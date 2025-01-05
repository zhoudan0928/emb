const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const compression = require('compression');
require('dotenv').config();

const app = express();

// 启用压缩，但排除视频流
app.use(compression({
    filter: (req, res) => {
        const contentType = res.getHeader('Content-Type') || '';
        // 不压缩视频和音频内容
        if (contentType.includes('video/') || contentType.includes('audio/')) {
            return false;
        }
        return compression.filter(req, res);
    }
}));

// 从环境变量获取 Emby 服务器地址
const EMBY_SERVER = process.env.EMBY_SERVER || '';

// 健康检查端点
app.get('/healthz', (req, res) => {
    res.json({ status: 'healthy' });
});

// 视频流特殊处理
app.use((req, res, next) => {
    const isVideoRequest = req.path.includes('/Videos/') || 
                         req.path.includes('/Audio/') || 
                         req.path.includes('/video/') || 
                         req.path.includes('/audio/');
    
    if (isVideoRequest) {
        // 对视频请求使用特殊的代理选项
        const videoProxyOptions = {
            ...proxyOptions,
            timeout: 300000,        // 5分钟超时
            proxyTimeout: 300000,   // 5分钟代理超时
            buffer: true,
            selfHandleResponse: false,
            onProxyRes: (proxyRes, req, res) => {
                // 删除可能导致问题的响应头
                delete proxyRes.headers['strict-transport-security'];
                delete proxyRes.headers['content-security-policy'];
                
                // 添加 CORS 头
                proxyRes.headers['Access-Control-Allow-Origin'] = '*';
                proxyRes.headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
                proxyRes.headers['Access-Control-Allow-Headers'] = '*';
                
                // 设置缓存和传输相关头
                proxyRes.headers['Cache-Control'] = 'public, max-age=3600';
                proxyRes.headers['Transfer-Encoding'] = 'chunked';
                
                // 设置缓冲区大小
                if (res.socket) {
                    res.socket.setNoDelay(true);
                    res.socket.setTimeout(300000);
                }
            }
        };
        return createProxyMiddleware(videoProxyOptions)(req, res, next);
    }
    next();
});

// 配置代理选项
const proxyOptions = {
    target: EMBY_SERVER,
    changeOrigin: true,
    secure: false,
    ws: true,
    proxyTimeout: 60000,    // 60秒超时
    timeout: 60000,         // 60秒超时
    buffer: true,
    onProxyReq: (proxyReq, req) => {
        // 添加必要的请求头
        proxyReq.setHeader('X-Forwarded-For', req.ip);
        proxyReq.setHeader('X-Forwarded-Proto', 'https');
    },
    onProxyRes: (proxyRes, req, res) => {
        // 删除可能导致问题的响应头
        delete proxyRes.headers['strict-transport-security'];
        delete proxyRes.headers['content-security-policy'];
        
        // 添加 CORS 头
        proxyRes.headers['Access-Control-Allow-Origin'] = '*';
        proxyRes.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
        proxyRes.headers['Access-Control-Allow-Headers'] = '*';

        // 设置缓存控制
        if (!proxyRes.headers['cache-control']) {
            proxyRes.headers['Cache-Control'] = 'public, max-age=0, must-revalidate';
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