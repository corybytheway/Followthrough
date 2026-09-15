// Created by Cory McCabe
'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import Link from 'next/link';
import {
  ArrowUpRight,
  CalendarDays,
  ListTodo,
  FolderOpen,
  Settings2,
  ArrowRight,
  Plus,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Check,
  Link2,
  Loader2,
  X,
  RotateCcw,
  Download,
  Search,
  MessageSquare,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { BASIC_CAPTURE_NOTICE } from '@/lib/capture-status';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { NativeSelect } from '@/components/ui/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  initialWorkspace,
  taskLabel,
  COLORS,
  minutesLabel,
  type Project,
  type Settings,
  type Snapshot,
  type Task,
} from '@/lib/model';
import { localDay } from '@/lib/scheduler';
import { TOOL_DEFINITIONS, toolAction } from '@/lib/tools';
import ShortcutSettings from '@/components/shortcut-settings';
import CalendarSettings from '@/components/calendar-settings';
import OpenAISettings from '@/components/openai-settings';

type Draft = Partial<Task> & {
  rationale?: string;
  mode?: string;
  steps?: Task['steps'];
};
type Action = Record<string, unknown>;
type Commit = (action: Action) => Promise<Record<string, unknown>>;
const empty: Snapshot = {
  ...initialWorkspace(),
  revision: 0,
  currentDate: '',
  warnings: [],
  integrations: { ai: false, google: false, icloud: false, background: false },
};
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function dayLabel(day: string) {
  return new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export default function FollowthroughApp() {
  const [state, setState] = useState<Snapshot>(empty),
    [loaded, setLoaded] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [tab, setTab] = useState('today'),
    [source, setSource] = useState(''),
    [draft, setDraft] = useState<Draft | null>(null),
    [editing, setEditing] = useState<string | null>(null);
  const [projectDialog, setProjectDialog] = useState(false),
    [editingProject, setEditingProject] = useState<Project | null>(null),
    [busyDialog, setBusyDialog] = useState(false),
    [query, setQuery] = useState(''),
    [projectFilter, setProjectFilter] = useState('all'),
    [statusFilter, setStatusFilter] = useState('active');
  const [day, setDay] = useState(''),
    stateRef = useRef(state),
    busyRef = useRef(false);
  const accept = useCallback((next: Snapshot) => {
    flushSync(() => setState(next));
    stateRef.current = next;
  }, []);
  const refresh = useCallback(async () => {
    const response = await fetch('/api/workspace', { cache: 'no-store' }),
      data = (await response.json()) as Snapshot & { error?: string };
    if (!response.ok)
      throw new Error(data.error || 'Could not load your plan.');
    accept(data);
    return data as Snapshot;
  }, [accept]);
  const commit = useCallback<Commit>(
    async (action) => {
      if (busyRef.current)
        throw new Error('A change is still saving. Try again in a moment.');
      busyRef.current = true;
      setSaving(true);
      setError('');
      try {
        const response = await fetch('/api/workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...action,
            revision: stateRef.current.revision,
            requestId: action.requestId || crypto.randomUUID(),
          }),
        });
        const data = (await response.json()) as {
          state: Snapshot;
          result: Record<string, unknown>;
          error?: string;
        };
        if (!response.ok) {
          if (response.status === 409) await refresh();
          throw new Error(data.error || 'Could not save this change.');
        }
        accept(data.state);
        return data.result;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save.');
        throw e;
      } finally {
        busyRef.current = false;
        setSaving(false);
      }
    },
    [accept, refresh],
  );
  useEffect(() => {
    let live = true;
    refresh()
      .then(async (next) => {
        if (!live) return;
        const location = new URL(window.location.href),
          calendarResult = location.searchParams.get('calendar'),
          requestedTaskId = location.searchParams.get('task');
        if (calendarResult) {
          setTab('settings');
          if (calendarResult === 'connected')
            setNotice(
              'Google connected. Select the calendars that should block task time.',
            );
          else
            setError(
              'Google connection was not completed. Try connecting again in Settings.',
            );
          location.searchParams.delete('calendar');
          history.replaceState(
            null,
            '',
            location.pathname + location.search + location.hash,
          );
        }
        if (requestedTaskId) {
          const requestedTask = next.tasks.find(
            (task) => task.id === requestedTaskId && !task.deletedAt,
          );
          if (requestedTask) {
            setTab('tasks');
            setEditing(requestedTask.id);
          } else {
            location.searchParams.delete('task');
            history.replaceState(
              null,
              '',
              location.pathname + location.search + location.hash,
            );
            setError('This task is no longer available.');
          }
        }

        setDay(localDay(Date.now(), next.settings.timeZone));
        setLoaded(true);
        if (next.tasks.length) await commit({ action: 'replan' });
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [refresh, commit]);
  useEffect(() => {
    if (!loaded) return;
    const location = new URL(window.location.href);
    if (editing) location.searchParams.set('task', editing);
    else location.searchParams.delete('task');
    history.replaceState(
      null,
      '',
      location.pathname + location.search + location.hash,
    );
  }, [editing, loaded]);
  useEffect(() => {
    if (!loaded) return;
    const receiveCapture = () => {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const incoming = fragment.get('capture');
      if (!incoming?.trim()) return;
      setSource(incoming.slice(0, 8000));
      setTab('today');
      setNotice('Text received from Shortcuts. Review the task, then save it.');
      fragment.delete('capture');
      const remaining = fragment.toString();
      history.replaceState(
        null,
        '',
        window.location.pathname +
          window.location.search +
          (remaining ? `#${remaining}` : ''),
      );
    };
    receiveCapture();
    window.addEventListener('hashchange', receiveCapture);
    return () => window.removeEventListener('hashchange', receiveCapture);
  }, [loaded]);
  useEffect(() => {
    if (!loaded) return;
    const update = () => {
      if (document.hidden || busyRef.current) return;
      void fetch('/api/calendars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync' }),
      })
        .then(async (response) => {
          if (response.status === 409) return null;
          if (!response.ok) {
            const data = (await response.json()) as { error?: string };
            setError(
              data.error || 'Calendar sync needs attention in Settings.',
            );
            return null;
          }
          return refresh();
        })
        .then((next) => {
          if (
            next &&
            !busyRef.current &&
            next.tasks.some((task) => task.status === 'ready')
          )
            return commit({ action: 'replan' });
        })
        .catch(() => {});
    };
    const afterCalendarChange = () => {
      void refresh().catch(() => {});
    };
    window.addEventListener('followthrough-calendar-sync', afterCalendarChange);
    update();
    const timer = setInterval(update, 60_000);
    window.addEventListener('focus', update);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', update);
      window.removeEventListener(
        'followthrough-calendar-sync',
        afterCalendarChange,
      );
    };
  }, [loaded, commit, refresh]);
  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: { signal: AbortSignal },
          ) => unknown;
        };
      }
    ).modelContext;
    if (!context?.registerTool || !loaded) return;
    const lifecycle = new AbortController();
    for (const definition of TOOL_DEFINITIONS) {
      const tool = {
        ...definition,
        execute: async (input: unknown) => {
          const action = toolAction(definition.name, input);
          if (!action) {
            const current = await refresh();
            return {
              projects: current.projects,
              tasks: current.tasks.filter((t) => t.status !== 'archived'),
              settings: current.settings,
              blocks: current.blocks,
              warnings: current.warnings,
            };
          }
          const result = await commit(action);
          flushSync(() => {
            setTab(
              definition.name === 'create_followthrough_project'
                ? 'projects'
                : 'tasks',
            );
            setProjectFilter('all');
            setStatusFilter('active');
            setNotice('Followthrough updated.');
          });
          return result;
        },
      };
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {
        /* Browser support is optional. */
      }
    }
    return () => lifecycle.abort();
  }, [loaded, commit, refresh]);
  async function capture() {
    setError('');
    setSaving(true);
    busyRef.current = true;
    try {
      const response = await fetch('/api/capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source }),
        }),
        data = (await response.json()) as Omit<Draft, 'steps'> & {
          steps: string[];
          error?: string;
        };
      if (!response.ok) throw new Error(data.error);
      setDraft({
        ...data,
        steps: (data.steps || []).map((title: string) => ({
          id: crypto.randomUUID(),
          title,
          done: false,
        })),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not prepare a draft.');
    } finally {
      setSaving(false);
      busyRef.current = false;
    }
  }
  const active = state.tasks.filter((t) =>
    ['ready', 'waiting'].includes(t.status),
  );
  const visible = state.tasks.filter(
    (t) =>
      (statusFilter === 'trash'
        ? !!t.deletedAt
        : !t.deletedAt &&
          (statusFilter === 'all' ||
            (statusFilter === 'active'
              ? ['ready', 'waiting'].includes(t.status)
              : t.status === statusFilter))) &&
      (projectFilter === 'all' || t.projectId === projectFilter) &&
      (t.title + ' ' + t.notes + ' ' + t.steps.map((s) => s.title).join(' '))
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  if (statusFilter === 'all') {
    const statusOrder = { ready: 0, waiting: 0, done: 1, archived: 2 };
    visible.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
  }
  const taskById = new Map(state.tasks.map((t) => [t.id, t]));
  const selected = editing
    ? state.tasks.find((t) => t.id === editing)
    : undefined;
  const agenda = [
    ...state.blocks.map((b) => ({
      ...b,
      title: taskLabel(
        taskById.get(b.taskId)?.title || 'Task',
        state.projects.find((p) => p.id === taskById.get(b.taskId)?.projectId)
          ?.name,
      ),
      source: 'task',
    })),
    ...state.busy.map((e) => ({ ...e, taskId: '', source: e.source })),
  ]
    .filter(
      (b) =>
        day &&
        localDay(b.start, state.settings.timeZone) <= day &&
        localDay(Date.parse(b.end) - 1, state.settings.timeZone) >= day,
    )
    .sort((a, b) => a.start.localeCompare(b.start));
  const time = (instant: string) =>
    new Date(instant).toLocaleTimeString('en-US', {
      timeZone: state.settings.timeZone,
      hour: 'numeric',
      minute: '2-digit',
    });
  const shiftDay = (offset: number) =>
    setDay(
      new Date(Date.parse(day + 'T12:00:00Z') + offset * 86400000)
        .toISOString()
        .slice(0, 10),
    );
  const taskRow = (task: Task) => {
    const project = state.projects.find((p) => p.id === task.projectId),
      blocked = task.blockers.some((id) => taskById.get(id)?.status !== 'done'),
      warning = state.warnings.find(
        (w) =>
          w.taskId === task.id && ['deadline', 'capacity'].includes(w.reason),
      );
    const planned = state.blocks.find((block) => block.taskId === task.id);
    return (
      <div
        className={'task-row ' + (task.status === 'done' ? 'completed' : '')}
        key={task.id}
      >
        {!task.deletedAt && (
          <Checkbox
            className="task-completion"
            title={task.status === 'done' ? 'Reopen task' : 'Mark complete'}
            aria-label={
              task.status === 'done'
                ? 'Reopen ' + task.title
                : 'Complete ' + task.title
            }
            checked={task.status === 'done'}
            disabled={saving}
            onCheckedChange={(checked) =>
              void commit({
                action: 'update_task',
                id: task.id,
                task: { status: checked ? 'done' : 'ready' },
              }).catch(() => {})
            }
          />
        )}
        <button className="task-body" onClick={() => setEditing(task.id)}>
          <strong>
            {taskLabel(
              task.title,
              state.projects.find((p) => p.id === task.projectId)?.name,
            )}
          </strong>
          <span className="task-meta">
            {project && (
              <span style={{ color: project.color }}>{project.name}</span>
            )}
            <span>
              {task.estimateProvisional ? '~' : ''}
              {minutesLabel(task.remainingMinutes)}
              {task.estimateProvisional ? ' · temporary estimate' : ''}
            </span>
            {task.steps.length > 0 && (
              <span>
                {task.steps.filter((s) => s.done).length}/{task.steps.length}{' '}
                steps
              </span>
            )}
            {task.dueDate && <span>Due {dayLabel(task.dueDate)}</span>}
            {planned && (
              <span>
                Planned{' '}
                {dayLabel(localDay(planned.start, state.settings.timeZone))} ·{' '}
                {time(planned.start)}
              </span>
            )}
            {blocked && (
              <span className="pill">
                <Link2 size={11} />
                Blocked
              </span>
            )}
            {task.status === 'waiting' && <span className="pill">On hold</span>}

            {task.priority === 'high' && (
              <span className="urgent">High priority</span>
            )}
          </span>
          {warning && <span className="task-warning">{warning.message}</span>}
        </button>
        <ArrowUpRight className="row-arrow" size={17} />
      </div>
    );
  };
  return (
    <main className="app-shell">
      <header className="app-header">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <svg
              width="27"
              height="27"
              viewBox="0 0 64 64"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M37 7 13 36h16l-3 21 25-31H35z" />
            </svg>
          </span>
          Followthrough
        </Link>
        <span className="private-label">
          {saving
            ? 'Saving…'
            : 'The project manager that makes you follow through'}
        </span>
      </header>
      {error && (
        <div className="feedback error" role="alert">
          <span>{error}</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Dismiss error"
            onClick={() => setError('')}
          >
            <X />
          </Button>
        </div>
      )}
      {notice && (
        <output className="feedback">
          <span>{notice}</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Dismiss message"
            onClick={() => setNotice('')}
          >
            <X />
          </Button>
        </output>
      )}
      {!loaded ? (
        <div className="loading-state">
          {error ? (
            <Button
              onClick={() =>
                void refresh()
                  .then(() => setLoaded(true))
                  .catch((e) => setError(e.message))
              }
            >
              Try again
            </Button>
          ) : (
            <>
              <Loader2 className="spin" /> Loading your plan…
            </>
          )}
        </div>
      ) : (
        <Tabs value={tab} onValueChange={setTab} className="workspace-tabs">
          <TabsList variant="line" className="main-tabs">
            <TabsTrigger value="today">
              <CalendarDays />
              Today
            </TabsTrigger>
            <TabsTrigger value="projects">
              <FolderOpen />
              Projects
            </TabsTrigger>
            <TabsTrigger value="tasks">
              <ListTodo />
              Tasks
            </TabsTrigger>
            <TabsTrigger value="settings">
              <Settings2 />
              Settings
            </TabsTrigger>
          </TabsList>
          <TabsContent value="today">
            <div className="page-heading">
              <div>
                <p className="eyebrow">
                  {state.currentDate ? dayLabel(state.currentDate) : ''}
                </p>
                <h1>Your next move.</h1>
              </div>
              <span className="date-label">
                {state.settings.timeZone.replace('_', ' ')}
              </span>
            </div>
            <div className="workspace-grid">
              <section>
                <div className="capture-panel">
                  <label htmlFor="capture">What needs doing?</label>
                  <textarea
                    id="capture"
                    maxLength={8000}
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    placeholder="Fix the booking button on HP Studios, check mobile, and get it live by Friday."
                  />
                  <div className="capture-footer">
                    <span>One outcome. All the steps.</span>
                    <Button
                      className="capture-button"
                      disabled={saving || !source.trim()}
                      onClick={() => void capture()}
                    >
                      {saving ? <Loader2 className="spin" /> : <ArrowUpRight />}
                      Review task
                    </Button>
                  </div>
                </div>
                <div className="section-heading">
                  <h2>Ready when you are</h2>
                  <span>
                    {active.length} {active.length === 1 ? 'task' : 'tasks'}
                  </span>
                </div>
                {active.length ? (
                  <div className="task-list">
                    {[...active]
                      .sort(
                        (a, b) =>
                          (state.blocks.findIndex((v) => v.taskId === a.id) < 0
                            ? 999
                            : state.blocks.findIndex(
                                (v) => v.taskId === a.id,
                              )) -
                          (state.blocks.findIndex((v) => v.taskId === b.id) < 0
                            ? 999
                            : state.blocks.findIndex((v) => v.taskId === b.id)),
                      )
                      .slice(0, 8)
                      .map(taskRow)}
                  </div>
                ) : (
                  <div className="empty-panel">
                    <span className="empty-icon">
                      <ListTodo size={24} />
                    </span>
                    <h3>Start with what’s on your mind.</h3>
                    <p>
                      Capture an outcome above. Its steps stay together, even
                      when the work spans a few days.
                    </p>
                  </div>
                )}
                {active.length > 8 && (
                  <Button variant="link" onClick={() => setTab('tasks')}>
                    View all {active.length} tasks <ArrowRight />
                  </Button>
                )}
                <p className="small-note">
                  {state.integrations.background
                    ? 'Unfinished tasks are replanned every minute, even when Followthrough is closed.'
                    : 'The plan updates every minute while Followthrough is open.'}
                  Check off completed work or adjust its remaining time.
                </p>
              </section>
              <aside className="schedule-panel">
                <div className="section-heading">
                  <h2>Your day</h2>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Replan tasks"
                    disabled={saving}
                    onClick={() =>
                      void commit({ action: 'replan' })
                        .then(() => setNotice('Your plan is up to date.'))
                        .catch(() => {})
                    }
                  >
                    <RotateCcw />
                  </Button>
                </div>
                <div className="day-picker">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Previous day"
                    onClick={() => shiftDay(-1)}
                  >
                    <ChevronLeft />
                  </Button>
                  <input
                    aria-label="Schedule day"
                    type="date"
                    value={day}
                    onChange={(e) => e.target.value && setDay(e.target.value)}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Next day"
                    onClick={() => shiftDay(1)}
                  >
                    <ChevronRight />
                  </Button>
                </div>
                <p className="secondary-text">
                  {state.settings.workStart}–{state.settings.workEnd} ·{' '}
                  {state.settings.timeZone.split('/').pop()?.replace('_', ' ')}
                </p>
                <div className="agenda">
                  {agenda.length ? (
                    agenda.map((event) => (
                      <div
                        className={
                          'agenda-item ' +
                          (event.source === 'task' ? '' : 'busy-event')
                        }
                        key={event.id}
                      >
                        <span className="agenda-time">
                          {time(event.start)}
                          <small>{time(event.end)}</small>
                        </span>
                        {event.taskId ? (
                          <button onClick={() => setEditing(event.taskId)}>
                            <strong>{event.title}</strong>
                            <small>
                              {minutesLabel(
                                (Date.parse(event.end) -
                                  Date.parse(event.start)) /
                                  60000,
                              )}{' '}
                              · work session
                            </small>
                          </button>
                        ) : (
                          <div>
                            <strong>{event.title}</strong>
                            <small>Busy time</small>
                          </div>
                        )}
                        {event.source === 'manual' && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={'Remove ' + event.title}
                            disabled={saving}
                            onClick={() =>
                              void commit({
                                action: 'remove_busy_time',
                                id: event.id,
                              }).catch(() => {})
                            }
                          >
                            <X />
                          </Button>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="agenda-empty">
                      <CalendarDays />
                      <p>No blocks on this day.</p>
                      <span>
                        {active.length
                          ? 'Choose another day to see upcoming work.'
                          : 'Create a task to give it time on your calendar.'}
                      </span>
                    </div>
                  )}
                </div>
                <Button
                  variant="outline"
                  className="full-width"
                  onClick={() => setBusyDialog(true)}
                >
                  <Plus />
                  Block busy time
                </Button>
                <p className="calendar-note">
                  {state.integrations.google || state.integrations.icloud
                    ? 'Manage selected calendars and sync status in Settings.'
                    : 'Connect calendars to avoid appointments automatically.'}
                </p>
                <button
                  className="text-button"
                  onClick={() => setTab('settings')}
                >
                  Calendar connections <ArrowRight size={16} />
                </button>
              </aside>
            </div>
          </TabsContent>
          <TabsContent value="tasks">
            <div className="page-heading">
              <div>
                <h1>Your tasks.</h1>
              </div>
              <Button
                onClick={() =>
                  setDraft({
                    title: '',
                    estimateMinutes: 30,
                    remainingMinutes: 30,
                    steps: [],
                    projectId: projectFilter === 'all' ? null : projectFilter,
                  })
                }
              >
                <Plus />
                New task
              </Button>
            </div>
            <div className="filters">
              <div className="search-field">
                <Search size={17} />
                <Input
                  aria-label="Search tasks"
                  placeholder="Search tasks and steps"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <NativeSelect
                aria-label="Filter project"
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
              >
                <option value="all">All projects</option>
                {state.projects.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                aria-label="Filter status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="active">Active</option>
                <option value="all">All tasks</option>
                <option value="done">Completed</option>
                <option value="archived">Archived</option>
                <option value="trash">Trash</option>
              </NativeSelect>
            </div>
            {visible.length ? (
              <div className="task-list">{visible.map(taskRow)}</div>
            ) : (
              <div className="empty-panel">
                <h3>{query ? 'No matching tasks.' : 'Nothing here yet.'}</h3>
                <p>
                  {query
                    ? 'Try a different search or project.'
                    : 'Capture your next outcome to get started.'}
                </p>
              </div>
            )}
          </TabsContent>
          <TabsContent value="projects">
            <div className="page-heading">
              <div>
                <p className="eyebrow">Apps, clients, and meaningful work</p>
                <h1>Your projects.</h1>
              </div>
              <Button
                onClick={() => {
                  setEditingProject(null);
                  setProjectDialog(true);
                }}
              >
                <Plus />
                New project
              </Button>
            </div>
            <div className="project-grid">
              {state.projects.map((p) => (
                <article className="project-card" key={p.id}>
                  <div className="project-card-heading">
                    <span
                      className="project-icon"
                      style={{ color: p.color, background: p.color + '14' }}
                    >
                      <FolderOpen />
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="project-edit"
                      aria-label={`Edit ${p.name}`}
                      onClick={() => {
                        setEditingProject(p);
                        setProjectDialog(true);
                      }}
                    >
                      Edit
                    </Button>
                  </div>
                  <button
                    type="button"
                    className="project-open"
                    aria-label={`View tasks in ${p.name}`}
                    onClick={() => {
                      setProjectFilter(p.id);
                      setStatusFilter('active');
                      setQuery('');
                      setTab('tasks');
                    }}
                  >
                    <h2>{p.name}</h2>
                    <p>{p.description || 'A home for related work.'}</p>
                    <div className="project-count">
                      {active.filter((t) => t.projectId === p.id).length} active
                      tasks <ArrowRight size={16} />
                    </div>
                  </button>
                </article>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="settings">
            <div className="page-heading">
              <div>
                <h1>Make room for your work.</h1>
              </div>
            </div>
            <SettingsPanel
              state={state}
              commit={commit}
              saving={saving}
              onSaved={() =>
                setNotice('Work hours saved. Your tasks have been rescheduled.')
              }
            />
          </TabsContent>
        </Tabs>
      )}
      <Sheet
        open={!!draft || !!selected}
        onOpenChange={(open) => {
          if (!open && !saving) {
            setDraft(null);
            setEditing(null);
          }
        }}
      >
        <SheetContent className="task-sheet">
          <SheetHeader>
            <SheetTitle>
              {selected ? 'Task details' : 'Review your task'}
            </SheetTitle>
            <SheetDescription>
              {selected
                ? 'One outcome, with every step kept together.'
                : 'Check the outcome, estimate, and steps before saving.'}
            </SheetDescription>
          </SheetHeader>
          {(draft || selected) && (
            <TaskEditor
              key={selected?.id || 'draft'}
              initial={selected || draft!}
              state={state}
              saving={saving}
              onDelete={async () => {
                if (!selected) return;
                await commit({ action: 'delete_task', id: selected.id });
                setEditing(null);
                setNotice(
                  'Task moved to Trash. Restore it from the Trash filter.',
                );
              }}
              onRestore={async () => {
                if (!selected) return;
                await commit({ action: 'restore_task', id: selected.id });
                setEditing(null);
                setNotice('Task restored.');
              }}
              onSave={async (task, requestId) => {
                await commit(
                  selected
                    ? {
                        action: 'update_task',
                        id: selected.id,
                        task,
                        requestId,
                      }
                    : { action: 'create_task', task, requestId },
                );
                setDraft(null);
                setEditing(null);
                setSource('');
                setNotice(
                  selected
                    ? 'Task updated.'
                    : 'Task saved and added to your plan.',
                );
              }}
            />
          )}
        </SheetContent>
      </Sheet>
      <Dialog
        open={projectDialog}
        onOpenChange={(open) => {
          if (!saving) setProjectDialog(open);
        }}
      >
        <DialogContent className="form-dialog">
          <DialogHeader>
            <DialogTitle>
              {editingProject ? 'Edit project' : 'New project'}
            </DialogTitle>
            <DialogDescription>
              A home for related tasks and independent deliverables.
            </DialogDescription>
          </DialogHeader>
          <ProjectForm
            key={editingProject?.id || 'new'}
            initial={
              editingProject || {
                color: COLORS[state.projects.length % COLORS.length],
              }
            }
            saving={saving}
            onCancel={() => setProjectDialog(false)}
            onSave={async (project) => {
              await commit(
                editingProject
                  ? { action: 'update_project', id: editingProject.id, project }
                  : { action: 'create_project', project },
              );
              setProjectDialog(false);
              setNotice(
                editingProject ? 'Project updated.' : 'Project created.',
              );
            }}
          />
        </DialogContent>
      </Dialog>
      <Dialog open={busyDialog} onOpenChange={setBusyDialog}>
        <DialogContent className="form-dialog">
          <DialogHeader>
            <DialogTitle>Block busy time</DialogTitle>
            <DialogDescription>
              Followthrough will schedule tasks around this time. Enter times in
              your device’s local time zone.
            </DialogDescription>
          </DialogHeader>
          <BusyForm
            day={day}
            saving={saving}
            onSave={async (event) => {
              await commit({ action: 'add_busy_time', event });
              setBusyDialog(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </main>
  );
}

function TaskEditor({
  initial,
  state,
  saving,
  onSave,
  onDelete,
  onRestore,
}: {
  initial: Draft;
  state: Snapshot;
  saving: boolean;
  onSave: (task: Action, requestId: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onRestore: () => Promise<void>;
}) {
  const [saveId] = useState(() => crypto.randomUUID());
  const [title, setTitle] = useState(initial.title || ''),
    [projectId, setProjectId] = useState(initial.projectId || ''),
    [notes, setNotes] = useState(initial.notes || ''),
    [steps, setSteps] = useState(initial.steps || []);
  const [estimate, setEstimate] = useState(initial.estimateMinutes || 30),
    [remaining, setRemaining] = useState(
      initial.remainingMinutes || initial.estimateMinutes || 30,
    ),
    [priority, setPriority] = useState(initial.priority || 'medium'),
    [status, setStatus] = useState(initial.status || 'ready'),
    [due, setDue] = useState(initial.dueDate || ''),
    [start, setStart] = useState(initial.notBefore || ''),
    [splittable, setSplittable] = useState(initial.splittable !== false),
    [blockers, setBlockers] = useState(initial.blockers || []),
    [localError, setLocalError] = useState('');
  const [regeneratingTitle, setRegeneratingTitle] = useState(false),
    [titleNotice, setTitleNotice] = useState('');

  async function regenerateTitle() {
    if (!initial.id || !initial.source?.trim()) return;
    setLocalError('');
    setTitleNotice('');
    setRegeneratingTitle(true);
    try {
      const response = await fetch('/api/openai/rename', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: initial.id, preview: true }),
        }),
        result = (await response.json()) as { error?: unknown; title?: unknown };
      if (!response.ok)
        throw new Error(
          typeof result.error === 'string'
            ? result.error
            : 'Could not regenerate the task name.',
        );
      if (typeof result.title !== 'string' || !result.title.trim())
        throw new Error('OpenAI did not return a task name.');
      setTitle(result.title);
      setTitleNotice('New name generated. Save changes to keep it.');
    } catch (e) {
      setLocalError(
        e instanceof Error ? e.message : 'Could not regenerate the task name.',
      );
    } finally {
      setRegeneratingTitle(false);
    }
  }

  async function submit(
    e: { preventDefault: () => void },
    nextStatus = status,
  ) {
    e.preventDefault();
    setLocalError('');
    try {
      await onSave(
        {
          title,
          projectId: projectId || null,
          notes,
          source: initial.source || '',
          captureMode: initial.captureMode,
          steps,
          estimateMinutes: estimate,
          remainingMinutes: remaining,
          priority,
          status: nextStatus,
          dueDate: due || null,
          notBefore: start || null,
          splittable,
          blockers,
          expectedUpdatedAt: initial.updatedAt,
        },
        saveId,
      );
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Could not save.');
    }
  }
  if (initial.deletedAt)
    return (
      <div className="editor-form">
        <h2>
          {taskLabel(
            initial.title || '',
            state.projects.find((p) => p.id === projectId)?.name,
          )}
        </h2>
        <p>
          This task is in Trash. Restore it to return it to its previous status.
        </p>
        <Button
          disabled={saving}
          onClick={() =>
            void onRestore().catch((e) => setLocalError(e.message))
          }
        >
          Restore task
        </Button>
        {localError && (
          <p className="form-error" role="alert">
            {localError}
          </p>
        )}
      </div>
    );
  return (
    <form className="editor-form" onSubmit={(e) => void submit(e)}>
      {initial.id && (
        <Button
          type="button"
          variant="outline"
          disabled={saving || !title.trim()}
          onClick={(e) => void submit(e, status === 'done' ? 'ready' : 'done')}
        >
          <Check /> {status === 'done' ? 'Reopen task' : 'Mark complete'}
        </Button>
      )}
      {((initial.captureMode === 'basic' && initial.estimateProvisional) ||
        initial.rationale) && (
        <div className="draft-note">
          <strong>
            {initial.captureMode === 'ai' ? 'Suggested plan' : 'Basic capture'}
          </strong>
          <p>
            {initial.captureMode === 'basic'
              ? BASIC_CAPTURE_NOTICE
              : initial.rationale}
          </p>
        </div>
      )}
      <Field label="Task name">
        <Input
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="A focused outcome"
        />
      </Field>
      {initial.id && initial.source?.trim() && (
        <div className="task-name-actions">
          <Button
            type="button"
            variant="outline"
            disabled={saving || regeneratingTitle}
            aria-label="Regenerate task name from original input"
            onClick={() => void regenerateTitle()}
          >
            {regeneratingTitle ? (
              <Loader2 className="spin" />
            ) : (
              <RotateCcw />
            )}
            {regeneratingTitle ? 'Regenerating…' : 'Regenerate name'}
          </Button>
          {titleNotice && (
            <small className="secondary-text" role="status">
              {titleNotice}
            </small>
          )}
        </div>
      )}
      <Field label="Project">
        <NativeSelect
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">No project</option>
          {state.projects.map((p) => (
            <option value={p.id} key={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div className="field-row">
        <Field
          label="Estimated minutes"
          hint={
            initial.estimateProvisional
              ? 'Temporary estimate. Saving confirms this duration.'
              : undefined
          }
        >
          <Input
            type="number"
            min={1}
            max={60000}
            required
            value={estimate}
            onChange={(e) => {
              setEstimate(Number(e.target.value));
              if (!initial.id) setRemaining(Number(e.target.value));
            }}
          />
        </Field>
        <Field label="Minutes remaining">
          <Input
            type="number"
            min={1}
            max={60000}
            required
            value={remaining}
            onChange={(e) => setRemaining(Number(e.target.value))}
          />
        </Field>
      </div>
      <div className="field-row">
        <Field label="Priority">
          <NativeSelect
            value={priority}
            onChange={(e) => setPriority(e.target.value as Task['priority'])}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </NativeSelect>
        </Field>
        <Field label="Status">
          <NativeSelect
            value={status}
            onChange={(e) => setStatus(e.target.value as Task['status'])}
          >
            <option value="ready">Ready</option>
            <option value="waiting">On hold</option>
            <option value="done">Complete</option>
            <option value="archived">Archived</option>
          </NativeSelect>
        </Field>
      </div>
      <div className="field-row">
        <Field
          label="Deadline (optional)"
          hint="Leave empty for automatic planning. Planned times can move; a deadline is a commitment."
        >
          <Input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </Field>
        <Field label="Start on or after">
          <Input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </Field>
      </div>
      <div className="check-field">
        <Checkbox
          id="multiple-sessions"
          checked={splittable}
          onCheckedChange={setSplittable}
        />
        <label htmlFor="multiple-sessions">
          Allow multiple work sessions
          <small>Still one task, even across several days.</small>
        </label>
      </div>
      <div className="editor-section">
        <div className="section-heading">
          <h2>Steps to complete it</h2>
          <span>
            {steps.filter((s) => s.done).length}/{steps.length}
          </span>
        </div>
        <p className="secondary-text">
          Supporting actions stay here as a checklist.
        </p>
        <div className="steps-list">
          {steps.map((step, i) => (
            <div className="step-row" key={step.id}>
              <Checkbox
                aria-label={'Complete step ' + (i + 1)}
                checked={step.done}
                onCheckedChange={(done) =>
                  setSteps(
                    steps.map((s) => (s.id === step.id ? { ...s, done } : s)),
                  )
                }
              />
              <Input
                aria-label={'Step ' + (i + 1)}
                required
                maxLength={500}
                value={step.title}
                onChange={(e) =>
                  setSteps(
                    steps.map((s) =>
                      s.id === step.id ? { ...s, title: e.target.value } : s,
                    ),
                  )
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={'Remove step ' + (i + 1)}
                onClick={() => setSteps(steps.filter((s) => s.id !== step.id))}
              >
                <X />
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={steps.length >= 50}
          onClick={() =>
            setSteps([
              ...steps,
              { id: crypto.randomUUID(), title: '', done: false },
            ])
          }
        >
          <Plus />
          Add step
        </Button>
      </div>
      <div className="field">
        <span>Prerequisites</span>
        <small>
          These tasks must be completed before this one gets time on the
          calendar.
        </small>
        <div className="dependency-list">
          {state.tasks
            .filter(
              (t) =>
                t.id !== initial.id &&
                t.status !== 'archived' &&
                t.status !== 'done' &&
                !t.deletedAt,
            )
            .map((t) => (
              <div className="check-field" key={t.id}>
                <Checkbox
                  id={'dep-' + t.id}
                  checked={blockers.includes(t.id)}
                  onCheckedChange={(checked) =>
                    setBlockers(
                      checked
                        ? [...blockers, t.id]
                        : blockers.filter((id) => id !== t.id),
                    )
                  }
                />
                <label htmlFor={'dep-' + t.id}>
                  {taskLabel(
                    t.title,
                    state.projects.find((p) => p.id === t.projectId)?.name,
                  )}
                </label>
              </div>
            ))}
          {!state.tasks.some(
            (t) =>
              t.id !== initial.id &&
              t.status !== 'archived' &&
              t.status !== 'done' &&
              !t.deletedAt,
          ) && <p className="secondary-text">No unfinished tasks available.</p>}
        </div>
      </div>
      <Field label="Notes">
        <Textarea
          rows={3}
          maxLength={10000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Details, links, or a definition of done"
        />
      </Field>
      {initial.source && (
        <details className="original-request">
          <summary>Original input</summary>
          <p>{initial.source}</p>
        </details>
      )}
      {localError && (
        <p className="form-error" role="alert">
          {localError}
        </p>
      )}
      <div className="editor-footer">
        <Button
          type="submit"
          className="full-width"
          disabled={saving || !title.trim()}
        >
          {saving ? <Loader2 className="spin" /> : <Check />}
          {initial.id ? 'Save changes' : 'Create task'}
        </Button>
        {initial.id && (
          <Button
            type="button"
            variant="outline"
            className="delete-task-button full-width"
            disabled={saving}
            onClick={() =>
              void onDelete().catch((e) => setLocalError(e.message))
            }
          >
            Delete task
          </Button>
        )}
      </div>
    </form>
  );
}
function ProjectForm({
  initial,
  saving,
  onCancel,
  onSave,
}: {
  initial: Partial<Project>;
  saving: boolean;
  onCancel: () => void;
  onSave: (project: Partial<Project>) => Promise<void>;
}) {
  const [name, setName] = useState(initial.name || ''),
    [color, setColor] = useState(initial.color || COLORS[0]),
    [aliases, setAliases] = useState(initial.aliases?.join(', ') || ''),
    [error, setError] = useState('');
  return (
    <form
      className="editor-form"
      onSubmit={(e) => {
        e.preventDefault();
        setError('');
        void onSave({
          name,
          color,
          aliases: aliases
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        }).catch((e) => setError(e.message));
      }}
    >
      <Field label="Project name">
        <Input
          required
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Project color">
        <span className="project-color-field">
          <Input
            type="color"
            className="project-color-input"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
          <span>{color.toUpperCase()}</span>
        </span>
      </Field>
      <Field
        label="Other names"
        hint="Separate aliases with commas, such as MetaNote, Meta Note."
      >
        <Input value={aliases} onChange={(e) => setAliases(e.target.value)} />
      </Field>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="project-form-actions">
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={saving || !name.trim()}>
          {saving && <Loader2 className="spin" />}
          {initial.id ? 'Save changes' : 'Create project'}
        </Button>
      </div>
    </form>
  );
}
function BusyForm({
  day,
  saving,
  onSave,
}: {
  day: string;
  saving: boolean;
  onSave: (event: Action) => Promise<void>;
}) {
  const [title, setTitle] = useState(''),
    [start, setStart] = useState(day + 'T10:00'),
    [end, setEnd] = useState(day + 'T11:00'),
    [error, setError] = useState('');
  return (
    <form
      className="editor-form"
      onSubmit={(e) => {
        e.preventDefault();
        setError('');
        if (!start || !end || Date.parse(end) <= Date.parse(start)) {
          setError('End time must be after start time.');
          return;
        }
        void onSave({
          title,
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
        }).catch((e) => setError(e.message));
      }}
    >
      <Field label="Busy time name">
        <Input
          value={title}
          required
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Client session, appointment, or time off"
        />
      </Field>
      <Field label="Starts">
        <Input
          required
          type="datetime-local"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
      </Field>
      <Field label="Ends">
        <Input
          required
          type="datetime-local"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
        />
      </Field>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" disabled={saving || !title.trim()}>
        Block time
      </Button>
    </form>
  );
}
function SettingsPanel({
  state,
  commit,
  saving,
  onSaved,
}: {
  state: Snapshot;
  commit: Commit;
  saving: boolean;
  onSaved: () => void;
}) {
  const [settings, setSettings] = useState<Settings>(state.settings),
    [error, setError] = useState('');
  const update = (key: keyof Settings, value: unknown) =>
    setSettings((s) => ({ ...s, [key]: value }));
  return (
    <div className="settings-grid">
      <form
        className="settings-card editor-form"
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          void commit({ action: 'update_settings', settings })
            .then(onSaved)
            .catch((e) => setError(e.message));
        }}
      >
        <h2>Work hours</h2>
        <p className="secondary-text">
          Your initial hours match Motion. Change them anytime.
        </p>
        <Field label="Time zone">
          <Input
            list="time-zones"
            value={settings.timeZone}
            onChange={(e) => update('timeZone', e.target.value)}
          />
          <datalist id="time-zones">
            {[
              'America/Chicago',
              'America/New_York',
              'America/Denver',
              'America/Los_Angeles',
              'Europe/London',
              'UTC',
            ].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </datalist>
        </Field>
        <div className="field-row">
          <Field label="Start">
            <Input
              required
              type="time"
              value={settings.workStart}
              onChange={(e) => update('workStart', e.target.value)}
            />
          </Field>
          <Field label="End">
            <Input
              required
              type="time"
              value={settings.workEnd}
              onChange={(e) => update('workEnd', e.target.value)}
            />
          </Field>
        </div>
        <fieldset className="work-days">
          <legend>Work days</legend>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
            <label
              key={d}
              className={settings.workDays.includes(i) ? 'selected' : ''}
            >
              <input
                type="checkbox"
                checked={settings.workDays.includes(i)}
                onChange={(e) =>
                  update(
                    'workDays',
                    e.target.checked
                      ? [...settings.workDays, i]
                      : settings.workDays.filter((n) => n !== i),
                  )
                }
              />
              {d}
            </label>
          ))}
        </fieldset>
        <Field label="Longest work session">
          <NativeSelect
            value={settings.maxBlockMinutes}
            onChange={(e) => update('maxBlockMinutes', Number(e.target.value))}
          >
            {[30, 45, 60, 90, 120, 180, 240].map((n) => (
              <option key={n} value={n}>
                {minutesLabel(n)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <div className="field-row">
          <Field label="Break after">
            <NativeSelect
              value={settings.breakEveryMinutes}
              onChange={(e) =>
                update('breakEveryMinutes', Number(e.target.value))
              }
            >
              {[60, 90, 120, 180, 240, 300].map((n) => (
                <option key={n} value={n}>
                  {minutesLabel(n)} of work
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Break length">
            <NativeSelect
              value={settings.breakMinutes}
              onChange={(e) => update('breakMinutes', Number(e.target.value))}
            >
              {[0, 15, 30, 45, 60].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? 'No break' : minutesLabel(n)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" disabled={saving}>
          Save work hours
        </Button>
      </form>
      <div className="connections">
        <CalendarSettings />
        <OpenAISettings />
        <div className="settings-card">
          <MessageSquare />
          <h2>Chat capture</h2>
          <span className="status-label">
            {state.integrations.ai
              ? 'AI capture connected'
              : 'AI capture needs setup'}
          </span>
          <p>
            With Followthrough open in Codex, say “Create a Followthrough task…”
            and include the outcome. The app exposes task and project actions to
            supported assistants.
          </p>
          <p>
            Typing here creates a basic draft until the app’s AI connection is
            configured.
          </p>
        </div>
        <ShortcutSettings />
        <div className="settings-card">
          <Clock3 />
          <h2>Automatic replanning</h2>
          <span className="status-label">
            {state.integrations.background
              ? 'Active even when the app is closed'
              : 'Active while the app is open'}
          </span>
          <p>
            Ready tasks get available time around your calendars, deadlines,
            priorities, and prerequisites. No deadline is required. Unfinished
            tasks move into future work hours without being marked complete.
            Calendar connections shows the status of background updates.
          </p>
          <Link
            download
            prefetch={false}
            className="download-link"
            href="/api/export?format=json"
          >
            <Download size={16} />
            Export your Followthrough data
          </Link>
        </div>
      </div>
    </div>
  );
}
