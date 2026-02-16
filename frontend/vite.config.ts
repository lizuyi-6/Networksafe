import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

// HTTPS 配置 (用于本地开发)
const httpsConfig = (() => {
    const certPath = path.resolve(__dirname, '../certs/localhost.crt');
    const keyPath = path.resolve(__dirname, '../certs/localhost.key');

    // 如果证书存在，启用 HTTPS
    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
        return {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath),
        };
    }
    return undefined;
})();

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
    // Load env file based on `mode` in the current working directory.
    // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
    const env = loadEnv(mode, process.cwd(), '')

    return {
        plugins: [react()],
        resolve: {
            alias: {
                "@": path.resolve("./src"),
            },
        },
        server: {
            host: true, // Allow external access (0.0.0.0)
            // 启用 HTTPS (如果证书可用)
            // https: httpsConfig,
            proxy: {
                '/api': {
                    target: env.VITE_API_TARGET || 'http://127.0.0.1:3005',
                    changeOrigin: true,
                    secure: false,
                    configure: (proxy, options) => {
                        proxy.on('error', (err, req, res) => {
                            console.log('Proxy error:', err.message, 'for', req.url);
                            console.log('Target:', options.target);
                        });
                        proxy.on('proxyReq', (proxyReq, req, _res) => {
                            console.log('Proxying request:', req.method, req.url, 'to', options.target);
                            if (req.headers.cookie) {
                                proxyReq.setHeader('cookie', req.headers.cookie);
                            }
                        });
                        proxy.on('proxyRes', (proxyRes, req, res) => {
                            console.log('Proxy response:', proxyRes.statusCode, 'for', req.url);
                        });
                    }
                },
                '/socket.io': {
                    target: env.VITE_API_TARGET || 'http://127.0.0.1:3005',
                    changeOrigin: true,
                    ws: true,
                    configure: (proxy, _options) => {
                        proxy.on('error', (err, _req, _res) => {
                            console.log('proxy error', err);
                        });
                        proxy.on('proxyReqWs', (proxyReq, req, socket) => {
                            socket.on('error', (err) => {
                                console.log('socket error', err);
                            });
                        });
                    }
                }
            }
        }
    }
})
