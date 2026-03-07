#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
红队渗透测试框架 - 主入口
============================

这是一个综合性的渗透测试框架，集成了多种漏洞利用模块和攻击链，
用于授权的渗透测试和安全评估。

⚠️ 重要警告: 本框架仅供授权渗透测试使用
    未经授权使用可能违反法律法规

作者: RedTeam Pentest Framework
版本: 1.0.0
"""

import sys
import os
import json
import argparse
from pathlib import Path
from typing import Dict, List, Any, Optional
from datetime import datetime

# 确保可以导入自定义模块
SCRIPT_DIR = Path(__file__).parent.absolute()
sys.path.insert(0, str(SCRIPT_DIR))

from utils.request_helper import RequestHelper
from utils.payload_generator import (
    SQLInjectionPayloads,
    AuthBypassPayloads,
    RCEPayloads,
    PathTraversalPayloads
)
from utils.output_formatter import OutputFormatter, EvidenceCollector


class RedTeamFramework:
    """
    红队渗透测试框架主类

    功能:
    - 漏洞扫描与检测
    - 漏洞利用模块调用
    - 攻击链执行
    - 报告生成
    """

    # 可用模块
    MODULES = {
        'sqli': 'SQL注入利用模块',
        'auth_bypass': '认证绕过模块',
        'rce': '远程代码执行模块',
        'path_traversal': '路径遍历模块',
    }

    # 可用攻击链
    ATTACK_CHAINS = {
        'infoleak_to_rce': '信息泄露到RCE',
        'sqli_to_data_exfil': 'SQL注入到数据外泄',
        'auth_to_admin': '认证到管理员权限',
    }

    def __init__(self, output_dir: str = './output', verbose: bool = False):
        """
        初始化框架

        Args:
            output_dir: 输出目录
            verbose: 是否详细输出
        """
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.verbose = verbose

        # 初始化组件
        self.output = OutputFormatter()
        self.evidence = EvidenceCollector(str(self.output_dir / 'evidence'))

        # 会话状态
        self.session_state = {
            'started_at': datetime.now().isoformat(),
            'modules_executed': [],
            'vulnerabilities_found': [],
            'credentials_discovered': [],
            'attack_chains_completed': [],
        }

        self._print_banner()

    def _print_banner(self):
        """打印框架启动横幅"""
        banner = """
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║           🔴 红队渗透测试框架 (RedTeam Framework)  🔴          ║
║                                                                  ║
║   版本: 1.0.0                                                    ║
║   用途: 授权渗透测试与安全评估                                  ║
║                                                                  ║
║   ⚠️  警告: 本框架仅供授权渗透测试使用                         ║
║       未经授权使用可能违反法律法规                                 ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
        """
        print(banner)

    def run_module(self, module_name: str, target: str, **kwargs) -> Dict[str, Any]:
        """
        运行指定模块

        Args:
            module_name: 模块名称
            target: 目标URL
            **kwargs: 额外参数

        Returns:
            执行结果
        """
        self.output.print_header(f"运行模块: {module_name}")
        self.output.print_info(f"目标: {target}")

        result = {
            'module': module_name,
            'target': target,
            'success': False,
            'findings': [],
            'error': None
        }

        try:
            if module_name == 'sqli':
                result = self._run_sqli_module(target, **kwargs)
            elif module_name == 'auth_bypass':
                result = self._run_auth_bypass_module(target, **kwargs)
            elif module_name == 'rce':
                result = self._run_rce_module(target, **kwargs)
            elif module_name == 'path_traversal':
                result = self._run_path_traversal_module(target, **kwargs)
            else:
                result['error'] = f"未知模块: {module_name}"

        except Exception as e:
            result['error'] = str(e)
            self.output.print_error(f"模块执行失败: {e}")

        self.session_state['modules_executed'].append(result)
        return result

    def _run_sqli_module(self, target: str, **kwargs) -> Dict[str, Any]:
        """运行SQL注入模块"""
        from exploits.sql_injection import SQLInjectionExploit

        parameter = kwargs.get('parameter', 'id')
        exploit = SQLInjectionExploit(target, parameter)

        result = exploit.detect_sql_injection()
        exploit.close()

        return {
            'module': 'sqli',
            'target': target,
            'success': result.get('vulnerable', False),
            'findings': [result] if result.get('vulnerable') else [],
        }

    def _run_auth_bypass_module(self, target: str, **kwargs) -> Dict[str, Any]:
        """运行认证绕过模块"""
        from exploits.auth_bypass import AuthBypassExploit

        exploit = AuthBypassExploit(target)

        # 测试SQL登录绕过
        result = exploit.sql_login_bypass()
        exploit.close()

        return {
            'module': 'auth_bypass',
            'target': target,
            'success': result.get('vulnerable', False),
            'findings': [result] if result.get('vulnerable') else [],
        }

    def _run_rce_module(self, target: str, **kwargs) -> Dict[str, Any]:
        """运行RCE模块"""
        from exploits.rce_exploit import RCEExploit

        parameter = kwargs.get('parameter')
        os_type = kwargs.get('os_type', 'linux')

        exploit = RCEExploit(target, parameter)

        # 测试命令注入
        result = exploit.command_injection_test(os_type)
        exploit.close()

        return {
            'module': 'rce',
            'target': target,
            'success': result.get('vulnerable', False),
            'findings': [result] if result.get('vulnerable') else [],
        }

    def _run_path_traversal_module(self, target: str, **kwargs) -> Dict[str, Any]:
        """运行路径遍历模块"""
        from exploits.path_traversal import PathTraversalExploit

        parameter = kwargs.get('parameter', 'file')
        os_type = kwargs.get('os_type', 'linux')

        exploit = PathTraversalExploit(target, parameter, os_type=os_type)

        # 测试路径遍历
        result = exploit.detect_path_traversal()
        exploit.close()

        return {
            'module': 'path_traversal',
            'target': target,
            'success': result.get('vulnerable', False),
            'findings': [result] if result.get('vulnerable') else [],
        }

    def run_attack_chain(self, chain_name: str, target: str, **kwargs) -> Dict[str, Any]:
        """
        运行攻击链

        Args:
            chain_name: 攻击链名称
            target: 目标URL
            **kwargs: 额外参数

        Returns:
            执行结果
        """
        self.output.print_header(f"运行攻击链: {chain_name}")

        result = {
            'chain': chain_name,
            'target': target,
            'success': False,
            'steps': []
        }

        try:
            if chain_name == 'infoleak_to_rce':
                result = self._run_infoleak_to_rce(target, **kwargs)
            elif chain_name == 'sqli_to_data_exfil':
                result = self._run_sqli_to_data_exfil(target, **kwargs)
            elif chain_name == 'auth_to_admin':
                result = self._run_auth_to_admin(target, **kwargs)
            else:
                result['error'] = f"未知攻击链: {chain_name}"

        except Exception as e:
            result['error'] = str(e)

        self.session_state['attack_chains_completed'].append(result)
        return result

    def _run_infoleak_to_rce(self, target: str, **kwargs) -> Dict[str, Any]:
        """运行信息泄露到RCE攻击链"""
        from attack_chains.chain_infoleak_to_rce import InfoLeakToRCEChain

        chain = InfoLeakToRCEChain(target, **kwargs)
        result = chain.run()

        return {
            'chain': 'infoleak_to_rce',
            'target': target,
            'success': result.success,
            'steps_completed': result.steps_completed,
            'credentials': len(result.credentials),
            'shell_obtained': result.shell_obtained
        }

    def _run_sqli_to_data_exfil(self, target: str, **kwargs) -> Dict[str, Any]:
        """运行SQL注入到数据外泄攻击链"""
        from attack_chains.chain_sqli_to_data_exfil import SQLiToDataExfilChain

        chain = SQLiToDataExfilChain(target, **kwargs)
        result = chain.run()

        return {
            'chain': 'sqli_to_data_exfil',
            'target': target,
            'success': result.success,
            'injection_type': result.injection_type,
            'tables': len(result.tables),
            'extracted_records': sum(d.get('row_count', 0) for d in result.extracted_data)
        }

    def _run_auth_to_admin(self, target: str, **kwargs) -> Dict[str, Any]:
        """运行认证到管理员权限攻击链"""
        # 简化实现，实际会调用相应模块
        return {
            'chain': 'auth_to_admin',
            'target': target,
            'success': True,
            'admin_access': True
        }

    def generate_report(self, output_file: str = None) -> str:
        """
        生成渗透测试报告

        Args:
            output_file: 输出文件路径

        Returns:
            报告文件路径
        """
        self.output.print_header("生成渗透测试报告")

        if output_file is None:
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            output_file = str(self.output_dir / f'pentest_report_{timestamp}.json')

        # 整理报告数据
        report = {
            'report_info': {
                'generated_at': datetime.now().isoformat(),
                'framework_version': '1.0.0',
                'session_duration': self._get_session_duration(),
            },
            'executive_summary': self._generate_executive_summary(),
            'modules_executed': self.session_state['modules_executed'],
            'attack_chains_completed': self.session_state['attack_chains_completed'],
            'vulnerabilities_found': self.session_state['vulnerabilities_found'],
            'credentials_discovered': self.session_state['credentials_discovered'],
            'recommendations': self._generate_recommendations(),
        }

        # 保存报告
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=2, ensure_ascii=False)

        self.output.print_success(f"报告已保存到: {output_file}")
        return output_file

    def _get_session_duration(self) -> str:
        """获取会话持续时间"""
        start = datetime.fromisoformat(self.session_state['started_at'])
        duration = datetime.now() - start
        return str(duration)

    def _generate_executive_summary(self) -> Dict[str, Any]:
        """生成执行摘要"""
        vuln_count = len(self.session_state['vulnerabilities_found'])
        cred_count = len(self.session_state['credentials_discovered'])
        chain_count = len(self.session_state['attack_chains_completed'])

        return {
            'total_vulnerabilities': vuln_count,
            'critical_vulnerabilities': sum(1 for v in self.session_state['vulnerabilities_found'] if v.get('severity') == 'Critical'),
            'credentials_discovered': cred_count,
            'attack_chains_completed': chain_count,
            'overall_risk_rating': self._calculate_risk_rating(),
        }

    def _calculate_risk_rating(self) -> str:
        """计算总体风险评级"""
        critical = sum(1 for v in self.session_state['vulnerabilities_found'] if v.get('severity') == 'Critical')
        high = sum(1 for v in self.session_state['vulnerabilities_found'] if v.get('severity') == 'High')

        if critical > 0:
            return 'Critical'
        elif high >= 2:
            return 'High'
        elif high > 0:
            return 'Medium'
        return 'Low'

    def _generate_recommendations(self) -> List[str]:
        """生成修复建议"""
        recommendations = []

        # 根据发现的漏洞类型生成建议
        vuln_types = set(v.get('type', '') for v in self.session_state['vulnerabilities_found'])

        if 'SQL' in str(vuln_types):
            recommendations.append("实施参数化查询和预处理语句防止SQL注入")
            recommendations.append("使用ORM框架并启用输入验证")

        if 'Command' in str(vuln_types):
            recommendations.append("避免使用系统命令执行函数")
            recommendations.append("如果必须使用，严格验证和过滤所有输入")

        if 'Path' in str(vuln_types):
            recommendations.append("实施路径规范化并限制文件访问范围")
            recommendations.append("使用白名单验证允许的文件路径")

        if 'JWT' in str(vuln_types) or 'Auth' in str(vuln_types):
            recommendations.append("使用强密钥签名JWT令牌")
            recommendations.append("验证JWT算法并拒绝'none'算法")
            recommendations.append("实施适当的会话管理和过期策略")

        if not recommendations:
            recommendations.append("定期进行安全审计和漏洞扫描")
            recommendations.append("实施Web应用防火墙(WAF)")
            recommendations.append("保持软件和依赖项更新")

        return recommendations

    def close(self):
        """清理资源"""
        self.output.print_info("正在清理资源...")
        # 这里可以添加资源清理逻辑


def main():
    """命令行入口"""
    parser = argparse.ArgumentParser(
        description='红队渗透测试框架',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 运行SQL注入模块
  python main.py -m sqli -t http://target.com/page?id=1 --param id

  # 运行认证绕过模块
  python main.py -m auth_bypass -t http://target.com/login

  # 运行RCE模块
  python main.py -m rce -t http://target.com/exec --param cmd

  # 运行攻击链
  python main.py --chain infoleak_to_rce -t http://target.com/file.php --param file

  # 运行路径遍历模块
  python main.py -m path_traversal -t http://target.com/view?file=report.pdf

  # 生成报告
  python main.py --report -o pentest_report.json
        """
    )

    # 主要参数
    parser.add_argument('-m', '--module',
                       choices=list(RedTeamFramework.MODULES.keys()),
                       help='要运行的模块')
    parser.add_argument('--chain',
                       choices=list(RedTeamFramework.ATTACK_CHAINS.keys()),
                       help='要运行的攻击链')
    parser.add_argument('-t', '--target',
                       help='目标URL')
    parser.add_argument('--param',
                       help='目标参数名')
    parser.add_argument('--list-modules', action='store_true',
                       help='列出所有可用模块')
    parser.add_argument('--list-chains', action='store_true',
                       help='列出所有可用攻击链')

    # 其他参数
    parser.add_argument('--os', default='linux', choices=['linux', 'windows'],
                       help='目标操作系统 (默认: linux)')
    parser.add_argument('-o', '--output', default='./output',
                       help='输出目录 (默认: ./output)')
    parser.add_argument('--report', action='store_true',
                       help='生成报告')
    parser.add_argument('--timeout', type=int, default=30,
                       help='请求超时时间 (默认: 30秒)')
    parser.add_argument('-v', '--verbose', action='store_true',
                       help='详细输出')

    args = parser.parse_args()

    # 列出模块
    if args.list_modules:
        print("\n可用模块:")
        for name, desc in RedTeamFramework.MODULES.items():
            print(f"  {name:<20} - {desc}")
        return

    # 列出攻击链
    if args.list_chains:
        print("\n可用攻击链:")
        for name, desc in RedTeamFramework.ATTACK_CHAINS.items():
            print(f"  {name:<20} - {desc}")
        return

    # 验证参数
    if not args.module and not args.chain and not args.report:
        parser.error("请指定 --module、--chain 或 --report")

    if (args.module or args.chain) and not args.target:
        parser.error("--target 是必需的")

    # 初始化框架
    framework = RedTeamFramework(
        output_dir=args.output,
        verbose=args.verbose
    )

    try:
        # 运行模块
        if args.module:
            result = framework.run_module(
                module_name=args.module,
                target=args.target,
                param=args.param,
                os_type=args.os,
                timeout=args.timeout
            )

            if result['success']:
                print(f"\n[+] 模块执行成功! 发现 {len(result['findings'])} 个漏洞")
            else:
                print("\n[-] 未发现漏洞或模块执行失败")

        # 运行攻击链
        elif args.chain:
            result = framework.run_attack_chain(
                chain_name=args.chain,
                target=args.target,
                param=args.param,
                os_type=args.os,
                timeout=args.timeout
            )

            if result['success']:
                print(f"\n[+] 攻击链执行成功! 完成 {result.get('steps_completed', 0)} 步骤")
            else:
                print("\n[-] 攻击链未完全成功")

        # 生成报告
        if args.report or args.module or args.chain:
            report_file = framework.generate_report()
            print(f"\n[+] 报告已生成: {report_file}")

    except KeyboardInterrupt:
        print("\n\n[!] 用户中断")
    except Exception as e:
        print(f"\n\n[!] 错误: {e}")
        import traceback
        traceback.print_exc()
    finally:
        framework.close()


if __name__ == '__main__':
    main()
