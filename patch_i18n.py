import os
import re
import json

src_dir = 'x:/want/fsce/frontend/src'
zh_path = 'x:/want/fsce/frontend/src/locales/zh.json'
en_path = 'x:/want/fsce/frontend/src/locales/en.json'

with open(zh_path, 'r', encoding='utf-8') as f: zh = json.load(f)
with open(en_path, 'r', encoding='utf-8') as f: en = json.load(f)

# find all t('...')
pattern = re.compile(r"t\(['\"]([\w_]+(?:\.[\w_]+)+)['\"](?:,|\))")
keys_found = set()

for root, _, files in os.walk(src_dir):
    for file in files:
        if not (file.endswith('.ts') or file.endswith('.tsx')): continue
        filepath = os.path.join(root, file)
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
            for match in pattern.finditer(content):
                keys_found.add(match.group(1))

# update dicts
added = 0
for k in keys_found:
    parts = k.split('.')
    domain = parts[0]
    subkey = parts[1]
    
    if domain not in zh: zh[domain] = {}
    if domain not in en: en[domain] = {}
    
    if type(zh[domain]) is dict and subkey not in zh[domain]:
        zh[domain][subkey] = k  # default to key name itself for now, but capitalize it nicely
        en[domain][subkey] = subkey.replace('_', ' ').title()
        added += 1

# Provide some basic translations for the known missing ones based on context
basic_zh = {
    'sites': {'title': '站点管理', 'no_sites': '暂无站点', 'add_site': '添加站点', 'domain': '域名', 'target': '目标'},
    'scanner': {'title': '漏洞扫描器'},
    'settings': {'title': '系统设置', 'general': '通用设置', 'security': '安全设置', 'save': '保存配置'},
    'admin': {'api_keys_title': 'API 密钥管理', 'generate_key': '生成新密钥', 'revoke': '撤销', 'active_agents': '活跃节点', 'avg_latency': '平均延迟'},
    'alerts': {'title': '系统警报', 'subtitle': '查看和管理所有拦截事件', 'no_alerts': '暂无警报', 'level': '警报等级'}
}

for d, subs in basic_zh.items():
    if d not in zh: zh[d] = {}
    if type(zh[d]) is dict:
        for sk, val in subs.items():
            zh[d][sk] = val

with open(zh_path, 'w', encoding='utf-8') as f: json.dump(zh, f, indent=4, ensure_ascii=False)
with open(en_path, 'w', encoding='utf-8') as f: json.dump(en, f, indent=4, ensure_ascii=False)

print(f"Patched {added} keys successfully.")
