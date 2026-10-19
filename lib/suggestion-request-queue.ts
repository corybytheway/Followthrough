// Created by Cory McCabe
/** Keep decisions behind in-flight reads/refreshes without a background busy state. */
export function createSuggestionRequestQueue() {
  let pending: Promise<void> = Promise.resolve();
  return function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(operation);
    // A failed refresh must not prevent a later decision from reaching the server.
    pending = result.then(() => {}, () => {});
    return result;
  };
}
