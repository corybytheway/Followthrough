// Created by Cory McCabe
'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

export function TaskHandoffDialog({ prompt, open, onOpenChange, destination, onContinue, initiallyCopied }: {
  prompt: string;
  destination: { name: string; browserPrefillsPrompt?: boolean };
  onContinue: () => void;
  initiallyCopied: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const brief = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(initiallyCopied);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (open && !copied) { brief.current?.focus(); brief.current?.select(); }
  }, [open, copied]);

  async function copy() {
    setBusy(true);
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setMessage('Task details copied.');
      return true;
    } catch {
      setCopied(false);
      brief.current?.focus(); brief.current?.select();
      setMessage('Select and copy the task details below before continuing.');
      return false;
    } finally { setBusy(false); }
  }
  async function continueToAssistant() {
    // Refresh the clipboard on the user's click in case it changed while this was open.
    if (copied && !await copy()) return;
    onContinue();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" initialFocus={() => {
        if (!copied && brief.current) { brief.current.focus(); brief.current.select(); return false; }
        return true;
      }}>
        <DialogHeader>
          <DialogTitle>{copied ? 'Task details copied' : 'Copy task details'}</DialogTitle>
          <DialogDescription>
            {destination.browserPrefillsPrompt
              ? <>{!copied && 'Copy the full task details below. '}If {destination.name} opens with an empty message box, paste the copied details. Its browser link fills them in automatically.</>
              : copied ? <>After {destination.name} opens, paste the copied task details if its message box is empty.</>
              : <>Copy the full task details below. After {destination.name} opens, paste them if its message box is empty.</>}
          </DialogDescription>
        </DialogHeader>
        {!copied && <Textarea ref={brief} aria-label="Full task details" value={prompt} readOnly className="min-h-64 max-h-[50vh] text-xs" />}
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy} onClick={() => void continueToAssistant()}>Open {destination.name}</Button>
          {!copied && <Button type="button" disabled={busy} variant="outline" onClick={() => void copy()}>Copy task details</Button>}
        </div>
        <p role="status">{message}</p>
      </DialogContent>
    </Dialog>
  );
}
