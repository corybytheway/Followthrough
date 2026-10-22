#!/usr/bin/env python3
# Created by Cory McCabe
"""Fictional loopback data and request audit for macOS page-state tests."""
import argparse
import json
import runpy
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from zoneinfo import ZoneInfo


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=4519)
    args = parser.parse_args()
    base = runpy.run_path(str(Path(__file__).with_name("serve-navigation-fixture.py")))
    workspace = base["WORKSPACE"]
    now = datetime.now(ZoneInfo("America/Chicago"))
    stamp = now.isoformat()
    workspace["projects"] += [
        {"id": f"state-project-{i:02}", "name": f"State project {i:02}",
         "aliases": [], "description": "Fictional page-state test project", "color": "#4465FF"}
        for i in range(40)
    ]
    workspace["tasks"] = [
        {"id": f"state-task-{i:02}", "title": f"State task {i:02}",
         "projectId": "navigation-project" if i % 2 == 0 else "state-project-00",
         "notes": "", "source": "Fictional page-state fixture", "steps": [],
         "estimateMinutes": 10, "remainingMinutes": 10, "priority": "medium",
         "status": "done" if i >= 36 else "todo", "blockers": [], "splittable": True,
         "createdAt": stamp, "updatedAt": stamp}
        for i in range(40)
    ]
    workspace["blocks"] = [
        {"id": f"state-block-{i:02}", "taskId": f"state-task-{i:02}",
         "start": stamp, "end": (now + timedelta(minutes=30)).isoformat()}
        for i in range(20)
    ]
    directory = Path("/tmp/ft-macos-page-state")
    directory.mkdir(exist_ok=True)
    state_path = directory / "workspace.json"
    requests_path = directory / "requests.jsonl"

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.record_request()
            ok = self.path == "/api/native/workspace"
            payload = json.loads(state_path.read_text()) if ok else {"error": "Unavailable in fixture"}
            self.send_response(200 if ok else 404)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(payload).encode())

        def do_POST(self):
            self.record_request()
            if self.path == "/__fixture/rename-first-task":
                payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                state = json.loads(state_path.read_text())
                state["tasks"][0]["title"] = payload["title"]
                state["revision"] += 1
                state_path.write_text(json.dumps(state))
                self.send_response(204)
            else:
                self.send_response(405)
            self.end_headers()

        def record_request(self):
            with requests_path.open("a") as output:
                output.write(json.dumps({"at": datetime.now().isoformat(),
                                         "method": self.command, "path": self.path}) + "\n")

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", args.port), Handler)
    state_path.write_text(json.dumps(workspace))
    requests_path.write_text("")
    (directory / "fixture.json").write_text(json.dumps({
        "server": f"http://127.0.0.1:{args.port}", "session": base["SESSION"],
        "statePath": str(state_path), "requestsPath": str(requests_path),
    }))
    print(f"Read-only page-state fixture: http://127.0.0.1:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
