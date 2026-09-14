// Created by Cory McCabe
'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
export default function OpenAISettings() {
  const [connected, setConnected] = useState(false),
    [loaded, setLoaded] = useState(false);
  const [key, setKey] = useState(''),
    [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    fetch('/api/openai', { cache: 'no-store' })
      .then(async (r) => {
        const data = (await r.json()) as { connected: boolean; error?: string };
        if (!r.ok) throw new Error(data.error);
        setConnected(data.connected);
        setLoaded(true);
      })
      .catch(() =>
        setError(
          'Could not check the OpenAI connection. Refresh to try again.',
        ),
      );
  }, []);
  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: key }),
      });
      const data = (await response.json()) as {
        error?: string;
        exampleTitle: string;
        ids: string[];
      };
      if (!response.ok) throw new Error(data.error);
      setKey('');
      setConnected(true);
      setMessage(
        `OpenAI connected and tested. Example title: ${data.exampleTitle}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed.');
    } finally {
      setBusy(false);
    }
  }
  async function rename() {
    setBusy(true);
    setError('');
    setMessage('');
    let changed = 0,
      failed = 0;
    try {
      const response = await fetch('/api/openai/rename', { cache: 'no-store' });
      const data = (await response.json()) as {
        error?: string;
        exampleTitle: string;
        ids: string[];
      };
      if (!response.ok) throw new Error(data.error);
      for (const id of data.ids as string[]) {
        setMessage(
          `Regenerating active task names: ${changed + failed} of ${data.ids.length} processed…`,
        );
        const result = await fetch('/api/openai/rename', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        if (result.ok) changed++;
        else failed++;
      }
      setMessage(
        `Regenerated ${changed} active task name${changed === 1 ? '' : 's'}.${failed ? ` ${failed} could not be updated; retry to finish.` : ''}`,
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not regenerate task names.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-card">
      <h2>AI task naming</h2>
      <span className="status-label">
        {!loaded
          ? 'Checking connection…'
          : connected
            ? 'OpenAI connected'
            : 'Not connected'}
      </span>
      <p>
        Turn your words into a concise action title and up to five suggested
        steps. Your exact words stay in Original input.
      </p>
      {!connected && (
        <form onSubmit={connect} className="editor-form">
          <label className="field">
            OpenAI API key
            <Input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              required
              disabled={busy}
            />
          </label>
          <p className="field-help">
            Saved encrypted in your private Followthrough account. Tested before
            connecting.
          </p>
          <Button type="submit" disabled={busy || !key.trim()}>
            {busy ? 'Testing connection…' : 'Connect OpenAI'}
          </Button>
        </form>
      )}
      {connected && (
        <>
          <p>
            Regenerate active task names from their original input. Existing
            scheduling, completion, and checklist details are preserved.
          </p>
          <Button onClick={rename} disabled={busy}>
            {busy ? 'Regenerating…' : 'Regenerate active task names'}
          </Button>
        </>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
