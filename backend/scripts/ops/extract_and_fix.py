import zipfile, os, shutil, glob

zf = zipfile.ZipFile('../backend_dist.zip', 'r')
zf.extractall('.')
zf.close()

paths = glob.glob('**/*\\*', recursive=True)
for p in paths:
    if os.path.isfile(p):
        fixed = p.replace('\\', '/')
        os.makedirs(os.path.dirname(fixed), exist_ok=True)
        shutil.move(p, fixed)
        print(f'MOVED: {p} -> {fixed}')