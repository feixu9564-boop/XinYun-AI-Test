from fastapi.testclient import TestClient
from backend.main import app
client = TestClient(app)
def test_health():
    r = client.get('/api/health')
    assert r.status_code == 200
    assert r.json()['processing'] == 'browser-local'
def test_ui_and_privacy():
    r = client.get('/')
    assert '仅供研究参考，不用于医疗诊断' in r.text
    assert "connect-src 'self'" in r.headers['content-security-policy']
    assert client.post('/api/video', content=b'video').status_code == 404
def test_assets():
    for path in ['app.js', 'signal.js', 'style.css', 'vendor/face_mesh/face_mesh.js', 'vendor/face_mesh/face_mesh_solution_packed_assets.data', 'vendor/face_mesh/face_mesh_solution_simd_wasm_bin.wasm']:
        assert client.get('/static/' + path).status_code == 200, path
