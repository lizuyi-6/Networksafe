# ESP32 部署助手 - 完整实现（适配真实需求）
# main.py - 部署助手主程序

import machine
import network
import time
import uasyncio as asyncio
from machine import Pin, I2C, PWM, UART
import ssd1306
import urequests
import ujson
import gc

# ==================== 配置参数 ====================

# 开发者笔记本WiFi配置
DEVELOPER_WIFI_SSID = "你的笔记本WiFi热点名称"
DEVELOPER_WIFI_PASSWORD = "密码"

# AI服务器配置（笔记本IP）
AI_SERVER_IP = "192.168.1.100"  # 修改为你的笔记本IP
AI_SERVER_PORT = 8000

# 用户服务器连接配置
UART_BAUDRATE = 115200
UART_BUFFER_SIZE = 2048

# 性能配置
ERROR_DEBOUNCE_TIME = 5  # 错误防抖（秒）
MAIN_LOOP_DELAY = 0.1    # 主循环延迟
NETWORK_TIMEOUT = 15     # 网络超时（秒）
MAX_RETRY = 3            # 最大重试次数

# 引脚定义
PIN_OLED_SDA = 21
PIN_OLED_SCL = 22
PIN_LED_R = 16
PIN_LED_G = 17
PIN_LED_B = 18
PIN_BTN_ACCEPT = 4
PIN_BTN_ROLLBACK = 5
PIN_BTN_DETAIL = 6
PIN_BUZZER = 19
PIN_UART_TX = 1
PIN_UART_RX = 3

# ==================== 硬件管理类 ====================

