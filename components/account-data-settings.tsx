// Created by Cory McCabe
'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function AccountDataSettings() {
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function erase(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/account/data', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm }),
      });
      const data = (await response.json()) as {
        error?: string;
        calendarCleanupPending?: boolean;
      };
      if (!response.ok)
        throw new Error(data.error || 'Could not erase your data.');
      setConfirm('');
      setMessage(
        data.calendarCleanupPending
          ? 'Your Followthrough data was erased. Google could not remove every task block; remove any remaining Followthrough events in Google Calendar.'
          : 'Your Followthrough data was erased. Reload to start with an empty workspace.',
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Could not erase your data.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-card">
      <h2>Erase account data</h2>
      <p>
        This removes your tasks, projects, calendar connections, shortcut code,
        and saved settings. Followthrough also tries to remove its task blocks
        from your Google Calendar. Your invitation to the site remains active
        until its owner removes it.
      </p>
      <form onSubmit={(event) => void erase(event)} className="editor-form">
        <label className="field" htmlFor="erase-account-confirm">
          Type DELETE to continue
          <Input
            id="erase-account-confirm"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="off"
          />
        </label>
        <Button
          type="submit"
          variant="destructive"
          disabled={busy || confirm !== 'DELETE'}
        >
          {busy ? 'Erasing…' : 'Erase my Followthrough data'}
        </Button>
      </form>
      {message && <output>{message}</output>}
    </div>
  );
}
