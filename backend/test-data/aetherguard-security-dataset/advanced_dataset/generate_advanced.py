#!/usr/bin/env python3
"""
AetherGuard 测试样本生成器 v3
补充更多高级攻击类型
"""

import json
import random
import base64
from datetime import datetime
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent / "advanced_dataset"
OUTPUT_DIR.mkdir(exist_ok=True)

# ============================================================================
# 1. HTTP 请求走私 (100 条)
# ============================================================================

def generate_smuggling(count=100):
    payloads = [
        # CL.TE 走私
        "POST / HTTP/1.1\r\nHost: example.com\r\nContent-Length: 13\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\nGET /admin HTTP/1.1\r\nHost: example.com\r\n\r\n",
        # TE.CL 走私
        "POST / HTTP/1.1\r\nHost: example.com\r\nContent-Length: 3\r\nTransfer-Encoding: chunked\r\n\r\n8\r\nSMUGGLED\r\n0\r\n\r\n",
        # 走私 + 缓存投毒
        "POST / HTTP/1.1\r\nHost: example.com\r\nContent-Length: 60\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\nGET /static/script.js HTTP/1.1\r\nHost: example.com\r\nX-Forwarded-Host: evil.com\r\n\r\n",
        # 请求分割
        "GET / HTTP/1.1\r\nHost: example.com\r\n\r\nGET /admin HTTP/1.1\r\nHost: example.com\r\n\r\n",
    ]
    dataset = []
    for i in range(count):
        dataset.append({
            "id": f"smuggle_{i:04d}",
            "type": "http_smuggling",
            "payload": random.choice(payloads),
            "severity": "critical",
            "expected_detection": True,
            "source_ip": f"{random.randint(1,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}",
            "timestamp": datetime.now().isoformat()
        })
    return dataset

# ============================================================================
# 2. 模板注入 (SSTI) (100 条)
# ============================================================================

def generate_ssti(count=100):
    payloads = [
        # Jinja2 / Twig
        "{{7*7}}",
        "{{config}}",
        "{{self.__class__}}",
        "{{''.__class__.__mro__[1].__subclasses__()}}",
        "{{request.application.__globals__}}",
        "{{get_flashed_messages.__globals__}}",
        "{{config.__class__.__init__.__globals__['os'].popen('id').read()}}",
        "{%import os%}{{os.popen('id').read()}}",
        # Freemarker
        "${7*7}",
        "${.now()}",
        "${.version}",
        "${\"freemarker.template.utility.Execute\"?new()(\"id\")}",
        # Velocity
        "#set($x=7*7)$x",
        "$class.inspect('java.lang.Runtime')",
        # Smarty
        "{php}echo `id`;{/php}",
        "{system('id')}",
        # Thymeleaf
        "${T(java.lang.Runtime).getRuntime().exec('id')}",
        # Pebble
        "{{beans.get('runtime').exec('id')}}",
        # Mako
        "${self.module.cache.util.os.popen('id').read()}",
    ]
    dataset = []
    for i in range(count):
        dataset.append({
            "id": f"ssti_{i:04d}",
            "type": "ssti",
            "payload": random.choice(payloads),
            "severity": "critical",
            "expected_detection": True,
            "source_ip": f"{random.randint(1,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}",
            "timestamp": datetime.now().isoformat()
        })
    return dataset

# ============================================================================
# 3. OAuth/认证绕过 (100 条)
# ============================================================================

def generate_oauth_bypass(count=100):
    payloads = [
        # Open Redirect for OAuth
        "/redirect?url=http://evil.com",
        "/callback?code=stolen_code",
        "/auth?redirect_uri=http://evil.com/callback",
        # Token 泄露
        "/api/user?access_token=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
        "/page#access_token=ya29.a0f...",
        # JWT 弱密钥
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbiIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTUxNjIzOTAyMn0.x",
        # None 算法绕过
        "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJhZG1pbiIsInJvbGUiOiJhZG1pbiJ9.",
        # 会话固定
        "Cookie: PHPSESSID=fixed_session_id; session=fixed",
        # 认证绕过
        "Authorization: Basic YWRtaW46YWRtaW4=",
        "X-Forwarded-For: 127.0.0.1",
        "X-Original-URL: /admin",
        "X-Rewrite-URL: /admin",
        "X-Custom-IP-Authorization: 127.0.0.1",
    ]
    dataset = []
    for i in range(count):
        dataset.append({
            "id": f"oauth_{i:04d}",
            "type": "oauth_bypass",
            "payload": random.choice(payloads),
            "severity": "high",
            "expected_detection": True,
            "source_ip": f"{random.randint(1,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}",
            "timestamp": datetime.now().isoformat()
        })
    return dataset

# ============================================================================
# 4. API 滥用 (100 条)
# ============================================================================