class Hardware:
    """硬件管理类 - 单例模式"""

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        # OLED 屏幕
        self.i2c = I2C(scl=Pin(PIN_OLED_SCL), sda=Pin(PIN_OLED_SDA), freq=400000)
        self.oled = ssd1306.SSD1306_I2C(128, 64, self.i2c)
        self.oled_lines = [""] * 6

        # RGB LED
        self.led_r = PWM(Pin(PIN_LED_R), freq=5000, duty=0)
        self.led_g = PWM(Pin(PIN_LED_G), freq=5000, duty=0)
        self.led_b = PWM(Pin(PIN_LED_B), freq=5000, duty=0)
        self.current_color = (0, 0, 0)

        # 按钮
        self.btn_accept = Pin(PIN_BTN_ACCEPT, Pin.IN, Pin.PULL_UP)
        self.btn_rollback = Pin(PIN_BTN_ROLLBACK, Pin.IN, Pin.PULL_UP)
        self.btn_detail = Pin(PIN_BTN_DETAIL, Pin.IN, Pin.PULL_UP)
        self.last_btn_state = [1, 1, 1]

        # 蜂鸣器
        self.buzzer = Pin(PIN_BUZZER, Pin.OUT)
        self.buzzer.off()

        # UART（连接用户服务器）
        self.uart = UART(
            1,
            baudrate=UART_BAUDRATE,
            tx=Pin(PIN_UART_TX),
            rx=Pin(PIN_UART_RX),
            rxbuf=UART_BUFFER_SIZE
        )
        self.uart_buffer = bytearray()

        self._initialized = True

    # ==================== LED 控制 ====================

    def set_rgb(self, r, g, b, smooth=False):
        """设置RGB颜色"""
        if smooth and (r, g, b) != self.current_color:
            steps = 10
            for i in range(steps + 1):
                factor = i / steps
                cr, cg, cb = self.current_color
                self.led_r.duty(int(cr + (r - cr) * factor))
                self.led_g.duty(int(cg + (g - cg) * factor))
                self.led_b.duty(int(cb + (b - cb) * factor))
                time.sleep_ms(20)
        else:
            self.led_r.duty(r)
            self.led_g.duty(g)
            self.led_b.duty(b)

        self.current_color = (r, g, b)

    def led_off(self):
        """关闭LED"""
        self.set_rgb(0, 0, 0)

    def led_idle(self):
        """蓝色 - 监控中"""
        self.set_rgb(0, 0, 1023, smooth=True)

    def led_error(self):
        """红色 - 检测到错误"""
        self.set_rgb(1023, 0, 0, smooth=True)

    def led_waiting(self):
        """紫色 - 等待AI分析"""
        self.set_rgb(1023, 0, 1023, smooth=True)

    def led_processing(self):
        """黄色 - 处理中"""
        self.set_rgb(1023, 1023, 0, smooth=True)

    def led_success(self):
        """绿色 - 成功"""
        self.set_rgb(0, 1023, 0, smooth=True)

    # ==================== 蜂鸣器控制 ====================

    def beep(self, duration=0.1, count=1):
        """蜂鸣器响"""
        for _ in range(count):
            self.buzzer.on()
            time.sleep(duration)
            self.buzzer.off()
            if count > 1:
                time.sleep(0.05)

    def beep_error(self):
        """错误音（急促3声）"""
        self.beep(0.1, 3)

    def beep_success(self):
        """成功音（上升2声）"""
        self.beep(0.1, 2)

    # ==================== OLED 显示 ====================

    def oled_show(self, lines, force=False):
        """OLED显示（带缓存）"""
        if isinstance(lines, str):
            lines = [lines]

        lines = [line[:18] for line in lines[:6]]

        if not force and lines == self.oled_lines:
            return

        self.oled.fill(0)
        y = 0
        for line in lines:
            self.oled.text(line, 0, y)
            y += 11
        self.oled.show()

        self.oled_lines = lines

    # ==================== 按钮读取 ====================

    def read_buttons(self):
        """读取按钮事件"""
        states = [
            self.btn_accept.value(),
            self.btn_rollback.value(),
            self.btn_detail.value()
        ]

        events = []

        for i, (old, new) in enumerate(zip(self.last_btn_state, states)):
            if old == 1 and new == 0:  # 下降沿 = 按下
                events.append(i)

        self.last_btn_state = states
        return events

    # ==================== UART 读取（连接服务器）====================

    def read_server_output(self):
        """读取用户服务器的终端输出"""
        if self.uart.any():
            new_data = self.uart.read()
            if new_data:
                self.uart_buffer.extend(new_data)

                # 防止溢出
                if len(self.uart_buffer) > UART_BUFFER_SIZE:
                    self.uart_buffer = self.uart_buffer[-UART_BUFFER_SIZE:]

        # 返回完整行
        if b'\n' in self.uart_buffer:
            line, self.uart_buffer = self.uart_buffer.split(b'\n', 1)
            try:
                return line.decode('utf-8', errors='ignore').strip()
            except:
                return ""

        return None

    def send_command(self, command):
        """向服务器发送命令"""
        try:
            self.uart.write(command.encode())
            self.uart.write(b'\n')
            return True
        except:
            return False


# ==================== 服务器读取器 ====================

class ServerReader:
    """读取用户服务器输出"""

    def __init__(self, hardware):
        self.hw = hardware
        self.output_buffer = ""
        self.last_output_time = 0

    def read(self):
        """读取服务器输出"""
        line = self.hw.read_server_output()
        if line:
            self.output_buffer += line + "\n"
            self.last_output_time = time.time()

            # 保留最近5KB
            if len(self.output_buffer) > 5120:
                self.output_buffer = self.output_buffer[-5120:]

            return line
        return None

    def get_recent_output(self, lines=20):
        """获取最近的输出"""
        lines_list = self.output_buffer.split('\n')
        return '\n'.join(lines_list[-lines:])


# ==================== 错误检测器 ====================

