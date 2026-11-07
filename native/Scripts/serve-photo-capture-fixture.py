#!/usr/bin/env python3
# Created by Cory McCabe
"""Disposable loopback workspace for photo share UI verification; no real account access."""
import argparse
import copy
import json
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import runpy

SERVER = "http://127.0.0.1:4539"
base = runpy.run_path(str(Path(__file__).with_name("serve-navigation-fixture.py")))
SESSION = {**base["SESSION"], "ownerId": "photo-share-test", "expiresAt": (time.time() + 86400) * 1000}
INITIAL = copy.deepcopy(base["WORKSPACE"])
INITIAL["projects"][0].update(name="Photo Studio", shortName="Photo")
STATE = {"workspace": copy.deepcopy(INITIAL), "mode": "online", "generations": [], "saves": []}


class Handler(BaseHTTPRequestHandler):
    def respond(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/api/native/workspace":
            self.respond(200, STATE["workspace"])
        elif self.path == "/__fixture/state":
            self.respond(200, STATE)
        else:
            self.respond(404, {"error": "Unavailable in photo fixture"})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))) or b"{}")
        workspace = STATE["workspace"]
        if self.path == "/__fixture/reset":
            STATE.update(workspace=copy.deepcopy(INITIAL), mode="online", generations=[], saves=[])
            self.respond(200, {})
        elif self.path == "/__fixture/mode":
            STATE["mode"] = body["mode"]
            self.respond(200, {})
        elif self.path == "/api/native/session":
            self.respond(200, SESSION)
        elif self.path == "/api/native/capture":
            STATE["generations"].append(body)
            if STATE["mode"] == "offline":
                self.respond(503, {"error": "Fictional task generation unavailable"})
                return
            self.respond(200, {"drafts": [{
                "title": "Send the invoice to Alex", "projectId": "navigation-project",
                "steps": ["Check the invoice details", "Send the invoice to Alex"],
                "estimateMinutes": 30, "priority": "medium", "dueDate": None, "notBefore": None,
                "notes": "Fictional photo fixture", "rationale": "Review before saving.",
                "blockedByTaskIndexes": [], "captureMode": "ai",
            }]})
        elif self.path == "/api/native/workspace":
            if body.get("action") == "update_settings":
                workspace["settings"].update(body["settings"])
                self.respond(200, {"state": workspace})
                return
            if body.get("action") != "capture_tasks":
                self.respond(400, {"error": "Unsupported photo fixture mutation"})
                return
            STATE["saves"].append(body)
            if STATE["mode"] == "offline":
                self.respond(503, {"error": "Fictional connection unavailable"})
                return
            group = body["captureGroupId"]
            captured = [t for t in workspace["tasks"] if t.get("captureGroupId") == group]
            if not captured:
                now = datetime.now(timezone.utc).isoformat()
                for index, capture in enumerate(body["captures"]):
                    task = capture["task"]
                    captured.append({**task, "id": capture["captureId"], "captureGroupId": group, "captureIndex": index,
                                     "remainingMinutes": task["estimateMinutes"], "splittable": True,
                                     "createdAt": now, "updatedAt": now, "blockers": [],
                                     "steps": [{"id": f"step-{index}-{i}", "title": title, "done": False}
                                               for i, title in enumerate(task["steps"])]})
                workspace["tasks"] += captured
                workspace["revision"] += 1
            self.respond(200, {"state": workspace, "result": {"tasks": captured}})
        else:
            self.respond(404, {"error": "Unavailable in photo fixture"})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--photo-inbox", type=Path, help="Optional dedicated simulator PhotoInbox path for read-only storage assertions")
    args = parser.parse_args()
    fixture = {"server": SERVER, "session": SESSION}
    if args.photo_inbox:
        fixture["photoInboxPath"] = str(args.photo_inbox)
    Path("/tmp/ft-photo-capture-fixture.json").write_text(json.dumps(fixture))
    print(f"Photo share fixture: {SERVER}", flush=True)
    HTTPServer(("127.0.0.1", 4539), Handler).serve_forever()
