# Checklist

- [x] auth-security.service.ts 中所有 Redis 调用前都有 isAvailable() 检查
- [x] anti-bot.middleware.ts 中所有 Redis 调用前都有 isAvailable() 检查
- [x] ratelimit.middleware.ts 中所有 Redis 调用前都有 isAvailable() 检查
- [x] 后端服务可以正常启动
- [x] 前端服务可以正常启动
- [x] 登录功能正常工作
- [x] 日志中没有 Redis 相关的阻塞错误
