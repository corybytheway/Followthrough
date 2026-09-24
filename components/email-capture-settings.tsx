// Created by Cory McCabe
'use client';
import { useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Status = {
  connected: boolean;
  address: string;
  allowedSenders: string[];
};

const emptyStatus: Status = {
  connected: false,
  address: '',
  allowedSenders: [],
};

export default function EmailCaptureSettings() {
  const [status, setStatus] = useState(emptyStatus);
  const [loaded, setLoaded] = useState(false);
  const [address, setAddress] = useState('');
  const [senders, setSenders] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingSenders, setEditingSenders] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/email/connection', { cache: 'no-store' })
      .then(async (response) => {
        const data = (await response.json()) as Status & { error?: string };
        if (!response.ok) throw new Error(data.error);
        setStatus(data);
        setSenders(data.allowedSenders.join(', '));
        setLoaded(true);
      })
      .catch(() =>
        setError('Could not check the email connection. Refresh to try again.'),
      );
  }, []);

  async function connect(event: { preventDefault(): void }) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/email/connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'connect',
          address,
          allowedSenders: senders
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
          apiKey,
          webhookSecret,
        }),
      });
      const data = (await response.json()) as Status & { error?: string };
      if (!response.ok) throw new Error(data.error);
      setStatus(data);
      setApiKey('');
      setWebhookSecret('');
      setMessage('Email capture connected.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Connection failed.');
    } finally {
      setBusy(false);
    }
  }

  async function updateSenders(event: { preventDefault(): void }) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/email/connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update-senders',
          allowedSenders: senders
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        }),
      });
      const data = (await response.json()) as Status & { error?: string };
      if (!response.ok) throw new Error(data.error);
      setStatus(data);
      setSenders(data.allowedSenders.join(', '));
      setEditingSenders(false);
      setMessage('Accepted senders updated.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Update failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-card">
      <Mail />
      <h2>Email capture</h2>
      <span className="status-label">
        {!loaded
          ? 'Checking connection…'
          : status.connected
            ? 'Ready to receive forwarded emails'
            : 'Email capture needs setup'}
      </span>
      <p>
        Forward an email to this address. Followthrough uses its subject and
        message as the original input, then creates and schedules every
        independent task it finds.
      </p>
      {status.connected ? (
        <>
          <a className="download-link" href={`mailto:${status.address}`}>
            <Mail size={16} />
            {status.address}
          </a>
          {editingSenders ? (
            <form className="editor-form" onSubmit={updateSenders}>
              <label className="field" htmlFor="email-capture-senders-edit">
                Allowed sender emails
                <Input
                  id="email-capture-senders-edit"
                  value={senders}
                  onChange={(event) => setSenders(event.target.value)}
                  required
                  disabled={busy}
                />
              </label>
              <div className="form-actions">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSenders(status.allowedSenders.join(', '));
                    setEditingSenders(false);
                  }}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? 'Saving…' : 'Save senders'}
                </Button>
              </div>
            </form>
          ) : (
            <>
              <p>Accepted senders: {status.allowedSenders.join(', ')}</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingSenders(true)}
              >
                Edit accepted senders
              </Button>
            </>
          )}
        </>
      ) : (
        <form className="editor-form" onSubmit={connect}>
          <label className="field" htmlFor="email-capture-address">
            Inbound address
            <Input
              id="email-capture-address"
              type="email"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              required
              disabled={busy}
            />
          </label>
          <label className="field" htmlFor="email-capture-senders">
            Allowed sender emails
            <Input
              id="email-capture-senders"
              value={senders}
              onChange={(event) => setSenders(event.target.value)}
              placeholder="you@example.com, another@example.com"
              required
              disabled={busy}
            />
          </label>
          <label className="field" htmlFor="email-capture-api-key">
            Resend API key
            <Input
              id="email-capture-api-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              required
              disabled={busy}
            />
          </label>
          <label className="field" htmlFor="email-capture-webhook-secret">
            Webhook signing secret
            <Input
              id="email-capture-webhook-secret"
              type="password"
              autoComplete="off"
              value={webhookSecret}
              onChange={(event) => setWebhookSecret(event.target.value)}
              required
              disabled={busy}
            />
          </label>
          <p className="field-help">
            Credentials are encrypted in your private Followthrough account.
            Only email from the allowed senders is accepted.
          </p>
          <Button type="submit" disabled={busy}>
            {busy ? 'Connecting…' : 'Connect email capture'}
          </Button>
        </form>
      )}
      {message && <output>{message}</output>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
