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

// WebSocket 处理
app.use('/embywebsocket', (req, res) => {
    try {
        if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
            const targetUrl = new URL('/embywebsocket', EMBY_SERVER);
            const wsClient = new WebSocket(targetUrl.href);

            wsClient.on('open', () => {
                // 创建到客户端的 WebSocket 连接
                const wss = new WebSocket.Server({ noServer: true });
                
                wss.on('connection', function connection(ws) {
                    // 从客户端到服务器的消息转发
                    ws.on('message', function message(data) {
                        wsClient.send(data);
                    });

                    // 从服务器到客户端的消息转发
                    wsClient.on('message', function message(data) {
                        ws.send(data);
                    });

                    // 错误处理
                    ws.on('error', console.error);
                });

                // 升级连接
                wss.handleUpgrade(req, req.socket, Buffer.alloc(0), function done(ws) {
                    wss.emit('connection', ws, req);
                });
            });

            wsClient.on('error', (error) => {
                console.error('WebSocket Error:', error);
                if (!res.headersSent) {
                    res.status(502).json({
                        error: 'WebSocket Error',
                        message: error.message
                    });
                }
            });
        } else {
            res.status(400).json({
                error: 'Bad Request',
                message: 'WebSocket upgrade required'
            });
        }
    } catch (error) {
        console.error('WebSocket Setup Error:', error);
        if (!res.headersSent) {
            res.status(500).json({
                error: 'WebSocket Setup Error',
                message: error.message
            });
        }
    }
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

        // 根据请求类型设置超时
        let timeout = 10000; // 默认10秒
        if (req.url.includes('PlaybackInfo')) {
            timeout = 30000; // PlaybackInfo 30秒
        } else if (req.url.includes('/Videos/') || req.url.includes('/Audio/')) {
            timeout = 300000; // 视频/音频 5分钟
        } else if (req.url.includes('/Sessions/')) {
            timeout = 30000; // Sessions 相关 30秒
        }
        options.timeout = timeout;

        // 创建代理请求
        const proxyReq = protocol.request(options, (proxyRes) => {
            // 设置响应头
            const headers = {
                ...proxyRes.headers,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': '*'
            };

            // 如果是视频或音频内容，添加特殊处理
            const contentType = proxyRes.headers['content-type'] || '';
            if (contentType.includes('video/') || contentType.includes('audio/')) {
                headers['Cache-Control'] = 'public, max-age=3600';
                if (res.socket) {
                    res.socket.setNoDelay(true);
                }
            }

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