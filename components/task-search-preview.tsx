// Created by Cory McCabe
import type { ReactNode } from 'react';
import type { Task } from '@/lib/model';
import { normalizedTaskSearch, taskSearchDisplayText, taskSearchExcerpt, taskSearchRanges } from '@/lib/task-search';

export function SearchHighlightedText({ text, query }: { text: string; query: string }) {
  const value = normalizedTaskSearch(query) ? taskSearchDisplayText(text) : text;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const { start, end } of taskSearchRanges(value, query)) {
    if (start > cursor) parts.push(value.slice(cursor, start));
    parts.push(<mark className="task-search-match" key={start}>{value.slice(start, end)}</mark>);
    cursor = end;
  }
  parts.push(value.slice(cursor));
  return <>{parts}</>;
}

export function TaskSearchContext({ task, query }: { task: Task; query: string }) {
  const excerpt = taskSearchExcerpt(task, query);
  if (!excerpt) return null;
  return <span className="task-search-context">
    <span className="task-search-context-label">{excerpt.field}</span>
    <span className="task-search-context-text">
      <SearchHighlightedText text={excerpt.text} query={excerpt.matchingText} />
    </span>
  </span>;
}
