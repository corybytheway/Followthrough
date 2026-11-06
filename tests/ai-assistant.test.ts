// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_ASSISTANTS, aiAssistant, assistantDestination, assistantNeedsPaste } from '../lib/ai-assistant';
import { launchAssistant } from '../lib/assistant-launch';
import { initialWorkspace } from '../lib/model';
import { settingsInput } from '../lib/validation';
import {
  workHoursSettingsChanges,
  refreshedWorkHoursDraft,
} from '../lib/settings-client';

void test('existing accounts keep the ChatGPT default and invalid preferences cannot become URLs', () => {
  for (const value of [
    undefined,
    null,
    '',
    'https://evil.example',
    'unrecognized',
  ])
    assert.equal(aiAssistant(value), 'chatgpt');
  const original = initialWorkspace().settings;
  assert.equal(
    settingsInput({ aiAssistant: 'claude' }, original).aiAssistant,
    'claude',
  );
  assert.throws(() => settingsInput({ aiAssistant: 'unsupported' }, original));
});

void test('work-hours drafts preserve a preference changed on another client', () => {
  const baseline = initialWorkspace().settings;
  const draft = { ...baseline, workStart: '10:00' };
  const fresh = { ...baseline, aiAssistant: 'claude' as const };
  const merged = refreshedWorkHoursDraft(draft, baseline, fresh);
  assert.equal(merged.aiAssistant, 'claude');
  assert.equal(merged.workStart, '10:00');
  assert.deepEqual(workHoursSettingsChanges(merged, fresh), {
    workStart: '10:00',
  });
});

void test('each assistant preserves Unicode in supported prompt links and keeps full long briefs for paste', () => {
  const prompt = 'Do this ⚡️: & + ? #\nNotes ✨\r\nExact original input.';
  for (const { id: assistant } of AI_ASSISTANTS) {
    const destination = assistantDestination(prompt, assistant);
    assert.equal(destination.assistant, assistant);
    if (assistantNeedsPaste(assistant)) {
      assert.equal(destination.requiresPaste, true);
      if (assistant === 'grok') {
        assert.equal(destination.browserPrefillsPrompt, true);
        assert.equal(new URL(destination.browserUrl).searchParams.get('q'), prompt);
        assert.equal(destination.appUrl, 'xai-grok://');
        assert.equal(new URL(destination.browserUrl).searchParams.get('stay_in_browser'), 'true');
        assert.equal(new URL(destination.mobileAppUrl).searchParams.has('stay_in_browser'), false);
        assert.equal(new URL(destination.mobileAppUrl).searchParams.get('q'), prompt);
      } else {
        assert.equal(new URL(destination.browserUrl).search, '');
        assert.equal(destination.browserPrefillsPrompt, false);
      }
      assert.ok(destination.mobileAppUrl.startsWith('https://'));
    } else {
      assert.equal(
        new URL(destination.browserUrl).searchParams.get(
          assistant === 'claude' ? 'q' : 'prompt',
        ),
        prompt,
      );
      if (assistant === 'gemini_ai_studio') {
        assert.equal(destination.appUrl, null);
        assert.equal(new URL(destination.browserUrl).host, 'aistudio.google.com');
        assert.equal(destination.mobileAppUrl, destination.browserUrl);
      } else {
        assert.equal(
          new URL(destination.appUrl!).searchParams.get(
            assistant === 'claude' ? 'q' : 'prompt',
          ),
          prompt,
        );
      }
    }
    const long = assistantDestination(prompt.repeat(700), assistant);
    assert.equal(long.requiresPaste, true);
    assert.equal(long.browserPrefillsPrompt, false);
    assert.ok(long.browserUrl.length < 7000);
    assert.ok(!long.browserUrl.includes('/codex/context'));
  }
});

function launcher({ fail = false } = {}) {
  const opened: string[] = [];
  const listeners = new Map<string, () => void>();
  let timer: (() => void) | undefined;
  let cancelled = false;
  const stop = launchAssistant(
    {
      appUrl: 'claude://claude.ai/new?q=brief',
      browserUrl: 'https://claude.ai/new?q=brief',
    },
    {
      open: (url) => {
        opened.push(url);
        if (fail && url.startsWith('claude:'))
          throw new Error('No installed handler');
      },
      listen: (event, callback) => {
        listeners.set(event, callback);
        return () => {
          listeners.delete(event);
        };
      },
      schedule: (callback) => {
        timer = callback;
        return () => {
          cancelled = true;
        };
      },
    },
  );
  return {
    opened,
    listeners,
    tick: () => {
      if (!cancelled) timer?.();
    },
    stop,
  };
}
void test('web handoff attempts the app before browser fallback, exactly once', () => {
  const f = launcher();
  assert.deepEqual(f.opened, ['claude://claude.ai/new?q=brief']);
  f.tick();
  f.tick();
  assert.deepEqual(f.opened, [
    'claude://claude.ai/new?q=brief',
    'https://claude.ai/new?q=brief',
  ]);
});
void test('app focus or page hiding prevents a second AI browser destination from opening', () => {
  for (const event of ['blur', 'hidden']) {
    const f = launcher();
    f.listeners.get(event)!();
    f.tick();
    assert.deepEqual(f.opened, ['claude://claude.ai/new?q=brief']);
    assert.equal(f.listeners.size, 0);
  }
});
void test('missing handlers fall back once and cancelled/unmounted handoffs do not navigate later', () => {
  const missing = launcher({ fail: true });
  missing.tick();
  assert.deepEqual(missing.opened, [
    'claude://claude.ai/new?q=brief',
    'https://claude.ai/new?q=brief',
  ]);
  const cancelled = launcher();
  cancelled.stop();
  cancelled.tick();
  assert.deepEqual(cancelled.opened, ['claude://claude.ai/new?q=brief']);
});

void test('all seven choices are accepted and update only the shared preference', () => {
  const original = initialWorkspace().settings;
  assert.equal(AI_ASSISTANTS.length, 7);
  for (const { id } of AI_ASSISTANTS) {
    assert.deepEqual(settingsInput({ aiAssistant: id }, original), { ...original, aiAssistant: id });
  }
});
void test('universal app links navigate once and leave OS fallback to the same provider', () => {
  for (const id of ['copilot'] as const) {
    const destination = assistantDestination('Full task + webhook', id);
    const opened: string[] = [];
    const stop = launchAssistant(destination, {
      open: (url) => opened.push(url),
      listen: () => { throw new Error('Universal links must not install fallback listeners'); },
      schedule: () => { throw new Error('Universal links must not schedule duplicate navigation'); },
    });
    stop();
    assert.deepEqual(opened, [destination.appUrl]);
  }
});

void test('AI Studio opens only its prefilled browser destination without an app attempt', () => {
  const destination = assistantDestination('Full task + café\nExact brief', 'gemini_ai_studio');
  const opened: string[] = [];
  const stop = launchAssistant(destination, {
    open: url => opened.push(url),
    listen: () => { throw new Error('Browser-only destination must not listen for app focus'); },
    schedule: () => { throw new Error('Browser-only destination must not schedule app fallback'); },
  });
  stop();
  assert.deepEqual(opened, [destination.browserUrl]);
  assert.equal(destination.requiresPaste, false);
  assert.equal(destination.browserPrefillsPrompt, true);
});
