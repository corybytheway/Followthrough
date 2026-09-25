// Created by Cory McCabe
import type { CalendarConnection } from './calendar-model';

export type BackgroundRow = { owner_id: string; document: string };

export function dueCalendarOwners(
  rows: BackgroundRow[],
  now = Date.now(),
  limit = 2,
): string[] {
  return rows
    .flatMap((row) => {
      try {
        const connection = JSON.parse(row.document) as CalendarConnection;
        if (!connection.syncEnabled) return [];
        const attempted = Date.parse(connection.lastBackgroundAttempt || '');
        if (
          Number.isFinite(attempted) &&
          now >= attempted &&
          now - attempted < 45_000
        )
          return [];
        return [{ owner: row.owner_id, attempted: attempted || 0 }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.attempted - b.attempted)
    .slice(0, limit)
    .map((row) => row.owner);
}
