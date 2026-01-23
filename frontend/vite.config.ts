import { defineConfig } from 'vite'
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
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve("./src"),
        },
    },
    server: {
        // 启用 HTTPS (如果证书可用)
        https: httpsConfig,
        proxy: {
            '/api': {
                // 后端也将使用 HTTPS
                target: process.env.API_TARGET || (httpsConfig ? 'https://127.0.0.1:3005' : 'http://127.0.0.1:3005'),
                changeOrigin: true,
                secure: false, // 允许自签名证书
            }
        }
    }
})
