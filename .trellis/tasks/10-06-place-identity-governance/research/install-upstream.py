"""按原文件哈希校验安装实体治理补丁；默认预览，应用前保存原文件。"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import subprocess
import sys
sys.stdout.reconfigure(encoding='utf-8')

root = Path(__file__).resolve().parent
upstream = Path('D:/Project/xhs-travel-pipeline').resolve()
ap = argparse.ArgumentParser()
ap.add_argument('--apply', action='store_true')
args = ap.parse_args()
base = json.loads((root/'upstream-base.json').read_text())
installed = json.loads((root/'upstream-install.json').read_text()) if (root/'upstream-install.json').exists() else {}
previous = {p['path']:p['after'] for p in installed.get('files', [])} if installed.get('apply') else {}
plans = []
for file in sorted(p for p in (root/'upstream').rglob('*') if p.is_file() and p.suffix in {'.py', '.ps1'}):
    name = file.relative_to(root/'upstream').as_posix()
    target = (upstream/name).resolve()
    if not target.is_relative_to(upstream) or name.split('/')[0] not in ['app', 'scripts', 'tests']:
        raise RuntimeError('目标路径超出补丁范围')
    content = file.read_bytes()
    if file.suffix == '.py':
        compile(content, name, 'exec')
    else:
        parsed = subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-Command',
            '$parseTokens=$null; $parseErrors=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('
            '$env:IDENTITY_PATCH_PS_PATH,[ref]$parseTokens,[ref]$parseErrors); '
            'if ($parseErrors) { $parseErrors | ForEach-Object { $_.Message }; exit 1 }'],
            env={**os.environ, 'IDENTITY_PATCH_PS_PATH': str(file.resolve())}, capture_output=True, text=True)
        if parsed.returncode:
            raise RuntimeError(f'PowerShell补丁语法错误：{name}: {parsed.stdout} {parsed.stderr}')
    digest = hashlib.sha256(content).hexdigest()
    before = hashlib.sha256(target.read_bytes()).hexdigest() if target.exists() else None
    if before not in [base.get(name), previous.get(name), digest]:
        raise RuntimeError(f'上游文件有并发修改，拒绝覆盖：{name}')
    plans.append({'path':name, 'before': before, 'after':digest, 'changed':before != digest})
for plan in plans:
    if not args.apply or not plan['changed']:
        continue
    name = plan['path']
    target = upstream/name
    backup = root/'upstream-backup'/name
    if target.exists() and not backup.exists():
        backup.parent.mkdir(parents=True,exist_ok=True)
        backup.write_bytes(target.read_bytes())
    if target.exists():
        revision_backup = root/'upstream-install-backups'/plan['before']/name
        revision_backup.parent.mkdir(parents=True, exist_ok=True)
        if not revision_backup.exists():
            revision_backup.write_bytes(target.read_bytes())
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_bytes((root/'upstream'/name).read_bytes())
(root/('upstream-install.json' if args.apply else 'upstream-install-preview.json')).write_text(
    json.dumps({'apply':args.apply,'files':plans},indent=2),encoding='utf-8')
print(json.dumps({'apply': args.apply, 'files': len(plans), 'changed':sum(p['changed'] for p in plans),
                  'paths':[p['path'] for p in plans if p['changed']]}, ensure_ascii=False,indent=2))
