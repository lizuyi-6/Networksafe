#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
请求辅助工具模块
用于红队渗透测试框架
⚠️ 仅用于授权渗透测试 ⚠️
"""

import requests
import urllib3
from typing import Dict, Any, Optional, Tuple
import json
import time

# 禁用SSL警告（仅在测试环境）
urllib3.disable_warnings(urllib3.exceptions.InsecurityRequestWarning)


class RequestHelper:
    """HTTP请求辅助类"""

    def __init__(self, timeout: int = 10, verify_ssl: bool = False,
                 user_agent: str = None, proxies: Dict = None):
        """
        初始化请求配置

        Args:
            timeout: 请求超时时间
            verify_ssl: 是否验证SSL证书
            user_agent: 自定义User-Agent
            proxies: 代理配置
        """
        self.timeout = timeout
        self.verify_ssl = verify_ssl
        self.session = requests.Session()

        # 默认headers
        default_headers = {
            'User-Agent': user_agent or 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': '*/*',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'Connection': 'keep-alive',
        }
        self.session.headers.update(default_headers)

        if proxies:
            self.session.proxies.update(proxies)

    def get(self, url: str, params: Dict = None, headers: Dict = None,
            cookies: Dict = None, allow_redirects: bool = True) -> requests.Response:
        """发送GET请求"""
        try:
            response = self.session.get(
                url,
                params=params,
                headers=headers,
                cookies=cookies,
                verify=self.verify_ssl,
                timeout=self.timeout,
                allow_redirects=allow_redirects
            )
            return response
        except requests.RequestException as e:
            raise Exception(f"GET请求失败: {e}")

    def post(self, url: str, data: Dict = None, json: Dict = None,
             headers: Dict = None, cookies: Dict = None,
             files: Dict = None, allow_redirects: bool = True) -> requests.Response:
        """发送POST请求"""
        try:
            response = self.session.post(
                url,
                data=data,
                json=json,
                headers=headers,
                cookies=cookies,
                files=files,
                verify=self.verify_ssl,
                timeout=self.timeout,
                allow_redirects=allow_redirects
            )
            return response
        except requests.RequestException as e:
            raise Exception(f"POST请求失败: {e}")

    def put(self, url: str, data: Dict = None, json: Dict = None,
            headers: Dict = None) -> requests.Response:
        """发送PUT请求"""
        try:
            response = self.session.put(
                url,
                data=data,
                json=json,
                headers=headers,
                verify=self.verify_ssl,
                timeout=self.timeout
            )
            return response
        except requests.RequestException as e:
            raise Exception(f"PUT请求失败: {e}")

    def delete(self, url: str, headers: Dict = None) -> requests.Response:
        """发送DELETE请求"""
        try:
            response = self.session.delete(
                url,
                headers=headers,
                verify=self.verify_ssl,
                timeout=self.timeout
            )
            return response
        except requests.RequestException as e:
            raise Exception(f"DELETE请求失败: {e}")

    def check_status_code(self, response: requests.Response,
                          expected: int = 200) -> bool:
        """检查状态码"""
        return response.status_code == expected

    def extract_cookies(self, response: requests.Response) -> Dict[str, str]:
        """提取响应中的cookies"""
        return {cookie.name: cookie.value for cookie in self.session.cookies}

    def get_response_time(self, response: requests.Response) -> float:
        """获取响应时间（秒）"""
        return response.elapsed.total_seconds()

    def close(self):
        """关闭session"""
        self.session.close()


class TimingHelper:
    """时间盲注辅助类"""

    @staticmethod
    def measure_delay(func, *args, **kwargs) -> Tuple[Any, float]:
        """
        测量函数执行时间

        Args:
            func: 要测量的函数
            *args: 函数参数
            **kwargs: 函数关键字参数

        Returns:
            (结果, 执行时间秒数)
        """
        start_time = time.time()
        result = func(*args, **kwargs)
        elapsed = time.time() - start_time
        return result, elapsed

    @staticmethod
    def is_delayed(elapsed: float, threshold: float = 2.0) -> bool:
        """
        判断是否延迟

        Args:
            elapsed: 执行时间
            threshold: 延迟阈值

        Returns:
            是否超过阈值
        """
        return elapsed >= threshold


class FingerprintHelper:
    """服务指纹识别辅助类"""

    COMMON_HEADERS = {
        'Server': 'server',
        'X-Powered-By': 'framework',
        'X-AspNet-Version': 'aspnet',
        'X-AspNetMvc-Version': 'aspnetmvc',
    }

    @staticmethod
    def identify_technology(headers: Dict[str, str]) -> Dict[str, str]:
        """
        根据响应头识别技术栈

        Args:
            headers: HTTP响应头

        Returns:
            识别结果字典
        """
        result = {}

        for header, tech in FingerprintHelper.COMMON_HEADERS.items():
            if header in headers:
                result[tech] = headers[header]

        # 服务器特定识别
        server = headers.get('Server', '')
        if 'nginx' in server.lower():
            result['server_type'] = 'nginx'
        elif 'apache' in server.lower():
            result['server_type'] = 'apache'
        elif 'iis' in server.lower():
            result['server_type'] = 'iis'

        return result

    @staticmethod
    def identify_framework(headers: Dict[str, str], body: str = "") -> Dict[str, str]:
        """
        识别Web框架

        Args:
            headers: HTTP响应头
            body: 响应体

        Returns:
            框架信息
        """
        result = {}

        # 通过头识别
        if 'X-Powered-By' in headers:
            result['powered_by'] = headers['X-Powered-By']

        # 通过cookies识别
        set_cookie = headers.get('Set-Cookie', '')
        if 'JSESSIONID' in set_cookie:
            result['framework'] = 'Java (JSP)'
        elif 'PHPSESSID' in set_cookie:
            result['framework'] = 'PHP'
        elif 'ASPSESSIONID' in set_cookie or '.ASPXAUTH' in set_cookie:
            result['framework'] = 'ASP.NET'

        # 通过响应体识别
        if body:
            body_lower = body.lower()
            if 'wordpress' in body_lower:
                result['cms'] = 'WordPress'
            elif 'drupal' in body_lower:
                result['cms'] = 'Drupal'
            elif 'joomla' in body_lower:
                result['cms'] = 'Joomla'

        return result
