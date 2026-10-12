"""离线验证地图探针不输出请求凭据，限流时保存已经收到的结果。"""
import asyncio, contextlib, importlib.util, io, json, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch
sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
import httpx
spec = importlib.util.spec_from_file_location('map_probe', Path(__file__).with_name('probe-shangbu-geo.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class SafetyTests(unittest.TestCase):
    def test_partial_results_and_http_error_omit_request(self):
        sentinel = 'offline-secret-sentinel'
        request = httpx.Request('GET', 'https://example.invalid/search?tk=' + sentinel)
        error = httpx.HTTPStatusError('request=' + str(request.url), request=request, response=httpx.Response(429, request=request))
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'results.json'
            capture = io.StringIO()
            responses = [{'pois': [{'name': '甲店', 'address': '示例街', 'lonlat': '117,36'}]}, error]
            with patch.object(module, '__file__', str(Path(directory) / 'probe.py')), \
                 patch.object(module, '_city_center_wgs', AsyncMock(return_value=[117,36])), \
                 patch.object(module, '_tianditu_get', AsyncMock(side_effect=responses)), \
                 patch.object(sys, 'argv', ['probe.py','--names','甲店','乙店','--out','results.json']), \
                 contextlib.redirect_stdout(capture):
                self.assertEqual(asyncio.run(module.main()), 1)
            data = json.loads(output.read_text(encoding='utf-8'))
            self.assertEqual(data[0]['name'], '甲店')
            self.assertEqual(data[1]['error'], {'type':'HTTPStatusError','statusCode':429})
            self.assertNotIn(sentinel, output.read_text(encoding='utf-8') + capture.getvalue())
            self.assertNotIn('example.invalid', capture.getvalue())

    def test_rotation_gate_blocks_before_network(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / 'map-credential-rotation-required.json').write_text('{"status":"rotation_required"}', encoding='utf-8')
            network = AsyncMock()
            with patch.object(module, '__file__', str(Path(directory) / 'probe.py')), \
                 patch.object(module, '_city_center_wgs', network), \
                 patch.object(sys, 'argv', ['probe.py','--names','甲店','--out','results.json']):
                with self.assertRaisesRegex(RuntimeError, '凭据待轮换'):
                    asyncio.run(module.main())
                network.assert_not_called()

if __name__ == '__main__':
    unittest.main()
