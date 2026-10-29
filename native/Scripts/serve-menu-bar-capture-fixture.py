#!/usr/bin/env python3
# Created by Cory McCabe
"""Disposable loopback workspace for the macOS menu bar capture regressions."""
import argparse
import copy
import hashlib
import json
import runpy
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=4527)
    args = parser.parse_args()
    base = runpy.run_path(str(Path(__file__).with_name("serve-navigation-fixture.py")))
    session = {**base["SESSION"], "ownerId": "menu-bar-capture-test"}
    initial = copy.deepcopy(base["WORKSPACE"])
    initial["settings"]["timeZone"] = "America/Los_Angeles"
    initial["settings"]["workDays"] = list(range(7))
    now = datetime.now(timezone.utc)
    task = {
        "id": "menu-bar-original", "title": "Original menu bar task",
        "projectId": "navigation-project", "notes": "", "source": "Fictional fixture",
        "steps": [], "estimateMinutes": 30, "remainingMinutes": 30,
        "priority": "medium", "status": "ready", "blockers": [], "splittable": True,
        "createdAt": now.isoformat(), "updatedAt": now.isoformat(),
    }
    initial["tasks"] = [task]
    initial["blocks"] = [{
        "id": "menu-bar-block", "taskId": task["id"], "start": now.isoformat(),
        "end": (now + timedelta(hours=1)).isoformat(),
    }]
    state = {"workspace": copy.deepcopy(initial), "attempts": [], "mode": "online"}

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
                self.respond(200, state["workspace"])
            elif self.path == "/__fixture/state":
                self.respond(200, state)
            else:
                self.respond(404, {"error": "Unavailable in fixture"})

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))) or b"{}")
            workspace = state["workspace"]
            if self.path == "/__fixture/reset":
                state.update(workspace=copy.deepcopy(initial), attempts=[], mode=body.get("mode", "online"))
                self.respond(200, {})
            elif self.path == "/__fixture/mode":
                state["mode"] = body["mode"]
                self.respond(200, {})
            elif self.path == "/api/native/session":
                # A previous run can leave an expired loopback-only Keychain session.
                self.respond(200, session)
            elif self.path == "/api/native/inbox":
                state["attempts"].append(body)
                if state["mode"] != "online":
                    self.respond(400 if state["mode"] == "rejected" else 503,
                                 {"error": "Fictional capture needs editing" if state["mode"] == "rejected"
                                  else "Fictional connection unavailable"})
                    return
                group = "capture_" + hashlib.sha256(
                    (session["ownerId"] + ":" + body["requestId"]).encode()
                ).hexdigest()
                captured = [item for item in workspace["tasks"] if item.get("captureGroupId") == group]
                if not captured:
                    captured = [{**task, "id": group, "title": body["source"],
                                 "source": body["source"], "captureGroupId": group, "captureIndex": 0}]
                    workspace["tasks"] += captured
                    workspace["revision"] += 1
                self.respond(200, {"state": workspace, "result": {"tasks": captured}})
            elif self.path == "/api/native/workspace":
                if body.get("action") == "update_task":
                    for item in workspace["tasks"]:
                        if item["id"] == body["id"]:
                            item.update({key: value for key, value in body["task"].items()
                                         if key != "expectedUpdatedAt"})
                            item["updatedAt"] = datetime.now(timezone.utc).isoformat()
                elif body.get("action") == "update_settings":
                    workspace["settings"].update(body["settings"])
                else:
                    self.respond(400, {"error": "Unsupported fixture mutation"})
                    return
                workspace["revision"] += 1
                self.respond(200, {"state": workspace})
            else:
                self.respond(404, {"error": "Unavailable in fixture"})

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", args.port), Handler)
    directory = Path("/tmp/ft-menu-bar-capture")
    directory.mkdir(exist_ok=True)
    (directory / "fixture.json").write_text(json.dumps({
        "server": f"http://127.0.0.1:{args.port}", "session": session,
    }))
    print(f"Fictional menu bar capture fixture: http://127.0.0.1:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