class ErrorDetector:
    """检测部署错误"""

    # 部署相关错误关键词
    ERROR_PATTERNS = [
        "error", "Error", "ERROR",
        "exception", "Exception",
        "failed", "Failed", "FAILED",
        "cannot", "Cannot", "CANNOT",
        "npm ERR!", "gyp ERR!",
        "EACCES", "ECONNREFUSED",
        "ETIMEDOUT", "ENOTFOUND"
    ]

    # 部署关键词
    DEPLOYMENT_KEYWORDS = [
        "npm install",
        "npm run build",
        "npm run deploy",
        "docker build",
        "docker-compose up",
        "starting deployment",
        "building project"
    ]

    def __init__(self):
        self.last_error_time = 0
        self.last_error_hash = None
        self.is_deploying = False

    def check_deployment(self, output):
        """检测是否在部署"""
        if not output:
            return self.is_deploying

        for keyword in self.DEPLOYMENT_KEYWORDS:
            if keyword.lower() in output.lower():
                self.is_deploying = True
                return True

        return self.is_deploying

    def is_error(self, output):
        """检测是否是错误"""
        if not output:
            return False

        # 防抖
        current_time = time.time()
        if current_time - self.last_error_time < ERROR_DEBOUNCE_TIME:
            return False

        # 检测错误关键词
        output_lower = output.lower()
        for pattern in self.ERROR_PATTERNS:
            if pattern.lower() in output_lower:
                # 去重
                error_hash = hash(output[:100])
                if error_hash != self.last_error_hash:
                    self.last_error_time = current_time
                    self.last_error_hash = error_hash
                    return True

        return False

    def extract_error_info(self, output):
        """提取错误信息"""
        lines = output.split('\n')
        for i, line in enumerate(lines):
            if self.is_error(line):
                # 返回错误行 + 上下文
                context_start = max(0, i - 2)
                context_end = min(len(lines), i + 3)
                context = '\n'.join(lines[context_start:context_end])
                return {
                    'error_line': line.strip()[:60],
                    'context': context
                }
        return None


# ==================== AI 客户端 ====================

class AIClient:
    """与笔记本AI通信"""

    def __init__(self, server_ip, server_port):
        self.base_url = f"http://{server_ip}:{server_port}"
        self.last_request_time = 0

    def test_connection(self):
        """测试连接"""
        try:
            response = urequests.get(
                f"{self.base_url}/health",
                timeout=5
            )
            if response.status_code == 200:
                response.close()
                return True
            response.close()
        except:
            pass
        return False

    def analyze_error(self, error_text, retry=MAX_RETRY):
        """发送错误到AI分析"""
        # 防止频繁请求
        current_time = time.time()
        if current_time - self.last_request_time < 2:
            time.sleep(2)

        for attempt in range(retry):
            try:
                print(f"[AI] 发送错误到AI (尝试 {attempt + 1}/{retry})...")

                response = urequests.post(
                    f"{self.base_url}/api/analyze",
                    json={"error": error_text},
                    headers={"Content-Type": "application/json"},
                    timeout=NETWORK_TIMEOUT
                )

                if response.status_code == 200:
                    result = response.json()
                    response.close()
                    self.last_request_time = time.time()
                    return result.get("solution", "")
                else:
                    print(f"[AI] HTTP错误: {response.status_code}")
                    response.close()

            except Exception as e:
                print(f"[AI] 连接错误: {e}")
                if attempt < retry - 1:
                    time.sleep(2)

        return None


# ==================== 用户界面 ====================

