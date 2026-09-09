// Created by Cory McCabe
'use client';
import { useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export default function ShortcutSettings() {
  const [available, setAvailable] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connection, setConnection] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    void fetch('/api/shortcuts/connection', { cache: 'no-store' })
      .then(async (response) => {
        const result = (await response.json()) as {
          available?: boolean;
          connected?: boolean;
          connection?: string;
          error?: string;
        };
        if (!response.ok)
          throw new Error(result.error || 'Could not load shortcut settings.');
        if (active) {
          setAvailable(result.available === true);
          setConnected(result.connected === true);
        }
      })
      .catch((error) => {
        if (active) setMessage(error.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function change(action: 'connect' | 'disconnect') {
    setBusy(true);
    setMessage('');
    setConnection('');
    try {
      const response = await fetch('/api/shortcuts/connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const result = (await response.json()) as {
        available?: boolean;
        connected?: boolean;
        connection?: string;
        error?: string;
      };
      if (!response.ok)
        throw new Error(
          result.error || 'Could not update the shortcut connection.',
        );
      setConnected(action === 'connect');
      setConnection(result.connection || '');
      if (action === 'disconnect') setMessage('Shortcut disconnected.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not connect.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-card">
      <Smartphone />
      <h2>iPhone Action button</h2>
      <p>
        Talk or type a request. The shortcut saves it directly and confirms when
        it is saved.
      </p>
      <p>Until AI capture is connected, requests go into Inbox for planning.</p>
      <h3>Connect your shortcut</h3>
      <ol>
        <li>
          <a href="/shortcuts/Followthrough%20Task.shortcut?v=5" download>
            Install Followthrough Task
          </a>{' '}
          and tap Add Shortcut. This version has no setup questions during
          installation. Replace the older shortcut if asked.
        </li>
        <li>
          Copy your connection code below. Then{' '}
          <a href="shortcuts://run-shortcut?name=Followthrough%20Task&input=text&text=connect">
            open the shortcut to connect
          </a>{' '}
          and paste it when the shortcut runs. It remembers the code for future
          tasks.
        </li>
        <li>
          On your iPhone, choose Settings → Action Button → Shortcut →
          Followthrough Task.
        </li>
      </ol>
      <Button
        disabled={busy || !available}
        onClick={() => void change('connect')}
      >
        {busy
          ? 'Connecting…'
          : connected
            ? 'Replace connection code'
            : 'Create connection code'}
      </Button>
      {connected && !connection && (
        <p>Replacing the code disconnects the previous copy.</p>
      )}
      {connection && (
        <>
          <label className="field">
            <span>Private connection code</span>
            <Textarea
              readOnly
              aria-label="Private connection code"
              value={connection}
              rows={3}
            />
          </label>
          <Button
            variant="outline"
            onClick={() =>
              void navigator.clipboard
                .writeText(connection)
                .then(() =>
                  setMessage(
                    'Copied. Open the shortcut to connect, then paste when it asks.',
                  ),
                )
                .catch(() => setMessage('Select and copy the code above.'))
            }
          >
            Copy connection code
          </Button>
          <small>
            This code is shown once. Keep it private; it lets your shortcut add
            tasks.
          </small>
        </>
      )}
      {connected && (
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => void change('disconnect')}
        >
          Disconnect shortcut
        </Button>
      )}
      {!available && !message && (
        <small>Shortcut connections are being configured.</small>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
