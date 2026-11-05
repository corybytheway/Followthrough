#!/usr/bin/env python3
# Created by Cory McCabe
"""Shared synthetic loopback workspace for AI-assistant preference UI checks."""
import argparse
import copy
import json
import threading
import time
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=4537)
    parser.add_argument('--directory', type=Path, default=Path('/private/tmp/ft-ai-assistant-fixture'))
    args = parser.parse_args()
    origin = f'http://127.0.0.1:{args.port}'
    args.directory.mkdir(parents=True, exist_ok=True)
    now = datetime.now(ZoneInfo('America/Chicago'))
    stamp = now.isoformat()
    session = {'accessToken': 'fictional-assistant-ui-token', 'refreshToken': 'fictional-assistant-refresh',
               'expiresAt': (time.time() + 86400) * 1000, 'ownerId': 'assistant-ui-fixture', 'sessionId': 'assistant-ui-fixture'}
    workspace = {
        'version': 1, 'revision': 1,
        'projects': [{'id': 'assistant-project', 'name': 'Synthetic Studio', 'shortName': 'QA',
                      'aliases': ['Synthetic Studio'], 'description': 'Fictional assistant routing checks only.', 'color': '#7652DB'}],
        'tasks': [{'id': 'assistant-routing-draft', 'title': 'Preview assistant routing only', 'projectId': 'assistant-project',
                   'notes': 'Leave the assistant draft unsent. Do not perform any work or call the completion URL.',
                   'source': 'Synthetic UI fixture. No user data, connected services, or real work.',
                   'steps': [{'id': 'done-step', 'title': 'Preserve this completed step', 'done': True},
                             {'id': 'preview-step', 'title': 'Inspect the unsent draft', 'done': False}],
                   'estimateMinutes': 15, 'remainingMinutes': 15, 'priority': 'medium', 'status': 'ready',
                   'blockers': [], 'splittable': False, 'createdAt': stamp, 'updatedAt': stamp,
                   'dueDate': None, 'notBefore': None, 'completedAt': None}],
        'blocks': [{'id': 'assistant-block', 'taskId': 'assistant-routing-draft', 'start': stamp,
                    'end': (now + timedelta(minutes=30)).isoformat()}],
        'busy': [], 'warnings': [], 'recentRequests': [], 'plannedAt': stamp, 'currentDate': now.date().isoformat(),
        'settings': {'timeZone': 'America/Chicago', 'workStart': '08:40', 'workEnd': '17:20',
                     'workDays': [1, 2, 4, 5], 'maxBlockMinutes': 75, 'breakEveryMinutes': 75, 'breakMinutes': 17},
        'integrations': {'ai': False, 'google': False, 'icloud': False, 'zoho': False, 'background': False,
                         'email': {'connected': False, 'address': '', 'allowedSenders': []}, 'emailSetupAvailable': False},
    }
    state = {'workspace': workspace, 'requests': [], 'initialSettings': copy.deepcopy(workspace['settings'])}
    lock = threading.RLock()

    def persist():
        (args.directory / 'state.json').write_text(json.dumps(state, indent=2) + '\n')

    class Handler(BaseHTTPRequestHandler):
        def respond(self, status, payload=None):
            data = json.dumps(payload).encode() if payload is not None else b''
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self):
            self.respond(204)

        def record(self, body=None):
            state['requests'].append({'at': datetime.now().isoformat(), 'method': self.command,
                                      'path': self.path, 'body': body})
            persist()

        def do_GET(self):
            with lock:
                self.record()
                path = urlparse(self.path).path
                if path in ['/api/native/workspace', '/api/workspace']:
                    self.respond(200, workspace)
                elif path == '/api/native/calendars':
                    self.respond(200, {})
                elif path == '/api/native/suggestions':
                    self.respond(200, {'suggestions': [], 'status': {'available': False, 'gmailEnabled': False,
                                 'googleConnected': False, 'googleAccount': '', 'lastChecked': None, 'checking': False,
                                 'error': None, 'queued': 0, 'feedbackCount': 0}})
                elif path == '/__fixture/state':
                    self.respond(200, state)
                else:
                    self.respond(404, {'error': 'Unavailable in this loopback fixture.'})

        def do_POST(self):
            with lock:
                try:
                    body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', '0'))) or b'{}')
                except (ValueError, json.JSONDecodeError):
                    self.respond(400, {'error': 'Invalid fixture JSON.'})
                    return
                self.record(body)
                if self.path == '/api/native/session':
                    self.respond(200, session)
                elif self.path in ['/api/native/workspace', '/api/workspace'] and body.get('action') == 'update_settings':
                    patch = body.get('settings', {})
                    if not isinstance(patch, dict) or ('aiAssistant' in patch and patch['aiAssistant'] not in ['chatgpt', 'claude', 'gemini', 'gemini_ai_studio', 'grok', 'perplexity', 'copilot']):
                        self.respond(400, {'error': 'Invalid assistant preference.'})
                        return
                    workspace['settings'].update(patch)
                    workspace['revision'] += 1
                    persist()
                    self.respond(200, {'state': workspace, 'result': {}})
                elif self.path == '/api/native/handoff':
                    completion = origin + '/__fixture/complete?k=fictional-never-call'
                    prompt = ('LOCAL UI TEST ONLY — leave this draft unsent. Do not perform work, send messages, call URLs, or mark any task complete.\n\n'
                              'Synthetic task: Preview assistant routing only\nProject: Synthetic Studio\nChecklist:\n[x] Preserve this completed step\n[ ] Inspect the unsent draft\n\n'
                              'All task details are fictional. Completion webhook (never call during this test): ' + completion + '\n\n'
                              'Original input: Synthetic UI fixture. No user data, connected services, or real work. ✨ & +')
                    self.respond(200, {'taskId': 'assistant-routing-draft', 'title': 'Preview assistant routing only',
                                      'prompt': prompt, 'completionUrl': completion,
                                      'assistant': workspace['settings'].get('aiAssistant', 'chatgpt')})
                else:
                    self.respond(403, {'error': 'This fixture permits only preference updates and synthetic handoff drafts.'})

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    (args.directory / 'fixture.json').write_text(json.dumps({'server': origin, 'session': session,
                                                            'statePath': str(args.directory / 'state.json')}, indent=2) + '\n')
    persist()
    print(f'Synthetic shared assistant fixture: {origin}', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
