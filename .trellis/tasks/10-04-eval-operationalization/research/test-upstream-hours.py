"""在工作区暂存代码上运行上游纯函数测试，不修改上游或生产数据。"""
from pathlib import Path
import importlib.util
import sys
import pytest

root = Path(__file__).resolve().parent / 'upstream'
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
spec = importlib.util.spec_from_file_location('app.clean.hours', root / 'app/clean/hours.py')
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
raise SystemExit(pytest.main([str(root / 'tests/test_hours.py'), str(root / 'tests/test_hours_attribution.py'), '-q', '-p', 'no:cacheprovider']))
