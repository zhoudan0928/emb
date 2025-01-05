const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const compression = require('compression');
const http = require('http');
const https = require('https');
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

// 创建代理处理函数
app.use('/', async (req, res) => {
    try {
        // 构建目标 URL
        const targetUrl = new URL(req.url, EMBY_SERVER);
        
        // 选择合适的协议
        const protocol = targetUrl.protocol === 'https:' ? https : http;
        
        // 设置请求选项
        const options = {
            hostname: targetUrl.hostname,
            port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
            path: targetUrl.pathname + targetUrl.search,
            method: req.method,
            headers: {
                ...req.headers,
                host: targetUrl.host,
            }
        };

        // 创建代理请求
        const proxyReq = protocol.request(options, (proxyRes) => {
            // 设置响应头
            res.writeHead(proxyRes.statusCode, {
                ...proxyRes.headers,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': '*'
            });

            // 如果是视频或音频内容，添加特殊处理
            const contentType = proxyRes.headers['content-type'] || '';
            if (contentType.includes('video/') || contentType.includes('audio/')) {
                res.setHeader('Cache-Control', 'public, max-age=3600');
                if (res.socket) {
                    res.socket.setNoDelay(true);
                }
            }

            // 流式传输响应
            proxyRes.pipe(res);
        });

        // 错误处理
        proxyReq.on('error', (error) => {
            console.error('Proxy Error:', error);
            if (!res.headersSent) {
                res.status(502).json({
                    error: 'Proxy Error',
                    message: 'Failed to connect to Emby server',
                    details: error.message
                });
            }
        });

        // 如果有请求体，转发它
        if (req.body) {
            proxyReq.write(JSON.stringify(req.body));
        }

        // 结束请求
        proxyReq.end();
    } catch (error) {
        console.error('Error:', error);
        if (!res.headersSent) {
            res.status(500).json({
                error: 'Internal Server Error',
                message: error.message
            });
        }
    }
});

// 导出应用实例供 Vercel 使用
module.exports = app; 