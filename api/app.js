const express = require('express');
const compression = require('compression');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
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

// 视频流处理中间件
app.use((req, res, next) => {
    // 检查是否是视频或音频请求
    if (req.url.includes('/Videos/') || req.url.includes('/Audio/') || req.url.includes('/video/') || req.url.includes('/audio/')) {
        // 检查是否是直接的媒体文件请求
        if (req.url.includes('/original.') || req.url.includes('/stream')) {
            // 构建目标 URL
            const targetUrl = new URL(req.url, EMBY_SERVER);
            
            // 添加必要的查询参数
            const searchParams = new URLSearchParams(req.url.split('?')[1] || '');
            if (req.headers['range']) {
                searchParams.set('range', req.headers['range']);
            }
            targetUrl.search = searchParams.toString();

            // 设置必要的响应头
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', '*');
            res.setHeader('Cache-Control', 'public, max-age=3600');

            // 重定向到源服务器
            return res.redirect(307, targetUrl.href);
        }
    }
    next();
});

// WebSocket 处理
app.use('/embywebsocket', (req, res) => {
    // 构建 WebSocket URL
    const targetUrl = new URL('/embywebsocket', EMBY_SERVER);
    
    // 设置响应头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    
    // 重定向到源服务器的 WebSocket
    res.redirect(307, targetUrl.href);
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
            },
            timeout: 9000 // 设置为9秒，留出一些余量
        };

        // 创建代理请求
        const proxyReq = protocol.request(options, (proxyRes) => {
            // 设置响应头
            const headers = {
                ...proxyRes.headers,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': '*'
            };

            res.writeHead(proxyRes.statusCode, headers);

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

        // 超时处理
        proxyReq.on('timeout', () => {
            proxyReq.destroy();
            if (!res.headersSent) {
                res.status(504).json({
                    error: 'Gateway Timeout',
                    message: 'Request to Emby server timed out'
                });
            }
        });

        // 如果有请求体，转发它
        if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            req.on('end', () => {
                if (body) {
                    proxyReq.write(body);
                }
                proxyReq.end();
            });
        } else {
            proxyReq.end();
        }
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