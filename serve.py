from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).parent

class DashboardHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        route = path.split('?', 1)[0]
        if route in ('/', '/index.html'):
            route = '/html/index.html'
        elif route == '/analysis.html':
            route = '/html/analysis.html'
        return str(ROOT / route.lstrip('/'))

server = ThreadingHTTPServer(('localhost', 8081), DashboardHandler)
print('Dashboard: http://localhost:8081/')
server.serve_forever()
