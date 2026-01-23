# 笔记本AI服务器 - 完整实现
# ai_server.py - 运行在开发者笔记本上

from flask import Flask, request, jsonify
import requests
import json
import datetime

# ==================== 配置 ====================

# Ollama配置
OLLAMA_HOST = "localhost"
OLLAMA_PORT = 11434
OLLAMA_URL = f"http://{OLLAMA_HOST}:{OLLAMA_PORT}/api/generate"
OLLAMA_MODEL = "deepseek-coder:6.7b"  # 2026年最强代码模型，专门优化部署错误分析

# Flask服务器配置
FLASK_HOST = "0.0.0.0"
FLASK_PORT = 8000
FLASK_DEBUG = False

# ==================== Flask应用 ====================

app = Flask(__name__)

# ==================== 路由 ====================

@app.route('/')
def index():
    """首页"""
    return jsonify({
        "service": "Deployment AI Server",
        "version": "1.0",
        "status": "running",
        "ollama": OLLAMA_URL,
        "model": OLLAMA_MODEL
    })

@app.route('/health')
def health():
    """健康检查"""
    return jsonify({"status": "ok"}), 200

@app.route('/api/analyze', methods=['POST'])
def analyze_error():
    """
    分析部署错误

    接收:
    {
        "error": "错误信息"
    }

    返回:
    {
        "solution": "AI生成的解决方案",
        "confidence": 0.9,
        "timestamp": "2024-01-23T12:00:00"
    }
    """
    try:
        data = request.get_json()
        error_text = data.get('error', '')

        if not error_text:
            return jsonify({"error": "No error text provided"}), 400

        print(f"\n{'='*60}")
        print(f"[{datetime.datetime.now()}] 收到错误:")
        print(f"{error_text[:200]}")
        print(f"{'='*60}\n")

        # 检测是否是敏感信息
        if is_sensitive(error_text):
            print("[Security] 检测到敏感信息，使用本地AI")
            solution = query_ollama_local(error_text)
        else:
            print("[AI] 使用本地AI")
            solution = query_ollama_local(error_text)

        if not solution:
            solution = "抱歉，AI暂时无法分析此错误。请检查错误日志并手动处理。"

        print(f"[AI] 解决方案:\n{solution}\n")

        return jsonify({
            "solution": solution,
            "confidence": 0.9,
            "timestamp": datetime.datetime.now().isoformat()
        }), 200

    except Exception as e:
        print(f"[Error] 分析失败: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/test', methods=['POST'])
def test_connection():
    """测试连接"""
    return jsonify({
        "message": "Connection successful",
        "ollama": test_ollama()
    })

# ==================== 辅助函数 ====================

def is_sensitive(text):
    """
    检测是否包含敏感信息

    敏感信息包括：
    - 密码、密钥、token
    - 用户个人信息
    - IP地址、域名
    """
    sensitive_patterns = [
        'password', 'passwd', 'pwd',
        'secret', 'api_key', 'apikey', 'api-key',
        'token', 'access_token',
        'credential', 'auth',
        'user.*name', 'username',
        'email', 'phone',
        'session', 'cookie'
    ]

    import re
    text_lower = text.lower()

    # 检查敏感关键词
    for pattern in sensitive_patterns:
        if re.search(pattern, text_lower):
            return True

    # 检查IP地址
    if re.search(r'\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}', text):
        return True

    # 检查URL
    if re.search(r'https?://[^\s]+', text):
        return True

    return False

def query_ollama_local(prompt):
    """
    查询本地Ollama AI

    提示词工程：
    - 明确角色（部署专家）
    - 明确任务（分析和解决错误）
    - 明确输出格式（简洁的解决方案）
    """

    system_prompt = """你是一个经验丰富的部署专家。你的任务是分析部署错误并提供解决方案。

请按照以下格式回答：
1. **错误原因**：简要说明错误原因（1-2句话）
2. **解决方案**：提供具体的解决步骤（编号列出）
3. **预防措施**：如何避免此类错误（1-2句话）

请用中文回答，保持简洁明了。"""

    full_prompt = f"""{system_prompt}

---
错误信息：
{prompt}

请分析并提供解决方案。"""

    try:
        print(f"[Ollama] 正在查询 {OLLAMA_MODEL}...")

        response = requests.post(
            OLLAMA_URL,
            json={
                "model": OLLAMA_MODEL,
                "prompt": full_prompt,
                "stream": False,
                "options": {
                    "temperature": 0.3,  # 降低随机性
                    "top_p": 0.9,
                    "num_predict": 500  # 限制输出长度
                }
            },
            timeout=60  # 60秒超时
        )

        if response.status_code == 200:
            result = response.json()
            solution = result.get('response', '')

            # 清理输出
            solution = solution.strip()

            # 移除多余的标记
            if solution.startswith("```"):
                solution = solution.split("```")[1]
                if solution.endswith("```"):
                    solution = solution[:-3]

            return solution
        else:
            print(f"[Ollama] HTTP错误: {response.status_code}")
            return None

    except requests.exceptions.Timeout:
        print("[Ollama] 请求超时")
        return None
    except Exception as e:
        print(f"[Ollama] 查询失败: {e}")
        return None

def test_ollama():
    """测试Ollama是否可用"""
    try:
        response = requests.get(
            f"http://{OLLAMA_HOST}:{OLLAMA_PORT}/api/tags",
            timeout=5
        )
        return response.status_code == 200
    except:
        return False

# ==================== 主程序 ====================

def print_banner():
    """打印横幅"""
    print("""
╔══════════════════════════════════════════════════════════╗
║                                                            ║
║        ESP32 部署助手 - AI 服务器                          ║
║                                                            ║
║  版本: 1.0                                                 ║
║  Ollama: {}:{}                                   ║
║  模型: {}                                           ║
║                                                            ║
╚══════════════════════════════════════════════════════════╝
    """.format(OLLAMA_HOST, OLLAMA_PORT, OLLAMA_MODEL))

def check_prerequisites():
    """检查前提条件"""
    print("\n[检查] 检查前提条件...")

    # 检查Ollama
    print("[检查] Ollama...", end=" ")
    if test_ollama():
        print("✓ 可用")
    else:
        print("✗ 不可用")
        print("\n[错误] 请先启动Ollama:")
        print("  ollama serve")
        return False

    # 检查模型
    print("[检查] Ollama模型...", end=" ")
    try:
        response = requests.get(f"http://{OLLAMA_HOST}:{OLLAMA_PORT}/api/tags")
        if response.status_code == 200:
            models = response.json().get('models', [])
            model_names = [m.get('name', '') for m in models]
            if any(OLLAMA_MODEL in name for name in model_names):
                print(f"✓ {OLLAMA_MODEL} 已安装")
            else:
                print(f"✗ {OLLAMA_MODEL} 未安装")
                print(f"\n[提示] 可用模型: {', '.join(model_names[:5])}")
                print(f"[提示] 拉取模型: ollama pull {OLLAMA_MODEL}")
        else:
            print("✗ 无法获取模型列表")
    except:
        print("✗ 检查失败")

    return True

def main():
    """主函数"""
    print_banner()

    # 检查前提条件
    if not check_prerequisites():
        print("\n[提示] 请确保Ollama正在运行:")
        print("  $ ollama serve")
        print("\n[提示] 并拉取模型:")
        print(f"  $ ollama pull {OLLAMA_MODEL}")
        return

    print("\n[启动] 启动AI服务器...")
    print(f"[信息] 监听地址: http://{FLASK_HOST}:{FLASK_PORT}")
    print(f"[信息] API端点: http://{FLASK_HOST}:{FLASK_PORT}/api/analyze")
    print(f"[信息] 健康检查: http://{FLASK_HOST}:{FLASK_PORT}/health")
    print("\n[提示] 按 Ctrl+C 停止服务器\n")

    # 启动Flask服务器
    app.run(
        host=FLASK_HOST,
        port=FLASK_PORT,
        debug=FLASK_DEBUG,
        threaded=True
    )

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n[停止] AI服务器已停止")
    except Exception as e:
        print(f"\n[错误] 服务器错误: {e}")
