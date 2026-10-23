// Created by Cory McCabe
'use client';
import { useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ShortcutSettings() {
  const [legacyConnected, setLegacyConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    void fetch('/api/shortcuts/connection', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return;
        const result = (await response.json()) as { connected?: boolean };
        if (active) setLegacyConnected(result.connected === true);
      })
      .catch(() => {
        // Native App Shortcuts do not depend on the older connection service.
      });
    return () => {
      active = false;
    };
  }, []);

  async function disconnectLegacyShortcut() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/shortcuts/connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disconnect' }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error || 'Could not disconnect the shortcut.');
      setLegacyConnected(false);
      setMessage('Older shortcut disconnected.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not disconnect.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-card">
      <Smartphone />
      <h2>Apple Shortcuts</h2>
      <p>
        Talk or type a task from anywhere with Apple Shortcuts. Install
        Followthrough on your iPhone and sign in, then add the shortcut once.
      </p>
      <p>
        <a href="/shortcuts/Followthrough%20Talk%20or%20Type.shortcut" download>
          Add Followthrough Talk or Type
        </a>
      </p>
      <p>
        Choose Talk to dictate or Type to write. Apple Shortcuts handles your
        input and permissions, then saves to the account signed into Followthrough
        without opening the app.
      </p>
      <p>
        To build your own workflow, find Followthrough’s Capture a task action in
        Shortcuts and pass it the text you want to save. This action is included
        with the app.
      </p>
      <h3>Use your Action button</h3>
      <p>
        On a supported iPhone, open Settings → Action Button → Shortcut. Choose
        Followthrough Talk or Type.
      </p>
      <p>You can also say “Siri, capture a task in Followthrough.”</p>
      <h3>Use your Apple Watch</h3>
      <p>
        Open Followthrough on your paired Watch, tap the mint plus, then Done
        to save. Apple’s text entry lets you dictate or type. Requests wait on
        your Watch when your iPhone is unavailable and sync through the account
        signed into your iPhone.
      </p>
      <p>
        Add the Capture a task bolt or Up next complication to your watch face.
        Up next shows your current or next scheduled task and opens its actions.
      </p>
      <p>
        If you prefer Shortcuts, turn on Show on Apple Watch in the shortcut’s
        Details to use the same background save action.
      </p>
      {legacyConnected && (
        <details>
          <summary>Older shortcuts</summary>
          <p>
            Your previously connected shortcut can keep working. Disconnect it
            when you no longer use it.
          </p>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void disconnectLegacyShortcut()}
          >
            {busy ? 'Disconnecting…' : 'Disconnect older shortcut'}
          </Button>
        </details>
      )}
      {message && <output>{message}</output>}
    </div>
  );
}
