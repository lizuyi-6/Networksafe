# 🚀 NewSecurity 部署指南

## 快速部署（推荐）

### 使用一键安装脚本

```bash
curl -fsSL https://raw.githubusercontent.com/your-org/NewSecurity/main/scripts/install.sh | sudo bash
```

这将自动：
1. 安装Docker和Docker Compose
2. 创建必要的目录
3. 构建和启动NewSecurity
4. 配置SSL证书

---

## 手动部署

### 前置要求

- **操作系统**：Ubuntu 20.04+ / Debian 11+ / CentOS 8+
- **内存**：至少 2GB RAM
- **磁盘**：至少 20GB 可用空间
- **网络**：开放 80 和 443 端口

### 安装步骤

#### 1. 安装Docker

**Ubuntu/Debian:**
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
```

**CentOS/RHEL:**
```bash
sudo yum install -y yum-utils
sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo yum install -y docker-ce docker-ce-cli containerd.io
sudo systemctl start docker
sudo systemctl enable docker
```

#### 2. 安装Docker Compose

```bash
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
docker-compose --version
```

#### 3. 下载NewSecurity

```bash
cd /opt
sudo git clone https://github.com/your-org/NewSecurity.git
cd NewSecurity
```

#### 4. 配置环境变量

```bash
cp .env.example .env
nano .env
```

编辑以下配置：
```bash
# 服务器配置
NODE_ENV=production
HTTP_PORT=80
HTTPS_PORT=443

# SSL证书邮箱
SSL_EMAIL=your-email@example.com

# Redis配置
REDIS_URL=redis://redis:6379

# 数据目录
DATA_DIR=/app/data
CERTS_DIR=/app/certs
```

#### 5. 启动服务

```bash
# 构建镜像
sudo docker-compose build

# 启动服务
sudo docker-compose up -d

# 查看状态
sudo docker-compose ps
```

#### 6. 验证安装

```bash
# 检查健康状态
curl http://localhost/api/health

# 预期输出：
# {"status":"healthy","timestamp":"2026-01-13T...","version":"1.0.0"}
```

---

## 配置您的网站

### 添加网站配置

创建 `config/sites.json`:
```json
{
  "sites": [
    {
      "domain": "example.com",
      "target": "http://localhost:3000",
      "sslEnabled": true,
      "security": {
        "antiBot": true,
        "rateLimit": {
          "enabled": true,
          "requestsPerMinute": 60
        },
        "concurrency": {
          "enabled": true,
          "maxConcurrent": 5
        }
      }
    }
  ]
}
```

### 通过API添加

```bash
curl -X POST http://localhost/api/sites \
  -H "Content-Type: application/json" \
  -d @config/sites.json
```

---

## DNS配置

### 将域名指向服务器

1. **登录您的DNS提供商**（GoDaddy, Cloudflare等）
2. **添加A记录**：
   - 类型：A
   - 名称：@（或 www）
   - 值：您的服务器IP地址
   - TTL：300（或默认值）

3. **等待DNS生效**（通常5-30分钟）

4. **验证DNS**：
```bash
dig example.com +short
# 应该返回您的服务器IP
```

---

## SSL证书

### 自动证书（推荐）

NewSecurity会自动申请Let's Encrypt证书：

```bash
# 重启容器以触发证书申请
sudo docker-compose restart newsecurity

# 查看证书日志
sudo docker-compose logs -f newsecurity | grep "certificate"
```

### 手动证书

如果您有自己的证书：

```bash
# 将证书复制到certs目录
sudo cp your-cert.crt /opt/NewSecurity/certs/
sudo cp your-cert.key /opt/NewSecurity/certs/

# 重启服务
sudo docker-compose restart newsecurity
```

---

## 防火墙配置

### UFW (Ubuntu/Debian)

```bash
# 允许HTTP和HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 启用防火墙
sudo ufw enable

