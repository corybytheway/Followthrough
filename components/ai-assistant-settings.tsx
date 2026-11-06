// Created by Cory McCabe
'use client';
import { useEffect, useState } from 'react';
import {
  AI_ASSISTANTS,
  aiAssistant,
  type AIAssistant,
} from '@/lib/ai-assistant';
import { NativeSelect } from '@/components/ui/native-select';
import { assistantPlatform, assistantSettingsInstructions, type AssistantPlatform } from '@/lib/assistant-instructions';

export function AIAssistantSettings({
  value,
  save,
}: {
  value: unknown;
  save: (assistant: AIAssistant) => Promise<unknown>;
}) {
  const [pending, setPending] = useState<AIAssistant | null>(null);
  const [error, setError] = useState('');
  const [platform, setPlatform] = useState<AssistantPlatform>('web');
  useEffect(() => { setPlatform(assistantPlatform(navigator.userAgent, navigator.maxTouchPoints)); }, []);
  async function update(assistant: AIAssistant) {
    setPending(assistant);
    setError('');
    try {
      await save(assistant);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Could not save your AI assistant. Try again.',
      );
    } finally {
      setPending(null);
    }
  }
  return (
    <section className="settings-card editor-form">
      <h2>Hand off your tasks</h2>
      <label className="field">
        <span>AI assistant</span>
        <NativeSelect
          aria-label="AI assistant"
          value={pending ?? aiAssistant(value)}
          disabled={pending !== null}
          onChange={(event) => void update(event.target.value as AIAssistant)}
        >
          {AI_ASSISTANTS.map((assistant) => (
            <option key={assistant.id} value={assistant.id}>
              {assistant.name}
            </option>
          ))}
        </NativeSelect>
      </label>
      <p className="secondary-text">
        Where tasks go when you choose “Do this for me.” Your choice syncs
        across web, Mac, and iPhone.
      </p>
      <p className="secondary-text">{assistantSettingsInstructions(pending ?? value, platform)}</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
