// Created by Cory McCabe
import { aiAssistant } from './ai-assistant';

export type AssistantPlatform = 'macos' | 'ios' | 'web';

export function assistantPlatform(userAgent: string, maxTouchPoints = 0): AssistantPlatform {
  if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return 'ios';
  return /Macintosh|Mac OS X/.test(userAgent) ? 'macos' : 'web';
}

export function assistantSettingsInstructions(value: unknown, platform: AssistantPlatform): string {
  const assistant = aiAssistant(value);
  const longBrief = ' Very long briefs are copied for pasting.';
  switch (assistant) {
    case 'chatgpt':
      return (platform === 'ios'
        ? 'On iPhone and iPad, ChatGPT can open a prefilled draft in its app or your browser.'
        : platform === 'macos'
          ? 'On Mac, the handoff tries the ChatGPT app first, then a prefilled browser draft.'
          : 'ChatGPT’s browser chat fills in task details for review.') + longBrief;
    case 'claude':
      return (platform === 'ios'
        ? 'Tries Claude’s iPhone or iPad app first, then its browser chat. Browser drafts prefill task details; prefill in its iPhone and iPad app has not been verified.'
        : platform === 'macos'
          ? 'On Mac, the handoff tries Claude’s app first. Its Mac app and browser chat support prefilled drafts.'
          : 'Claude’s browser chat fills in task details for review.') + longBrief;
    case 'gemini_ai_studio':
      return 'Opens Gemini in Google AI Studio in your browser with task details filled in for review. This choice is browser-only.' + longBrief;
    case 'grok':
      return 'Grok’s browser chat fills in task details automatically. A copy is kept as a backup. Paste only if ' +
        (platform === 'ios' ? 'the iPhone or iPad app' : platform === 'macos' ? 'the Mac app' : 'an app') +
        ' opens with an empty message box. Very long briefs require pasting.';
    case 'gemini':
      return (platform === 'ios'
        ? 'On iPhone and iPad, the handoff tries the Gemini app first, then your browser.'
        : 'Gemini opens in your browser.') +
        ' This Gemini handoff copies task details for you to paste. Choose Gemini (AI Studio) for browser prefill.';
    case 'perplexity':
      return 'Opens Perplexity' + (platform === 'ios' ? ' on iPhone or iPad' : platform === 'macos' ? ' on Mac' : '') +
        '. A copy of the task details is available. Paste it only if the message box is empty.';
    case 'copilot':
      return 'Opens Copilot' + (platform === 'ios' ? ' on iPhone or iPad' : platform === 'macos' ? ' on Mac' : '') +
        '. A copy of the task details is available. If the message box is empty, paste it. Automatic draft prefill has not been verified for this route.';
  }
}
