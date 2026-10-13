// Created by Cory McCabe
'use client';
import { useEffect, useState } from 'react';
import { Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Connection = { connected: boolean; online?: boolean; name?: string | null };
export default function CodexSettings() {
  const [connection, setConnection] = useState<Connection>({ connected: false });
  const [code, setCode] = useState('');
  const [pendingName, setPendingName] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const pairing = new URLSearchParams(window.location.search).get('codex_pair');
    if (pairing) setCode(pairing);
    let active = true;
    const refresh = () => void fetch('/api/codex/connection', { cache: 'no-store' }).then(async response => {
      const result = await response.json() as Connection & { error?: string };
      if (!response.ok) throw new Error(result.error || 'Could not read the Mac connection.');
      if (active) setConnection(result);
    }).catch(error => { if (active) setMessage(error.message); });
    refresh(); const timer = window.setInterval(refresh, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  async function change(action: 'preview' | 'connect' | 'disconnect') {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/codex/connection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, code }) });
      const result = await response.json() as Connection & { error?: string };
      if (!response.ok) throw new Error(result.error || 'Could not update the Mac connection.');
      if (action === 'preview') setPendingName(result.name || 'this Mac');
      else { setConnection(result); setPendingName(''); setCode(''); setMessage(action === 'connect' ? 'Mac connected. Tasks you send to Codex will start automatically when it is online.' : 'Mac disconnected.'); }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not connect.'); }
    finally { setBusy(false); }
  }
  return <div className="settings-card" id="codex-connection">
    <Monitor /><h2>Send tasks to Codex</h2>
    <p>Start a Codex task from Followthrough or your calendar on any device. Your connected Mac receives the complete task context and starts work using your Codex account.</p>
    {connection.connected && <p><strong>{connection.name}</strong> · {connection.online ? 'Online' : 'Offline — tasks wait until it reconnects'}</p>}
    <p>Open the Followthrough Codex helper on your Mac and choose Connect Followthrough. Its connection page opens here with the pairing code filled in.</p>
    <label className="field"><span>Mac pairing code</span><Input value={code} placeholder="Code from the Mac helper" onChange={event => { setCode(event.target.value); setPendingName(''); }} /></label>
    {pendingName ? <>
      <p>Connect <strong>{pendingName}</strong>? This Mac will automatically start only tasks you send to Codex. Codex’s normal permissions and approvals still apply. {connection.connected && 'This replaces your current Mac connection.'}</p>
      <Button disabled={busy} onClick={() => void change('connect')}>Connect this Mac</Button>
      <Button variant="ghost" disabled={busy} onClick={() => setPendingName('')}>Cancel</Button>
    </> : <Button disabled={busy || !code.trim()} onClick={() => void change('preview')}>{busy ? 'Checking…' : 'Check Mac'}</Button>}
    {connection.connected && <Button disabled={busy} variant="ghost" onClick={() => void change('disconnect')}>Disconnect Mac</Button>}
    <small>Your Mac must be awake and online to start tasks. Queued tasks wait while it is offline. The helper starts at login and keeps working in the background.</small>
    {message && <p role="status">{message}</p>}
  </div>;
}