def generate_api_abuse(count=100):
    payloads = [
        # GraphQL 注入
        '{"query": "{__schema { types { name } } }"}',
        '{"query": "{ user(id: 1) { password } }"}',
        '{"query": "mutation { deleteUser(id: 1) }"}',
        '{"query": "{ __type(name: \"User\") { fields { name } } }"}',
        # 批量查询
        "POST /api/batch HTTP/1.1\r\n\r\n[{\"method\":\"GET\",\"url\":\"/api/user/1\"},{\"method\":\"DELETE\",\"url\":\"/api/user/1\"}]",
        # IDOR
        "/api/user/1", "/api/user/2", "/api/user/3",
        "/api/orders/123", "/api/orders/124",
        "/api/documents/456", "/api/documents/457",
        # 速率限制绕过
        "X-Forwarded-For: 10.0.0.1",
        "X-Forwarded-For: 10.0.0.2",
        "X-Real-IP: 10.0.0.1",
        "Client-IP: 10.0.0.1",
        # 批量枚举
        "/api/users?page=1&size=1000",
        "/api/search?q=*&limit=999999",
    ]
    dataset = []
    for i in range(count):
        dataset.append({
            "id": f"api_{i:04d}",
            "type": "api_abuse",
            "payload": random.choice(payloads),
            "severity": "medium",
            "expected_detection": True,
            "source_ip": f"{random.randint(1,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}",
            "timestamp": datetime.now().isoformat()
        })
    return dataset

# ============================================================================
# 5. WebSocket 攻击 (50 条)
# ============================================================================

def generate_websocket_attack(count=50):
    payloads = [
        # WebSocket 劫持
        "Sec-WebSocket-Protocol: admin",
        "Origin: http://evil.com",
        # WebSocket 注入
        '{"type":"admin","action":"delete_all"}',
        '{"type":"subscribe","channel":"admin"}',
        '{"type":"execute","command":"id"}',
        # CSRF over WebSocket
        '{"type":"transfer","to":"attacker","amount":1000}',
        '{"type":"change_password","new":"hacked123"}',
    ]
    dataset = []
    for i in range(count):
        dataset.append({
            "id": f"ws_{i:04d}",
            "type": "websocket_attack",
            "payload": random.choice(payloads),
            "severity": "high",
            "expected_detection": True,
            "source_ip": f"{random.randint(1,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}",
            "timestamp": datetime.now().isoformat()
        })
    return dataset

# ============================================================================
# 6. 缓存投毒 (50 条)
# ============================================================================

def generate_cache_poison(count=50):
    payloads = [
        "X-Forwarded-Host: evil.com\r\nX-Forwarded-Scheme: http",
        "X-Host: evil.com\r\nX-Forwarded-Server: evil.com",
        "X-Forwarded-Proto: http",
        "X-Original-URL: /admin",
        "X-Rewrite-URL: /admin",
        "Origin: http://evil.com",
        # Web Cache Deception
        "/private/data.js",
        "/api/users.json",
        "/admin/settings.css",
    ]
    dataset = []
    for i in range(count):
        dataset.append({
            "id": f"cache_{i:04d}",
            "type": "cache_poison",
            "payload": random.choice(payloads),
            "severity": "high",
            "expected_detection": True,
            "source_ip": f"{random.randint(1,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}",
            "timestamp": datetime.now().isoformat()
        })
    return dataset

# ============================================================================
# 7. Unicode/编码绕过 (100 条)
# ============================================================================

def generate_encoding_bypass(count=100):
    payloads = [
        # Unicode 同形字
        "аdmin",  # Cyrillic 'а' instead of 'a'
        "pаssword",  # Cyrillic 'а'
        "ａｄｍｉｎ",  # Fullwidth
        # Unicode 规范化
        "ﬁle",  # fi ligature
        "ﬂag",  # fl ligature
        # 双重编码
        "%252e%252e%252f%252e%252e%252f%252e%252e%252fetc/passwd",
        "%2525252e%2525252e%2525252f",
        # 过度 UTF-8
        "%c0%ae%c0%ae%c0%af",
        "%e0%80%ae%e0%80%ae%e0%80%af",
        # 混合编码
        "..%c0%af..%c0%af..%c0%afetc/passwd",
        "%2e%2e%5c%2e%2e%5c%2e%2e%5c",
        # Null 字节
        "file.php%00.jpg",
        "file.php\x00.jpg",
        # HPP
        "?id=1&id=2",
        "?file=a.txt&file=../../../etc/passwd",
    ]
    dataset = []
    for i in range(count):
        dataset.append({
            "id": f"encode_{i:04d}",
            "type": "encoding_bypass",
            "payload": random.choice(payloads),
            "severity": "medium",
            "expected_detection": True,
            "source_ip": f"{random.randint(1,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}",
            "timestamp": datetime.now().isoformat()
        })
    return dataset

# ============================================================================
# 8. 协议污染 (50 条)
# ============================================================================

def generate_protocol_pollution(count=50):
    payloads = [
        # HTTP 请求走私
        "GET / HTTP/1.1\r\nHost: a.com\r\n\r\nGET /admin HTTP/1.1\r\nHost: b.com\r\n\r\n",
        # CRLF 注入
        "test%0d%0aSet-Cookie: hacked=true",
        "test\r\nSet-Cookie: session=attacker",
        "test%0d%0a%0d%0a<html>hacked</html>",
        # Host 头攻击
        "Host: evil.com",
        "Host: target.com\r\nX-Forwarded-Host: evil.com",
        # HTTP/2 降级攻击
        ":method: GET\r\n:path: /admin\r\n:authority: internal.com",
    ]
    dataset = []
    for i in range(count):
        dataset.append({
            "id": f"proto_{i:04d}",
            "type": "protocol_pollution",
            "payload": random.choice(payloads),
            "severity": "high",
            "expected_detection": True,
            "source_ip": f"{random.randint(1,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}",
            "timestamp": datetime.now().isoformat()
        })
    return dataset

