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

# Simple line-by-line regexes without complex backtracking
re_msg = re.compile(r"(error|message)\s*:\s*(['\"])(.*?)\2")
re_err = re.compile(r"next\(new Error\((['\"])(.*?)\1\)\)")

for root, _, files in os.walk(backend_dir):
    for file in files:
        if not file.endswith('.ts'): continue
        filepath = os.path.join(root, file)
        with open(filepath, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        changed = False
        for i, line in enumerate(lines):
            # 1. match error: '...'
            for m in re_msg.finditer(line):
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
                lines[i] = lines[i].replace(old_str, new_str)
                changed = True
                
            # 2. match next(new Error('...'))
            for m in re_err.finditer(line):
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
                lines[i] = lines[i].replace(old_str, new_str)
                changed = True

        if changed:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.writelines(lines)
            print(f'Updated {file}')

with open(zh_path, 'w', encoding='utf-8') as f: json.dump(zh, f, indent=4, ensure_ascii=False)
with open(en_path, 'w', encoding='utf-8') as f: json.dump(en, f, indent=4, ensure_ascii=False)

print('Backend constant mapping completed.')
