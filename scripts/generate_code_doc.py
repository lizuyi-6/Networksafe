import os

def is_code_file(filename):
    valid_extensions = ['.ts', '.tsx', '.js', '.py', '.java', '.c', '.cpp', '.h']
    return any(filename.endswith(ext) for ext in valid_extensions) and not filename.endswith('.d.ts') and not filename.endswith('.spec.ts') and not filename.endswith('.test.ts')

def remove_empty_lines(content):
    lines = content.splitlines()
    non_empty_lines = [line for line in lines if line.strip()]
    return "\n".join(non_empty_lines)

def generate_code_doc(root_dirs, output_file, target_lines=3500):
    current_lines = 0
    with open(output_file, 'w', encoding='utf-8') as outfile:
        for root_dir in root_dirs:
            for root, dirs, files in os.walk(root_dir):
                if 'node_modules' in root or '.git' in root:
                    continue
                
                for file in files:
                    if is_code_file(file):
                        file_path = os.path.join(root, file)
                        try:
                            with open(file_path, 'r', encoding='utf-8') as infile:
                                content = infile.read()
                                cleaned_content = remove_empty_lines(content)
                                line_count = len(cleaned_content.splitlines())
                                
                                if current_lines >= target_lines:
                                    print(f"Reached target line count: {current_lines}")
                                    return

                                outfile.write(f"// File: {file}\n")
                                outfile.write(cleaned_content)
                                outfile.write("\n") # Just one newline between files
                                current_lines += line_count + 1 # +1 for header
                                print(f"Added {file} ({line_count} lines). Total: {current_lines}")
                                
                        except Exception as e:
                            print(f"Error reading {file_path}: {e}")

root_dirs = [
    r'c:\Users\Abraham\Desktop\api-security-middleware\backend\src',
    r'c:\Users\Abraham\Desktop\api-security-middleware\frontend\src',
    r'c:\Users\Abraham\Desktop\api-security-middleware\esp32'
]
output_file = r'c:\Users\Abraham\Desktop\api-security-middleware\docs\源代码_60页.txt'

if not os.path.exists(os.path.dirname(output_file)):
    os.makedirs(os.path.dirname(output_file))

generate_code_doc(root_dirs, output_file)
print(f"Generated code document at {output_file}")
