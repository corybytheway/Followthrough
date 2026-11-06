// Created by Cory McCabe
export const AI_ASSISTANTS = [
  { id: 'chatgpt', name: 'ChatGPT' },
  { id: 'claude', name: 'Claude' },
  { id: 'gemini', name: 'Gemini' },
  { id: 'gemini_ai_studio', name: 'Gemini (AI Studio)' },
  { id: 'grok', name: 'Grok' },
  { id: 'perplexity', name: 'Perplexity' },
  { id: 'copilot', name: 'Copilot' },
] as const;
export type AIAssistant = (typeof AI_ASSISTANTS)[number]['id'];
export const DEFAULT_AI_ASSISTANT: AIAssistant = 'chatgpt';
export function assistantNeedsPaste(value: unknown) {
  return !['chatgpt', 'claude', 'gemini_ai_studio'].includes(aiAssistant(value));
}
export function aiAssistant(value: unknown): AIAssistant {
  return AI_ASSISTANTS.some((assistant) => assistant.id === value)
    ? (value as AIAssistant)
    : DEFAULT_AI_ASSISTANT;
}

export function assistantDestination(prompt: string, preference: unknown) {
  const assistant = aiAssistant(preference);
  const name = AI_ASSISTANTS.find(
    (candidate) => candidate.id === assistant,
  )!.name;
  const encodedPrompt = encodeURIComponent(prompt);
  const tooLong = encodedPrompt.length > 7000;
  const requiresPaste = assistantNeedsPaste(assistant) || tooLong;
  // Browser draft support does not establish text-input support in a native app.
  const browserPrefillsPrompt = !tooLong && ['chatgpt', 'claude', 'gemini_ai_studio', 'grok'].includes(assistant);
  const openingPrompt = requiresPaste
    ? `The complete Followthrough task details have been copied to your clipboard. Paste them into this chat before beginning; they include the task-specific completion webhook.`
    : prompt;
  const encoded = encodeURIComponent(openingPrompt);
  const browserUrl =
    assistant === 'claude' ? 'https://claude.ai/new?q=' + encoded
    : assistant === 'gemini_ai_studio' ? 'https://aistudio.google.com/prompts/new_chat' + (browserPrefillsPrompt ? '?prompt=' + encodedPrompt : '')
    : assistant === 'gemini' ? 'https://gemini.google.com/app'
    : assistant === 'grok' ? 'https://grok.com/?stay_in_browser=true' + (browserPrefillsPrompt ? '&q=' + encodedPrompt : '')
    : assistant === 'perplexity' ? 'https://www.perplexity.ai/search'
    : assistant === 'copilot' ? 'https://copilot.cloud.microsoft/'
    : 'https://chatgpt.com/?prompt=' + encoded;
  const appUrl =
    assistant === 'claude' ? 'claude://claude.ai/new?q=' + encoded
    : assistant === 'chatgpt' ? 'codex://new?mode=codex&prompt=' + encoded
    : assistant === 'grok' ? 'xai-grok://'
    : assistant === 'perplexity' ? 'perplexity-desktop://'
    : assistant === 'copilot' ? browserUrl
    : null;
  const mobileAppUrl =
    assistant === 'gemini' ? 'https://gemini.google.com/app/download/mobile'
    : assistant === 'grok' ? 'https://grok.com/' + (browserPrefillsPrompt ? '?q=' + encodedPrompt : '')
    : browserUrl;
  return { assistant, name, browserUrl, appUrl, mobileAppUrl, requiresPaste, browserPrefillsPrompt };
}
