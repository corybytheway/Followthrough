// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function moduleExports(file: string, dependencies: Record<string, unknown>) {
  const output = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, any> = {};
  // Execute the real module with isolated provider/persistence boundaries.
  // eslint-disable-next-line no-implied-eval
  new Function('require', 'exports', output)((name: string) => dependencies[name] ?? {}, exports);
  return exports;
}

void test('JSON export retains stored suggestion data when the pilot is disabled or assigned to another owner', async () => {
  for (const config of [
    { SUGGESTIONS_PILOT_ENABLED: 'false', CALENDAR_BACKGROUND_OWNER_ID: 'owner' },
    { SUGGESTIONS_PILOT_ENABLED: 'true', CALENDAR_BACKGROUND_OWNER_ID: 'other' },
  ]) {
    const state = { items: [{ id: 'pending' }], feedback: { pattern: { vote: 'less' } }, gmail: { enabled: true } };
    const suppression = { suggestion_id: 'dismissed', state: 'dismissed', accepted_task_ids: '[]', expires_at: Date.now() + 10000 };
    const store = moduleExports('../lib/suggestion-store.ts', {
      'cloudflare:workers': { env: { DB: { prepare(sql: string) {
        return { bind(owner: string) { return {
          first: async () => owner === 'owner' ? { payload: JSON.stringify(state) } : null,
          all: async () => ({ results: owner === 'owner' && sql.includes('suppressions') ? [suppression] : [] }),
        }; } };
      } } } },
      './calendar-store': { calendarConfig: () => config },
      './calendar-security': { unseal: async (payload: string, _key: string, context: string) => {
        assert.equal(context, 'suggestions:owner');
        return JSON.parse(payload);
      } },
    });
    assert.equal(store.suggestionsAvailable('owner'), false);
    assert.equal(await store.exportSuggestionData('other'), null);
    const route = moduleExports('../app/api/export/route.ts', {
      '@/lib/http': { requireOwner: async () => 'owner', fail: (error: unknown) => { throw error; } },
      '@/lib/store': { snapshot: async () => ({ tasks: [], blocks: [] }) },
      '@/lib/suggestion-store': store,
    });
    const response = await route.GET(new Request('http://localhost/api/export'));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).suggestionData, { ...state, suppressions: [suppression] });
  }
});