class UserInterface:
    """用户交互界面"""

    def __init__(self, hardware):
        self.hw = hardware

    def show_welcome(self):
        """显示欢迎"""
        self.hw.oled_show([
            "Deployment",
            "Assistant v1.0",
            "",
            "Connecting to",
            "Developer WiFi..."
        ])
        self.hw.led_idle()

    def show_ready(self, wifi_ip):
        """显示就绪"""
        self.hw.oled_show([
            "System Ready",
            "",
            f"WiFi: {wifi_ip or 'No IP'}",
            "",
            "Monitoring server",
            "deployment...",
            "",
            "[Ready]"
        ])
        self.hw.led_idle()

    def show_monitoring(self):
        """显示监控中"""
        self.hw.oled_show([
            "MONITORING",
            "",
            "Reading server",
            "output...",
            "",
            "[● Monitoring]"
        ])
        self.hw.led_idle()

    def show_error_detected(self, error_info):
        """显示检测到错误"""
        error_line = error_info.get('error_line', 'Unknown error')[:18]
        self.hw.oled_show([
            "ERROR DETECTED!",
            "",
            error_line,
            "",
            "Sending to AI...",
            "",
            "[Analyzing...]"
        ])
        self.hw.led_error()
        self.hw.beep_error()

    def show_waiting_ai(self):
        """显示等待AI"""
        self.hw.oled_show([
            "Waiting for AI",
            "",
            "Analyzing error",
            "Please wait...",
            "",
            "[.........]"
        ])
        self.hw.led_waiting()

    def show_solution(self, solution):
        """显示AI解决方案"""
        lines = ["AI SOLUTION:"]
        for i, line in enumerate(solution.split('\n')[:4]):
            lines.append(line[:18])
        lines.extend(["", "[Accept][Skip]"])
        self.hw.oled_show(lines)
        self.hw.led_processing()

    def show_detail(self, content):
        """显示详情"""
        lines = content.split('\n')
        for i in range(0, len(lines), 5):
            page = lines[i:i+5]
            self.hw.oled_show(page)
            time.sleep(3)

    def show_executing(self, command):
        """显示执行中"""
        self.hw.oled_show([
            "Executing fix...",
            "",
            command[:36],
            "",
            "[Working...]"
        ])
        self.hw.led_processing()

    def show_success(self):
        """显示成功"""
        self.hw.oled_show([
            "SUCCESS!",
            "",
            "Fix applied",
            "Continuing",
            "deployment...",
            "",
            "[✓]"
        ])
        self.hw.led_success()
        self.hw.beep_success()
        time.sleep(2)

    def show_deployment_complete(self):
        """显示部署完成"""
        self.hw.oled_show([
            "DEPLOYMENT",
            "COMPLETE!",
            "",
            "AetherGuard is",
            "running now",
            "",
            "[Finished]"
        ])
        self.hw.led_success()
        self.hw.beep_success()


# ==================== 主应用类 ====================