# ============================================================================
# 9. 更多正常流量 (500 条)
# ============================================================================

def generate_normal_traffic_extended(count=500):
    samples = [
        # API 请求
        "GET /api/v1/users HTTP/1.1\r\nHost: api.example.com\r\nAuthorization: Bearer eyJ...\r\nAccept: application/json\r\n",
        "POST /api/v1/orders HTTP/1.1\r\nHost: api.example.com\r\nContent-Type: application/json\r\n\r\n{\"product_id\": 123, \"quantity\": 2}",
        "PUT /api/v1/users/123 HTTP/1.1\r\nHost: api.example.com\r\n\r\n{\"name\": \"John Doe\"}",
        "DELETE /api/v1/sessions/current HTTP/1.1\r\nHost: api.example.com\r\n",
        # 静态资源
        "GET /static/js/app.js HTTP/1.1\r\nHost: cdn.example.com\r\n",
        "GET /static/css/style.css HTTP/1.1\r\nHost: cdn.example.com\r\n",
        "GET /images/logo.png HTTP/1.1\r\nHost: static.example.com\r\n",
        # 搜索
        "GET /search?q=hello+world&page=1 HTTP/1.1\r\nHost: example.com\r\n",
        "GET /products?category=electronics&sort=price HTTP/1.1\r\nHost: shop.example.com\r\n",
        # 表单提交
        "POST /contact HTTP/1.1\r\nHost: example.com\r\nContent-Type: application/x-www-form-urlencoded\r\n\r\nname=John&email=john@example.com&message=Hello",
        "POST /subscribe HTTP/1.1\r\nHost: example.com\r\n\r\nemail=user@example.com",
        # 登录/注册
        "POST /login HTTP/1.1\r\nHost: example.com\r\n\r\nusername=user@example.com&password=SecurePass123!",
        "POST /register HTTP/1.1\r\nHost: example.com\r\n\r\nemail=new@example.com&password=NewPass456!&confirm=NewPass456!",
        # 文件下载
        "GET /download/document.pdf HTTP/1.1\r\nHost: files.example.com\r\n",
        "GET /export/data.csv HTTP/1.1\r\nHost: api.example.com\r\n",
        # WebSocket 握手
        "GET /ws HTTP/1.1\r\nHost: example.com\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n",
        # 健康检查
        "GET /health HTTP/1.1\r\nHost: example.com\r\n",
        "GET /status HTTP/1.1\r\nHost: example.com\r\n",
        # Webhook 回调
        "POST /webhook/payment HTTP/1.1\r\nHost: example.com\r\nX-Signature: sha256=abc123\r\n\r\n{\"event\": \"payment.success\", \"amount\": 100}",
    ]
    dataset = []
    for i in range(count):
        dataset.append({
            "id": f"normal_v3_{i:04d}",
            "type": "normal",
            "payload": random.choice(samples),
            "severity": "none",
            "expected_detection": False,
            "source_ip": f"{random.randint(1,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}",
            "timestamp": datetime.now().isoformat()
        })
    return dataset

# ============================================================================
# 主函数
# ============================================================================

def main():
    print("=" * 70)
    print("AetherGuard 测试样本生成器 v3 - 高级攻击类型")
    print("=" * 70)
    
    generators = [
        ("15_http_smuggling.json", generate_smuggling(100)),
        ("16_ssti.json", generate_ssti(100)),
        ("17_oauth_bypass.json", generate_oauth_bypass(100)),
        ("18_api_abuse.json", generate_api_abuse(100)),
        ("19_websocket.json", generate_websocket_attack(50)),
        ("20_cache_poison.json", generate_cache_poison(50)),
        ("21_encoding_bypass.json", generate_encoding_bypass(100)),
        ("22_protocol_pollution.json", generate_protocol_pollution(50)),
        ("23_normal_extended.json", generate_normal_traffic_extended(500)),
    ]
    
    total = 0
    attack = 0
    normal = 0
    
    for filename, data in generators:
        filepath = OUTPUT_DIR / filename
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        is_normal = "normal" in filename
        icon = "🟢" if is_normal else "🔴"
        count = len(data)
        total += count
        
        if is_normal:
            normal += count
        else:
            attack += count
        
        print(f"{icon} {filename}: {count} 条")
    
    print("\n" + "=" * 70)
    print("📊 数据集统计")
    print("=" * 70)
    print(f"🔴 攻击样本: {attack}")
    print(f"🟢 正常样本: {normal}")
    print(f"📁 总计: {total}")
    print(f"📂 位置: {OUTPUT_DIR}")
    print("=" * 70)

if __name__ == "__main__":
    main()
