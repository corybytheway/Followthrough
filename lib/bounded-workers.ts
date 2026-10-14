// Created by Cory McCabe
// Bound provider pressure while allowing independent workspaces to progress.
export async function boundedWorkers<T, R>(items: T[], concurrency: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(items.length, Math.max(1, Math.floor(concurrency))) }, async () => {
    while (index < items.length) { const next = index++; results[next] = await work(items[next]); }
  }));
  return results;
}
