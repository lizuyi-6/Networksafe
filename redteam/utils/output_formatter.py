#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
输出格式化工具模块
用于格式化渗透测试结果输出
⚠️ 仅用于授权渗透测试 ⚠️
"""

import json
from typing import Dict, Any, List
from datetime import datetime
from pathlib import Path


class OutputFormatter:
    """输出格式化类"""

    # 颜色代码
    COLORS = {
        'red': '\033[91m',
        'green': '\033[92m',
        'yellow': '\033[93m',
        'blue': '\033[94m',
        'magenta': '\033[95m',
        'cyan': '\033[96m',
        'white': '\033[97m',
        'reset': '\033[0m',
        'bold': '\033[1m',
    }

    # 风险等级颜色
    SEVERITY_COLORS = {
        'critical': 'red',
        'high': 'red',
        'medium': 'yellow',
        'low': 'blue',
        'info': 'cyan',
    }

    @classmethod
    def colorize(cls, text: str, color: str) -> str:
        """
        给文本添加颜色

        Args:
            text: 文本内容
            color: 颜色名称

        Returns:
            带颜色代码的文本
        """
        color_code = cls.COLORS.get(color, '')
        reset_code = cls.COLORS['reset']
        return f"{color_code}{text}{reset_code}"

    @classmethod
    def print_header(cls, title: str):
        """打印标题头"""
        width = 60
        border = '=' * width
        print(f"\n{cls.colorize(border, 'cyan')}")
        print(f"{cls.colorize(title.center(width), 'bold')}")
        print(f"{cls.colorize(border, 'cyan')}\n")

    @classmethod
    def print_success(cls, message: str):
        """打印成功消息"""
        print(f"{cls.colorize('[+]', 'green')} {message}")

    @classmethod
    def print_error(cls, message: str):
        """打印错误消息"""
        print(f"{cls.colorize('[-]', 'red')} {message}")

    @classmethod
    def print_warning(cls, message: str):
        """打印警告消息"""
        print(f"{cls.colorize('[!]', 'yellow')} {message}")

    @classmethod
    def print_info(cls, message: str):
        """打印信息消息"""
        print(f"{cls.colorize('[*]', 'blue')} {message}")

    @classmethod
    def print_vulnerability(cls, vuln: Dict[str, Any]):
        """
        打印漏洞信息

        Args:
            vuln: 漏洞信息字典
        """
        severity = vuln.get('severity', 'info').lower()
        color = cls.SEVERITY_COLORS.get(severity, 'white')

        print(f"\n{cls.colorize('┌─────────────────────────────────────────────────────', color)}")
        print(f"{cls.colorize('│ 漏洞类型:', color)} {vuln.get('type', 'Unknown')}")
        print(f"{cls.colorize('│ 风险等级:', color)} {cls.colorize(vuln.get('severity', 'Unknown').upper(), color)}")
        print(f"{cls.colorize('│ 影响范围:', color)} {vuln.get('url', 'Unknown')}")

        if vuln.get('description'):
            print(f"{cls.colorize('│ 描述:', color)} {vuln['description']}")

        if vuln.get('payload'):
            print(f"{cls.colorize('│ Payload:', color)} {vuln['payload']}")

        if vuln.get('evidence'):
            print(f"{cls.colorize('│ 证据:', color)} {vuln['evidence']}")

        if vuln.get('remediation'):
            print(f"{cls.colorize('│ 修复建议:', color)} {vuln['remediation']}")

        print(f"{cls.colorize('└─────────────────────────────────────────────────────', color)}")

    @classmethod
    def print_attack_chain(cls, chain: Dict[str, Any]):
        """
        打印攻击链信息

        Args:
            chain: 攻击链信息字典
        """
        print(f"\n{cls.colorize('════════════════════════════════════════════════════════', 'magenta')}")
        print(f"{cls.colorize('攻击链:', 'bold')} {chain.get('name', 'Unknown')}")

        steps = chain.get('steps', [])
        for i, step in enumerate(steps, 1):
            status_icon = '✓' if step.get('success') else '✗'
            status_color = 'green' if step.get('success') else 'red'

            print(f"\n{cls.colorize(f'步骤 {i}:', 'cyan')} {step.get('description', 'Unknown')}")
            print(f"  状态: {cls.colorize(status_icon, status_color)}")
            print(f"  类型: {step.get('type', 'Unknown')}")
            if step.get('url'):
                print(f"  目标: {step['url']}")
            if step.get('payload'):
                print(f"  Payload: {step['payload']}")
            if step.get('result'):
                print(f"  结果: {step['result']}")

        print(f"\n{cls.colorize('最终状态:', 'bold')} {cls.colorize(chain.get('status', 'Unknown'), 'green' if chain.get('success') else 'red')}")
        print(f"{cls.colorize('════════════════════════════════════════════════════════', 'magenta')}")

    @classmethod
    def print_progress(cls, current: int, total: int, message: str = ""):
        """
        打印进度条

        Args:
            current: 当前进度
            total: 总数
            message: 附加消息
        """
        percent = (current / total) * 100 if total > 0 else 0
        bar_length = 40
        filled = int(bar_length * current / total) if total > 0 else 0
        bar = '█' * filled + '░' * (bar_length - filled)

        print(f"\r{cls.colorize('Progress:', 'cyan')} [{bar}] {percent:.1f}% {message}", end='', flush=True)

        if current >= total:
            print()  # 换行

    @classmethod
    def print_table(cls, headers: List[str], rows: List[List[str]]):
        """
        打印表格

        Args:
            headers: 表头列表
            rows: 数据行列表
        """
        # 计算每列宽度
        col_widths = []
        for i, header in enumerate(headers):
            max_width = len(header)
            for row in rows:
                if i < len(row):
                    max_width = max(max_width, len(row[i]))
            col_widths.append(max_width + 2)

        # 打印表头
        header_line = ''.join(
            header.ljust(width) for header, width in zip(headers, col_widths)
        )
        separator_line = ''.join('-' * width for width in col_widths)

        print(f"{cls.colorize(header_line, 'bold')}")
        print(f"{cls.colorize(separator_line, 'cyan')}")

        # 打印数据行
        for row in rows:
            row_line = ''.join(
                (row[i] if i < len(row) else '').ljust(width)
                for i, width in enumerate(col_widths)
            )
            print(row_line)

    @classmethod
    def generate_report(cls, results: Dict[str, Any], output_path: str = None) -> str:
        """
        生成渗透测试报告

        Args:
            results: 测试结果
            output_path: 输出路径

        Returns:
            报告内容
        """
        report = {
            'timestamp': datetime.now().isoformat(),
            'summary': {
                'total_vulnerabilities': len(results.get('vulnerabilities', [])),
                'critical': sum(1 for v in results.get('vulnerabilities', []) if v.get('severity') == 'Critical'),
                'high': sum(1 for v in results.get('vulnerabilities', []) if v.get('severity') == 'High'),
                'medium': sum(1 for v in results.get('vulnerabilities', []) if v.get('severity') == 'Medium'),
                'low': sum(1 for v in results.get('vulnerabilities', []) if v.get('severity') == 'Low'),
            },
            'vulnerabilities': results.get('vulnerabilities', []),
            'attack_chains': results.get('attack_chains', []),
        }

        report_json = json.dumps(report, indent=2, ensure_ascii=False)

        if output_path:
            Path(output_path).parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, 'w', encoding='utf-8') as f:
                f.write(report_json)
            cls.print_success(f"报告已保存到: {output_path}")

        return report_json


class EvidenceCollector:
    """证据收集类"""

    def __init__(self, base_dir: str = '/mnt/x/want/fsce/redteam/evidence'):
        """
        初始化证据收集器

        Args:
            base_dir: 证据存储目录
        """
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def save_response(self, url: str, response: Any, payload: str = "") -> str:
        """
        保存HTTP响应证据

        Args:
            url: 请求URL
            response: 响应对象
            payload: 使用的payload

        Returns:
            保存的文件路径
        """
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"response_{timestamp}.txt"
        filepath = self.base_dir / filename

        evidence = {
            'timestamp': datetime.now().isoformat(),
            'url': url,
            'payload': payload,
            'status_code': getattr(response, 'status_code', None),
            'headers': dict(getattr(response, 'headers', {})),
            'body': str(getattr(response, 'text', ''))[:5000],  # 限制大小
        }

        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(evidence, f, indent=2, ensure_ascii=False)

        return str(filepath)

    def save_screenshot(self, url: str, image_data: bytes) -> str:
        """
        保存截图证据

        Args:
            url: 页面URL
            image_data: 图片数据

        Returns:
            保存的文件路径
        """
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"screenshot_{timestamp}.png"
        filepath = self.base_dir / filename

        with open(filepath, 'wb') as f:
            f.write(image_data)

        return str(filepath)

    def save_vulnerability(self, vuln: Dict[str, Any]) -> str:
        """
        保存漏洞信息

        Args:
            vuln: 漏洞信息字典

        Returns:
            保存的文件路径
        """
        vuln_type = vuln.get('type', 'unknown').replace(' ', '_').lower()
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"vuln_{vuln_type}_{timestamp}.json"
        filepath = self.base_dir / filename

        vuln['timestamp'] = datetime.now().isoformat()

        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(vuln, f, indent=2, ensure_ascii=False)

        return str(filepath)
