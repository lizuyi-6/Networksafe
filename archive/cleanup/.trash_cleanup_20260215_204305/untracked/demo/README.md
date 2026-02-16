# FluxGuard Demo Environment

This demo environment allows you to test FluxGuard's security capabilities in an isolated Docker environment.

## 🚀 Quick Start

### Windows
```powershell
cd demo
.\start-demo.ps1
```

### Linux/Mac
```bash
cd demo
chmod +x start-demo.sh
./start-demo.sh
```

## 🌐 Access Points

| Service | URL | Description |
|---------|-----|-------------|
| Vulnerable App | http://localhost:8080 | Intentionally vulnerable website |
| Defense Dashboard | http://localhost:5173 | FluxGuard monitoring interface |
| Backend API | http://localhost:3005 | REST API endpoints |

## 🔥 Attack Simulation

Run automated attacks against the vulnerable app:

### Windows
```powershell
.\start-demo.ps1 -Attack
```

### Linux/Mac
```bash
./start-demo.sh --attack
```

### Attack Types

| Category | Attacks | Severity |
|----------|---------|----------|
| SQL Injection | OR bypass, UNION SELECT, Comment injection | Critical |
| XSS | Script tags, Event handlers, SVG onload | High |
| Path Traversal | Basic, URL encoded, Double encoded | Critical |
| Command Injection | Semicolon, Pipe, AND, Backtick | Critical |
| Rate Abuse | Rapid requests | Medium |

## 📊 View Logs

```powershell
# Windows
.\start-demo.ps1 -Logs

# Linux/Mac
./start-demo.sh --logs
```

## 🛑 Stop Demo

```powershell
# Windows
.\start-demo.ps1 -Stop

# Linux/Mac
./start-demo.sh --stop
```

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Docker Demo Environment                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐     ┌─────────────────────────────────┐   │
│  │  Attack Client  │────▶│    Vulnerable Test Website      │   │
│  │  (攻击模拟器)    │     │    (易受攻击的测试站点)         │   │
│  └─────────────────┘     └──────────────┬──────────────────┘   │
│                                         │                       │
│                                         ▼                       │
│                          ┌─────────────────────────────────┐   │
│                          │      FluxGuard Defense          │   │
│                          │      (流量拦截 + AI 分析)       │   │
│                          └─────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Dashboard (监控面板)                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## ⚠️ WARNING

This demo includes an **intentionally vulnerable** web application. 

- **DO NOT** expose these services to the internet
- **DO NOT** use the vulnerable app code in production
- **ONLY** run in an isolated development environment

## 🧪 Manual Testing

You can also test manually by accessing the vulnerable app at http://localhost:8080 and trying these payloads:

### SQL Injection
```
Username: ' OR '1'='1' --
Password: anything
```

### XSS
```
Comment: <script>alert('XSS')</script>
```

### Path Traversal
```
File: ../../../etc/passwd
```

### Command Injection
```
Host: 127.0.0.1; cat /etc/passwd
```

## 📈 Expected Results

When FluxGuard is properly configured, you should see:
- ✅ SQL injection attacks blocked
- ✅ XSS payloads sanitized or blocked
- ✅ Path traversal attempts denied
- ✅ Command injection prevented
- ✅ Rate limiting triggered for rapid requests
