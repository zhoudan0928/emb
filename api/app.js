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

// 视频流处理
app.use(['/emby/videos/:id/*', '/Videos/:id/*', '/emby/Videos/:id/*'], async (req, res) => {
    try {
        const targetUrl = new URL(req.url, EMBY_SERVER);
        const protocol = targetUrl.protocol === 'https:' ? https : http;

        // 如果是重定向的web路径，直接返回视频流
        if (req.url.includes('/web/')) {
            const videoId = req.params.id;
            const newUrl = `/emby/videos/${videoId}/original.mkv`;
            res.redirect(newUrl);
            return;
        }

        // 设置请求选项
        const options = {
            hostname: targetUrl.hostname,
            port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
            path: targetUrl.pathname + targetUrl.search,
            method: 'GET',
            headers: {
                ...req.headers,
                host: targetUrl.host
            }
        };

        // 如果有 Range 头，添加它
        if (req.headers.range) {
            options.headers.range = req.headers.range;
        }

        // 创建请求
        const proxyReq = protocol.request(options, (proxyRes) => {
            // 如果是重定向响应
            if (proxyRes.statusCode === 302 || proxyRes.statusCode === 301) {
                const location = proxyRes.headers.location;
                if (location) {
                    res.redirect(location);
                    return;
                }
            }

            // 设置响应头
            const headers = {
                ...proxyRes.headers,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET',
                'Access-Control-Allow-Headers': '*',
                'Cache-Control': 'public, max-age=3600'
            };

            // 删除可能导致问题的头
            delete headers['content-length'];
            delete headers['transfer-encoding'];

            // 设置正确的状态码
            let statusCode = proxyRes.statusCode;
            if (req.headers.range) {
                statusCode = 206;
                headers['Accept-Ranges'] = 'bytes';
            }

            res.writeHead(statusCode, headers);

            // 使用较小的块大小
            const chunkSize = 64 * 1024; // 64KB chunks
            let buffer = Buffer.alloc(0);

            proxyRes.on('data', (chunk) => {
                buffer = Buffer.concat([buffer, chunk]);
                
                // 当缓冲区达到或超过块大小时发送数据
                while (buffer.length >= chunkSize) {
                    const chunk = buffer.slice(0, chunkSize);
                    buffer = buffer.slice(chunkSize);
                    res.write(chunk);
                }
            });

            proxyRes.on('end', () => {
                // 发送剩余的数据
                if (buffer.length > 0) {
                    res.write(buffer);
                }
                res.end();
            });
        });

        // 错误处理
        proxyReq.on('error', (error) => {
            console.error('Video Stream Error:', error);
            if (!res.headersSent) {
                res.status(502).json({
                    error: 'Video Stream Error',
                    message: error.message
                });
            }
        });

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