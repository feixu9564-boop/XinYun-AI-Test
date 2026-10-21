from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

WEB = Path(__file__).resolve().parent.parent / 'web'
app = FastAPI(title='XinYun AI Research', docs_url=None, redoc_url=None)

@app.middleware('http')
async def privacy_headers(request, call_next):
    response = await call_next(request)
    response.headers['Permissions-Policy'] = 'camera=(self), microphone=()'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Content-Security-Policy'] = (
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'; "
        "style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; "
        "connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'"
    )
    return response

@app.get('/api/health')
def health():
    return {'status': 'ok', 'processing': 'browser-local',
            'model_assets': (WEB / 'vendor/face_mesh/face_mesh.js').exists()}

@app.get('/')
def index():
    return FileResponse(WEB / 'index.html')

app.mount('/static', StaticFiles(directory=WEB), name='static')