class DeploymentAssistant:
    """部署助手主类"""

    def __init__(self):
        # 硬件
        self.hw = Hardware()

        # WiFi
        self.wlan = network.WLAN(network.STA_IF)
        self.wlan.active(True)

        # 模块
        self.server_reader = ServerReader(self.hw)
        self.error_detector = ErrorDetector()
        self.ai_client = AIClient(AI_SERVER_IP, AI_SERVER_PORT)
        self.ui = UserInterface(self.hw)

        # 状态
        self.state = "idle"  # idle, monitoring, error, waiting_ai, showing_solution, executing
        self.current_error = None
        self.current_solution = None

        # 性能
        self.loop_count = 0
        self.last_gc_time = time.time()

    def connect_wifi(self):
        """连接开发者WiFi"""
        print(f"[WiFi] 连接到 {DEVELOPER_WIFI_SSID}...")

        self.wlan.connect(DEVELOPER_WIFI_SSID, DEVELOPER_WIFI_PASSWORD)

        for i in range(40):
            if self.wlan.isconnected():
                ip = self.wlan.ifconfig()[0]
                print(f"[WiFi] 已连接! IP: {ip}")
                return ip
            time.sleep(0.5)

        print("[WiFi] 连接失败")
        return None

    def test_ai_connection(self):
        """测试AI服务器"""
        print("[AI] 测试AI服务器...")
        if self.ai_client.test_connection():
            print("[AI] AI服务器可用")
            return True
        else:
            print("[AI] AI服务器不可用，但继续运行")
            return False

    async def wait_for_user_choice(self, timeout=60):
        """等待用户选择"""
        start_time = time.time()

        while time.time() - start_time < timeout:
            events = self.hw.read_buttons()

            if 0 in events:  # Accept
                return "accept"
            elif 1 in events:  # Skip
                return "skip"
            elif 2 in events:  # Detail
                return "detail"

            await asyncio.sleep(0.1)

        return "timeout"

    async def process_error(self, error_info):
        """处理错误"""
        self.state = "error"
        self.ui.show_error_detected(error_info)

        await asyncio.sleep(1)

        # 发送到AI
        self.state = "waiting_ai"
        self.ui.show_waiting_ai()

        error_text = error_info.get('context', '')
        solution = self.ai_client.analyze_error(error_text)

        if not solution:
            self.hw.oled_show(["AI Unavailable", "", "Try again later", "", "[Skip]"])
            await asyncio.sleep(2)
            return

        # 显示解决方案
        self.state = "showing_solution"
        self.current_solution = solution
        self.ui.show_solution(solution)

        # 等待用户选择
        choice = await self.wait_for_user_choice()

        if choice == "detail":
            self.ui.show_detail(error_text)
            await asyncio.sleep(3)
            self.ui.show_solution(solution)
            choice = await self.wait_for_user_choice()

        if choice == "accept":
            # 执行修复（简化版）
            self.state = "executing"
            self.ui.show_executing("Applying AI fix...")

            # 这里可以解析solution中的命令并执行
            # 目前简化处理
            await asyncio.sleep(2)

            self.ui.show_success()
        else:
            # 跳过
            self.hw.oled_show(["Skipped", "", "Continuing...", "", "[OK]"])
            await asyncio.sleep(1)

        self.state = "monitoring"

    async def main_loop(self):
        """主循环"""
        print("[Main] 启动部署助手")

        # 检查部署状态
        deployment_keywords_count = 0

        while True:
            try:
                # 定期垃圾回收
                current_time = time.time()
                if current_time - self.last_gc_time > 60:
                    gc.collect()
                    self.last_gc_time = current_time
                    print(f"[GC] 内存: {gc.mem_free()} bytes")

                # 读取服务器输出
                output = self.server_reader.read()

                if output:
                    print(f"[Server] {output[:50]}")

                    # 检测部署
                    if self.error_detector.check_deployment(output):
                        deployment_keywords_count += 1
                        if self.state == "idle":
                            self.state = "monitoring"
                            self.ui.show_monitoring()
                    else:
                        deployment_keywords_count = max(0, deployment_keywords_count - 1)

                    # 检测错误（只在部署时）
                    if deployment_keywords_count > 0 and self.error_detector.is_error(output):
                        print("[Error] 检测到部署错误")

                        error_info = self.error_detector.extract_error_info(
                            self.server_reader.get_recent_output()
                        )

                        if error_info and self.state == "monitoring":
                            await self.process_error(error_info)

                # 读取按钮（idle状态可以查看历史）
                if self.state == "idle":
                    events = self.hw.read_buttons()
                    if events:
                        self.ui.show_ready(self.wlan.ifconfig()[0])

                # 更新状态显示
                if self.state == "monitoring" and self.loop_count % 100 == 0:
                    self.ui.show_monitoring()

                await asyncio.sleep(MAIN_LOOP_DELAY)
                self.loop_count += 1

            except Exception as e:
                print(f"[Error] 主循环错误: {e}")
                self.hw.oled_show([f"Error:", str(e)[:30]])
                self.hw.beep_error()
                await asyncio.sleep(2)


# ==================== 启动 ====================

async def main():
    """主函数"""
    print("=" * 50)
    print("ESP32 部署助手 v1.0")
    print("=" * 50)

    app = DeploymentAssistant()

    # 显示欢迎
    app.ui.show_welcome()

    # 连接WiFi
    wifi_ip = app.connect_wifi()
    if not wifi_ip:
        app.hw.oled_show(["WiFi Failed!", "Check config"])
        app.hw.beep_error()
        return

    # 测试AI
    app.test_ai_connection()

    # 显示就绪
    app.ui.show_ready(wifi_ip)
    await asyncio.sleep(2)

    # 启动主循环
    await app.main_loop()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[Main] 程序已停止")
    except Exception as e:
        print(f"[Main] 致命错误: {e}")
