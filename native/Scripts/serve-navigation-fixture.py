#!/usr/bin/env python3
# Created by Cory McCabe
"""Read-only loopback workspace for testNumberedNavigationShortcuts."""
import json
import time
from datetime import date
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

SERVER = "http://127.0.0.1:4397"
SESSION = {
    "accessToken": "fictional-navigation-token",
    "refreshToken": "fictional-refresh",
    "expiresAt": (time.time() + 86400) * 1000,
    "ownerId": "navigation-test",
    "sessionId": "navigation-test",
}
WORKSPACE = {
    "projects": [{
        "id": "navigation-project", "name": "Navigation Studio",
        "aliases": [], "description": "Shortcut test project", "color": "#4465FF",
    }],
    "tasks": [], "busy": [], "blocks": [], "warnings": [],
    "settings": {
        "timeZone": "America/Chicago", "workStart": "09:00", "workEnd": "17:00",
        "workDays": [1, 2, 3, 4, 5], "maxBlockMinutes": 90,
        "breakEveryMinutes": 90, "breakMinutes": 15,
    },
    "plannedAt": None, "currentDate": date.today().isoformat(), "revision": 1,
}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        ok = self.path == "/api/native/workspace"
        payload = WORKSPACE if ok else {"error": "Unavailable in read-only fixture"}
        self.send_response(200 if ok else 404)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode())

    def do_POST(self):
        self.send_response(405)
        self.end_headers()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", 4397), Handler)
    Path("/tmp/ft-macos-navigation-fixture.json").write_text(
        json.dumps({"server": SERVER, "session": SESSION})
    )
    print(f"Read-only navigation fixture: {SERVER}", flush=True)
    server.serve_forever()
