"""NadiTwin demo server — pure standard library (http.server), multi-river.

Endpoints (all JSON unless noted). Every GET/POST endpoint below (except
`/` and `/api/rivers`) accepts an optional `?river=<name>` query param to
pick which river's engine to use (defaults to the first configured
river). `<name>` must match one of the `name` values returned by
`/api/rivers`.

  GET /                     -> dashboard (HTML)
  GET /api/rivers           -> list of loaded rivers [{name, reach_km}]
  GET /api/meta             -> reach geometry, assets, disclaimer, sim clock
  GET /api/state            -> current WSE profile + discharge
  GET /api/forecast/profile?lead=24
  GET /api/hydrograph?cell=520
  GET /api/margins          -> margin-to-threshold board
  GET /api/alerts           -> active alerts
  GET /api/scorecard        -> hindcast-scored metrics (synthetic)
  POST /api/advance?hours=6 -> advance the simulation clock
"""

import json
import os
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

from .engine import TwinEngine, RIVER_CONFIGS, DEFAULT_RIVER

STATIC = os.path.join(os.path.dirname(__file__), "static")

ENGINES = {}  # river display name -> TwinEngine, filled in serve()


def _pick_engine(q):
    name = q.get("river", [DEFAULT_RIVER])[0]
    return ENGINES.get(name, ENGINES[DEFAULT_RIVER])


class Handler(BaseHTTPRequestHandler):

    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        try:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def handle_error(self, request, client_address):
        if isinstance(sys.exc_info()[1], (BrokenPipeError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)

    def log_message(self, fmt, *args):  # quieter console
        pass

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        try:
            if u.path in ("/", "/index.html", "/dashboard"):
                with open(os.path.join(STATIC, "dashboard.html"), "rb") as f:
                    return self._send(200, f.read(), "text/html; charset=utf-8")

            if u.path == "/api/rivers":
                return self._send(200, [
                    {"name": name, "reach_km": eng.meta()["reach_km"]}
                    for name, eng in ENGINES.items()
                ])

            engine = _pick_engine(q)

            if u.path == "/api/meta":
                return self._send(200, engine.meta())
            if u.path == "/api/state":
                return self._send(200, engine.state_now())
            if u.path == "/api/forecast/profile":
                lead = int(q.get("lead", ["24"])[0])
                return self._send(200, engine.forecast_profile(lead))
            if u.path == "/api/hydrograph":
                n_cells = engine.river.n_cells
                cell = int(q.get("cell", [str(n_cells // 2)])[0])
                cell = max(0, min(n_cells - 1, cell))
                return self._send(200, {
                    "cell": cell,
                    "observed": engine.observed_hydrograph(cell),
                    "forecast": engine.forecast_hydrograph(cell),
                })
            if u.path == "/api/margins":
                return self._send(200, engine.margins())
            if u.path == "/api/alerts":
                return self._send(200, engine.alerts())
            if u.path == "/api/scorecard":
                return self._send(200, engine.scorecard())
            return self._send(404, {"error": "not found"})

        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            return self._send(500, {"error": str(e)})

    def do_POST(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        try:
            if u.path == "/api/advance":
                engine = _pick_engine(q)
                hours = int(q.get("hours", ["6"])[0])
                return self._send(200, engine.advance(hours))
            return self._send(404, {"error": "not found"})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            return self._send(500, {"error": str(e)})


def serve(port=8080, seed=42, gauge_csv=None):
    global ENGINES
    ENGINES = {
        name: TwinEngine(river, seed=seed, gauge_csv=gauge_csv)
        for name, river in RIVER_CONFIGS.items()
    }
    httpd = HTTPServer(("0.0.0.0", port), Handler)
    print(f"NadiTwin demo running at http://localhost:{port}  (Ctrl+C to stop)")
    print("Rivers loaded:", ", ".join(ENGINES.keys()))
    print("SYNTHETIC DEMONSTRATION DATA — not for real decisions.")
    httpd.serve_forever()
