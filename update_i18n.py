import re
import json
import os

path = 'x:/want/fsce/frontend/src/services/api.ts'
zh_path = 'x:/want/fsce/frontend/src/locales/zh.json'
en_path = 'x:/want/fsce/frontend/src/locales/en.json'

with open(zh_path, 'r', encoding='utf-8') as f: zh = json.load(f)
with open(en_path, 'r', encoding='utf-8') as f: en = json.load(f)
with open(path, 'r', encoding='utf-8') as f: content = f.read()

if 'import i18n' not in content:
    content = 'import i18n from \'../i18n\';\n' + content

if 'api' not in zh: zh['api'] = {}
if 'api' not in en: en['api'] = {}

matches = re.finditer(r"Error\(\s*'([^']+)'\s*\)", content)
for m in matches:
    original = m.group(1)
    if original.startswith('FG-'): continue
    key = original.lower().replace(' ', '_').replace(':', '')
    zh['api'][key] = original.replace('Failed to fetch', '获取数据失败:').replace('Failed to', '操作失败:').replace('Fetch failed', '请求响应失败')
    en['api'][key] = original
    content = content.replace(f"Error('{original}')", f"Error(i18n.t('api.{key}'))")

with open(zh_path, 'w', encoding='utf-8') as f: json.dump(zh, f, indent=4, ensure_ascii=False)
with open(en_path, 'w', encoding='utf-8') as f: json.dump(en, f, indent=4, ensure_ascii=False)
with open(path, 'w', encoding='utf-8') as f: f.write(content)

print('api.ts and i18n updated successfully')
