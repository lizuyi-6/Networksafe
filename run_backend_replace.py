import os
import re
import json

backend_dir = 'x:/want/fsce/backend/src'
zh_path = 'x:/want/fsce/frontend/src/locales/zh.json'
en_path = 'x:/want/fsce/frontend/src/locales/en.json'

with open(zh_path, 'r', encoding='utf-8') as f: zh = json.load(f)
with open(en_path, 'r', encoding='utf-8') as f: en = json.load(f)

if 'backend' not in zh: zh['backend'] = {}
if 'backend' not in en: en['backend'] = {}

def sluggify(text):
    text = text.lower()
    text = re.sub(r'[^a-z0-9]+', '_', text)
    return text.strip('_')

for root, _, files in os.walk(backend_dir):
    for file in files:
        if not file.endswith('.ts'): continue
        filepath = os.path.join(root, file)
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()

        original_content = content
        
        matches = re.finditer(r'(error|message)\s*:\s*([\'\"])(.*?)\2', content)
        replacements = []
        for m in matches:
            key_type = m.group(1)
            quote = m.group(2)
            msg = m.group(3)
            
            if not msg or len(msg) < 3 or msg.startswith('FG-') or msg.startswith('backend.'):
                continue
                
            slug = sluggify(msg)
            if not slug: continue
            
            zh['backend'][slug] = msg 
            en['backend'][slug] = msg
            
            old_str = f"{key_type}: {quote}{msg}{quote}"
            new_str = f"{key_type}: {quote}backend.{slug}{quote}"
            replacements.append((old_str, new_str))
            
        for old_str, new_str in set(replacements):
            content = content.replace(old_str, new_str)
            
        matches2 = re.finditer(r'next\(new Error\(([\'\"])(.*?)\1\)\)', content)
        replacements2 = []
        for m in matches2:
            quote = m.group(1)
            msg = m.group(2)
            
            if not msg or len(msg) < 3 or msg.startswith('FG-') or msg.startswith('backend.'):
                continue
                
            slug = sluggify(msg)
            if not slug: continue
            
            zh['backend'][slug] = msg
            en['backend'][slug] = msg
            
            old_str = f"next(new Error({quote}{msg}{quote}))"
            new_str = f"next(new Error({quote}backend.{slug}{quote}))"
            replacements2.append((old_str, new_str))

        for old_str, new_str in set(replacements2):
            content = content.replace(old_str, new_str)

        if content != original_content:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f'Updated {file}')

with open(zh_path, 'w', encoding='utf-8') as f: json.dump(zh, f, indent=4, ensure_ascii=False)
with open(en_path, 'w', encoding='utf-8') as f: json.dump(en, f, indent=4, ensure_ascii=False)

print('Backend constant mapping completed.')