# 查看状态
sudo ufw status
```

### firewalld (CentOS/RHEL)

```bash
# 允许HTTP和HTTPS
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https

# 重载防火墙
sudo firewall-cmd --reload

# 查看状态
sudo firewall-cmd --list-all
```

---

## 性能优化

### 系统参数优化

编辑 `/etc/sysctl.conf`:
```bash
# 增加文件描述符限制
fs.file-max = 65535

# 增加连接队列
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 8192

# TCP优化
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 30

# 应用配置
sudo sysctl -p
```

### 限制调优

编辑 `/etc/security/limits.conf`:
```bash
* soft nofile 65535
* hard nofile 65535
```

---

## 监控和维护

### 查看日志

```bash
# 实时日志
sudo docker-compose logs -f

# 最近100行
sudo docker-compose logs --tail=100

# 只看错误
sudo docker-compose logs | grep ERROR
```

### 备份

```bash
# 备份数据库
sudo docker exec newsecurity-db sqlite3 /app/data/newsecurity.db ".backup /tmp/backup.db"

# 备份配置
sudo tar -czf backup-$(date +%Y%m%d).tar.gz /opt/NewSecurity/data /opt/NewSecurity/certs
```

### 更新

```bash
# 拉取最新代码
cd /opt/NewSecurity
sudo git pull

# 重新构建
sudo docker-compose build

# 重启服务
sudo docker-compose down
sudo docker-compose up -d
```

---

## 故障排除

### 端口被占用

```bash
# 检查80端口
sudo netstat -tulpn | grep :80

# 停止占用端口的进程
sudo systemctl stop nginx  # 如果nginx占用
sudo systemctl stop apache2  # 如果apache占用
```

### Docker容器无法启动

```bash
# 查看详细日志
sudo docker-compose logs newsecurity

# 重新构建
sudo docker-compose build --no-cache
sudo docker-compose up -d
```

### SSL证书申请失败

```bash
# 检查DNS解析
dig example.com

# 检查80端口是否开放
sudo netstat -tulpn | grep :80

# 使用Let's Encrypt staging环境测试
# 编辑 .env
NODE_ENV=staging
```

### Redis连接失败

```bash
# 检查Redis容器
sudo docker-compose ps redis

# 查看Redis日志
sudo docker-compose logs redis

# 重启Redis
sudo docker-compose restart redis
```

---

## 安全建议

### 1. 定期更新

```bash
# 每周更新系统
sudo apt update && sudo apt upgrade -y  # Ubuntu/Debian
sudo yum update -y  # CentOS/RHEL

# 每月更新NewSecurity
cd /opt/NewSecurity
sudo git pull && sudo docker-compose build && sudo docker-compose up -d
```

### 2. 启用防火墙

如上所述配置UFW或firewalld。

### 3. 限制SSH访问

```bash
# 禁用root登录
sudo sed -i 's/PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config

# 禁用密码登录（使用密钥）
sudo sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config

# 重启SSH
sudo systemctl restart sshd
```

### 4. 配置fail2ban

```bash
sudo apt install fail2ban -y
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

---

## 生产环境检查清单

- [ ] DNS已正确配置
- [ ] SSL证书已生效
- [ ] 防火墙已启用
- [ ] 系统参数已优化
- [ ] 日志监控已配置
- [ ] 备份计划已设置
- [ ] 更新策略已制定
- [ ] 服务器扫描已完成
- [ ] 优化建议已应用

---

## 获取帮助

- 📖 文档：[README.md](README.md)
- 🐛 报告问题：[GitHub Issues](https://github.com/your-org/NewSecurity/issues)
- 💬 社区讨论：[GitHub Discussions](https://github.com/your-org/NewSecurity/discussions)
- 📧 邮件：support@newsecurity.io

---

**部署成功！** 🎉

您的NewSecurity实例现在正在运行。

下一步：
1. 添加您的网站
2. 运行服务器扫描
3. 应用优化建议
