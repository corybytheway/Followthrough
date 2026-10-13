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
import { resolveTaskReference, taskReference } from '@/lib/task-reference';
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
  newAccountWorkspace,
  taskLabel,
  projectShortName,
  suggestProjectShortName,
  COLORS,
  minutesLabel,
  type Project,
  type Settings,
  type Snapshot,
  type Task,
} from '@/lib/model';
import { localDay } from '@/lib/scheduler';
import { createPlanRefresh, PLAN_REFRESH_INTERVAL } from '@/lib/plan-refresh';
import {
  completedTaskComparator,
  scheduledTaskComparator,
} from '@/lib/task-order';
import { tasksAvailableToday } from '@/lib/task-availability';
import { TOOL_DEFINITIONS, toolAction } from '@/lib/tools';
import ShortcutSettings from '@/components/shortcut-settings';
import CalendarSettings from '@/components/calendar-settings';
import OpenAISettings from '@/components/openai-settings';
import EmailCaptureSettings from '@/components/email-capture-settings';
import AccountDataSettings from '@/components/account-data-settings';
import CodexSettings from '@/components/codex-settings';

type Draft = Partial<Task> & {
  rationale?: string;
  mode?: string;
  steps?: Task['steps'];
};
type Action = Record<string, unknown>;

const COMPLETION_CHECK_SETTLE_MS = 340;
const COMPLETION_COLLAPSE_SETTLE_MS = 380;
type Commit = (action: Action) => Promise<Record<string, unknown>>;
const empty: Snapshot = {
  ...newAccountWorkspace(),
  revision: 0,
  currentDate: '',
  warnings: [],
  integrations: {
    ai: false,
    google: false,
    icloud: false,
    zoho: false,
    background: false,
    email: { connected: false, address: '', allowedSenders: [] },
    emailSetupAvailable: false,
  },
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
function randomCaptureId() {
  return (
    'capture_' +
    Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('')
  );
}

export type WorkspaceTab = 'today' | 'projects' | 'tasks' | 'settings';

const TAB_PATHS: Record<WorkspaceTab, string> = {
  today: '/today',
  projects: '/projects',
  tasks: '/tasks',
  settings: '/settings',
};

function workspaceTabFromPath(pathname: string): WorkspaceTab {
  const section = pathname.split('/').filter(Boolean)[0];
  return section === 'projects' || section === 'tasks' || section === 'settings'
    ? section
    : 'today';
}

function compareProjectsByName(a: Project, b: Project) {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

export default function FollowthroughApp({
  initialTab = 'today',
  userEmail,
}: {
  initialTab?: WorkspaceTab;
  userEmail?: string;
}) {
  const [state, setState] = useState<Snapshot>(empty),
    [loaded, setLoaded] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [tab, setTab] = useState<WorkspaceTab>(initialTab),
    [source, setSource] = useState(''),
    [draft, setDraft] = useState<Draft | null>(null),
    [captureDrafts, setCaptureDrafts] = useState<Draft[]>([]),
    [captureIndex, setCaptureIndex] = useState(0),
    [captureGroupId, setCaptureGroupId] = useState(''),
    [editing, setEditing] = useState<string | null>(null);
  const [projectDialog, setProjectDialog] = useState(false),
    [editingProject, setEditingProject] = useState<Project | null>(null),
    [busyDialog, setBusyDialog] = useState(false),
    [query, setQuery] = useState(''),
    [projectFilter, setProjectFilter] = useState('all'),
    [statusFilter, setStatusFilter] = useState('active');
  const [day, setDay] = useState(''),
    [completionPhases, setCompletionPhases] = useState<
      Record<string, 'checking' | 'collapsing'>
    >({}),
    stateRef = useRef(state),
    busyRef = useRef(false),
    completingRef = useRef(new Set<string>());
  const navigateToTab = useCallback(
    (nextTab: WorkspaceTab, mode: 'push' | 'replace' = 'push') => {
      setTab(nextTab);
      const location = new URL(window.location.href);
      location.pathname = TAB_PATHS[nextTab];
      if (nextTab !== 'tasks') location.searchParams.delete('task');
      const nextUrl = location.pathname + location.search + location.hash;
      const currentUrl =
        window.location.pathname +
        window.location.search +
        window.location.hash;
      if (nextUrl === currentUrl) return;
      if (mode === 'replace') history.replaceState(null, '', nextUrl);
      else history.pushState(null, '', nextUrl);
    },
    [],
  );
  const navigateToCapture = useCallback(() => {
    setTab('today');
    const nextUrl = '/today#capture';
    const currentUrl =
      window.location.pathname + window.location.search + window.location.hash;
    if (nextUrl !== currentUrl) history.pushState(null, '', nextUrl);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById('capture')?.focus();
      });
    });
  }, []);
  const accept = useCallback((next: Snapshot) => {
    if (next.revision < stateRef.current.revision) return;
    stateRef.current = next;
    flushSync(() => setState(next));
  }, []);
  const refresh = useCallback(async (canAccept: () => boolean = () => true) => {
    const response = await fetch('/api/workspace', { cache: 'no-store' }),
      data = (await response.json()) as Snapshot & { error?: string };
    if (!response.ok)
      throw new Error(data.error || 'Could not load your plan.');
    if (canAccept()) accept(data);
    return data as Snapshot;
  }, [accept]);
  const commit = useCallback<Commit>(
    async (action) => {
      if (busyRef.current)
        throw new Error('A change is still saving. Try again in a moment.');
      busyRef.current = true;
      setSaving(true);
      setError('');
      let changed = false;
      try {
        const requestId =
          typeof action.requestId === 'string'
            ? action.requestId
            : crypto.randomUUID();
        for (let attempt = 0; attempt < 3; attempt++) {
          const response = await fetch('/api/workspace', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...action,
              revision: stateRef.current.revision,
              requestId,
            }),
          });
          const data = (await response.json()) as {
            state: Snapshot;
            result: Record<string, unknown>;
            error?: string;
          };
          if (response.ok) {
            accept(data.state);
            changed = true;
            return data.result;
          }
          if (response.status === 409 && attempt < 2) {
            await refresh();
            continue;
          }
          throw new Error(data.error || 'Could not save this change.');
        }
        throw new Error('Could not save this change.');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save.');
        throw e;
      } finally {
        busyRef.current = false;
        setSaving(false);
        if (changed)
          window.dispatchEvent(new Event('followthrough-workspace-change'));
      }
    },
    [accept, refresh],
  );
  useEffect(() => {
    let live = true;
    refresh()
      .then((next) => {
        if (!live) return;
        const location = new URL(window.location.href),
          calendarResult = location.searchParams.get('calendar'),
          requestedTaskId = location.searchParams.get('task');
        let destination = workspaceTabFromPath(location.pathname);
        if (calendarResult) {
          destination = 'settings';
          if (calendarResult === 'connected')
            setNotice(
              'Google connected. Select the calendars that should block task time.',
            );
          else
            setError(
              'Google connection was not completed. Try connecting again in Settings.',
            );
          location.searchParams.delete('calendar');
        }
        if (requestedTaskId) {
          const requestedTask = resolveTaskReference(next.tasks, requestedTaskId);
          if (requestedTask) {
            setEditing(requestedTask.id);
          } else {
            location.searchParams.delete('task');
            setError('This task is no longer available.');
          }
        }

        setTab(destination);
        location.pathname = TAB_PATHS[destination];
        history.replaceState(
          null,
          '',
          location.pathname + location.search + location.hash,
        );

        setDay(localDay(Date.now(), next.settings.timeZone));
        setLoaded(true);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [refresh]);
  useEffect(() => {
    if (!loaded) return;
    const location = new URL(window.location.href);
    if (editing) {
      location.searchParams.set('task', taskReference(editing));
    } else location.searchParams.delete('task');
    history.replaceState(
      null,
      '',
      location.pathname + location.search + location.hash,
    );
  }, [editing, loaded]);
  useEffect(() => {
    if (!loaded) return;
    const syncFromHistory = () => {
      const nextTab = workspaceTabFromPath(window.location.pathname);
      setTab(nextTab);
      const requestedTaskId = new URL(window.location.href).searchParams.get(
        'task',
      );
      if (!requestedTaskId) setEditing(null);
      else {
        const task = resolveTaskReference(stateRef.current.tasks, requestedTaskId);
        setEditing(task?.id ?? null);
      }
    };
    window.addEventListener('popstate', syncFromHistory);
    return () => window.removeEventListener('popstate', syncFromHistory);
  }, [loaded]);
  useEffect(() => {
    if (!loaded) return;
    const receiveCapture = () => {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const incoming = fragment.get('capture');
      if (!incoming?.trim()) return;
      setSource(incoming.slice(0, 8000));
      navigateToTab('today', 'replace');
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
  }, [loaded, navigateToTab]);
  useEffect(() => {
    if (!loaded) return;
    let live = true;
    const canRun = () =>
      live &&
      !document.hidden &&
      !busyRef.current &&
      completingRef.current.size === 0;
    const updates = createPlanRefresh({
      canRun,
      refresh: () => refresh(canRun),
      syncCalendars: async () => {
        const response = await fetch('/api/calendars', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'sync' }),
        });
        // An existing background sync will publish its result; keep reading
        // the workspace even while that operation holds the calendar lock.
        if (response.status === 409) return;
        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          throw new Error(
            data.error || 'Calendar sync needs attention in Settings.',
          );
        }
      },
      onError: (error) =>
        setError(
          error instanceof Error ? error.message : 'Could not update your plan.',
        ),
    });
    const changed = () => updates.changed();
    const visible = () => {
      if (!document.hidden) updates.changed();
    };
    window.addEventListener('followthrough-calendar-sync', changed);
    window.addEventListener('followthrough-workspace-change', changed);
    window.addEventListener('focus', changed);
    document.addEventListener('visibilitychange', visible);
    updates.tick();
    const timer = setInterval(() => updates.tick(), PLAN_REFRESH_INTERVAL);
    return () => {
      live = false;
      updates.stop();
      clearInterval(timer);
      window.removeEventListener('followthrough-calendar-sync', changed);
      window.removeEventListener('followthrough-workspace-change', changed);
      window.removeEventListener('focus', changed);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [loaded, refresh]);
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
          const destination =
            definition.name === 'create_followthrough_project'
              ? 'projects'
              : 'tasks';
          flushSync(() => {
            setProjectFilter('all');
            setStatusFilter('active');
            setNotice('Followthrough updated.');
          });
          navigateToTab(destination);
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
  }, [loaded, commit, refresh, navigateToTab]);
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
        data = (await response.json()) as {
          drafts?: Array<
            Omit<Draft, 'steps'> & {
              steps: string[];
            }
          >;
          error?: string;
        };
      if (!response.ok) throw new Error(data.error);
      if (!data.drafts?.length)
        throw new Error('The capture did not return any tasks.');
      setDraft(null);
      setCaptureDrafts(
        data.drafts.map((item) => ({
          ...item,
          steps: (item.steps || []).map((title: string) => ({
            id: crypto.randomUUID(),
            title,
            done: false,
          })),
        })),
      );
      setCaptureIndex(0);
      setCaptureGroupId(randomCaptureId());
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
  const availableToday = tasksAvailableToday(state.tasks, state.currentDate);
  const projectsAlphabetically = [...state.projects].sort(
    compareProjectsByName,
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
      (projectFilter === 'all' ||
        (projectFilter === 'none'
          ? t.projectId === null
          : t.projectId === projectFilter)) &&
      (t.title + ' ' + t.notes + ' ' + t.steps.map((s) => s.title).join(' '))
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const compareBySchedule = scheduledTaskComparator(state.blocks);
  if (statusFilter === 'active') {
    visible.sort(compareBySchedule);
  } else if (statusFilter === 'done') {
    visible.sort(completedTaskComparator);
  } else if (statusFilter === 'all') {
    const statusOrder = { ready: 0, waiting: 0, done: 1, archived: 2 };
    visible.sort((a, b) => {
      const statusDifference = statusOrder[a.status] - statusOrder[b.status];
      if (statusDifference) return statusDifference;
      if (['ready', 'waiting'].includes(a.status)) {
        return compareBySchedule(a, b);
      }
      if (a.status === 'done') return completedTaskComparator(a, b);
      return 0;
    });
  }
  const taskById = new Map(state.tasks.map((t) => [t.id, t]));
  const selected = editing
    ? state.tasks.find((t) => t.id === editing)
    : undefined;
  const captureDraft = captureDrafts[captureIndex];
  function closeTaskEditor() {
    setDraft(null);
    setCaptureDrafts([]);
    setCaptureIndex(0);
    setCaptureGroupId('');
    setEditing(null);
  }
  function openTask(taskId: string) {
    setEditing(taskId);
  }
  const agenda = [
    ...state.blocks.map((b) => ({
      ...b,
      title: taskLabel(
        taskById.get(b.taskId)?.title || 'Task',
        state.projects.find((p) => p.id === taskById.get(b.taskId)?.projectId),
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
  const setTaskCompletion = async (task: Task, complete: boolean) => {
    if (!complete || task.status === 'done') {
      await commit({
        action: 'update_task',
        id: task.id,
        task: { status: complete ? 'done' : 'ready' },
      });
      return;
    }
    if (completingRef.current.has(task.id)) return;
    completingRef.current.add(task.id);
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    try {
      setCompletionPhases((current) => ({
        ...current,
        [task.id]: 'checking',
      }));
      if (!reducedMotion)
        await new Promise((resolve) =>
          window.setTimeout(resolve, COMPLETION_CHECK_SETTLE_MS),
        );
      setCompletionPhases((current) => ({
        ...current,
        [task.id]: 'collapsing',
      }));
      if (!reducedMotion)
        await new Promise((resolve) =>
          window.setTimeout(resolve, COMPLETION_COLLAPSE_SETTLE_MS),
        );
      await commit({
        action: 'update_task',
        id: task.id,
        task: { status: 'done' },
      });
    } finally {
      completingRef.current.delete(task.id);
      setCompletionPhases((current) => {
        const next = { ...current };
        delete next[task.id];
        return next;
      });
    }
  };
  const taskRow = (task: Task) => {
    const project = state.projects.find((p) => p.id === task.projectId),
      blocked = task.blockers.some((id) => taskById.get(id)?.status !== 'done'),
      warning = state.warnings.find(
        (w) =>
          w.taskId === task.id && ['deadline', 'capacity'].includes(w.reason),
      );
    const planned = state.blocks.find((block) => block.taskId === task.id),
      completionPhase = completionPhases[task.id];
    return (
      <div
        className={
          'task-row-shell ' +
          (completionPhase === 'collapsing' ? 'collapsing' : '')
        }
        key={task.id}
      >
        <div
          className={
            'task-row ' +
            (task.status === 'done' ? 'completed ' : '') +
            (completionPhase ? 'completing' : '')
          }
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
              checked={task.status === 'done' || Boolean(completionPhase)}
              disabled={saving && !completionPhase}
              onCheckedChange={(checked) =>
                void setTaskCompletion(task, checked === true).catch(() => {})
              }
            />
          )}
          <button className="task-body" onClick={() => openTask(task.id)}>
            <strong>{taskLabel(task.title, project)}</strong>
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
              {task.status === 'waiting' && (
                <span className="pill">On hold</span>
              )}

              {(task.priority === 'high' || task.priority === 'top') && (
                <span className="urgent" data-priority={task.priority}>
                  {task.priority === 'top' ? 'Top' : 'High'} priority
                </span>
              )}
            </span>
            {warning && <span className="task-warning">{warning.message}</span>}
          </button>
          <ArrowUpRight className="row-arrow" size={17} />
        </div>
      </div>
    );
  };

  const feedbackMessages = (
    <>
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
    </>
  );

  return (
    <main className="app-shell">
      <header className="app-header">
        <Link href="/today" className="brand">
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
      {!loaded ? (
        <>
          {feedbackMessages}
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
        </>
      ) : (
        <Tabs
          value={tab}
          onValueChange={(value) => navigateToTab(value as WorkspaceTab)}
          className="workspace-tabs"
        >
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
          <div className="feedback-layer">{feedbackMessages}</div>
          <TabsContent value="today">
            <div className="page-heading">
              <div>
                <p className="eyebrow">
                  {state.currentDate ? dayLabel(state.currentDate) : ''}
                </p>
              </div>
              <span className="date-label">
                {state.settings.timeZone.replace('_', ' ')}
              </span>
            </div>
            {state.projects.length === 0 && state.tasks.length === 0 && (
              <div className="empty-panel beta-welcome">
                <h2>Set up your workspace</h2>
                <p>
                  Choose your local time zone and work hours, then connect your
                  Google Calendar in Settings. Your tasks and calendar
                  connections stay in your own account.
                </p>
                <Button
                  variant="outline"
                  onClick={() => navigateToTab('settings')}
                >
                  Set work hours and calendar <ArrowRight />
                </Button>
              </div>
            )}
            <div className="workspace-grid">
              <section>
                <div className="capture-panel">
                  <label htmlFor="capture">What do you need to do?</label>
                  <textarea
                    id="capture"
                    maxLength={8000}
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    placeholder="I need to reply to Samuel's email, edit a view that'll take 4 hours, but the top priority is fix the faucet leak downstairs which should take about 1.5 hours."
                  />
                  <div className="capture-footer">
                    <span>One request. Every independent outcome.</span>
                    <Button
                      className="capture-button"
                      disabled={saving || !source.trim()}
                      onClick={() => void capture()}
                    >
                      {saving ? <Loader2 className="spin" /> : <ArrowUpRight />}
                      Review plan
                    </Button>
                  </div>
                </div>
                <div className="section-heading">
                  <h2>Followthrough on these first</h2>
                  <span>
                    {availableToday.length}{' '}
                    {availableToday.length === 1 ? 'task' : 'tasks'}
                  </span>
                </div>
                {availableToday.length ? (
                  <div className="task-list">
                    {[...availableToday]
                      .sort(compareBySchedule)
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
                {availableToday.length > 8 && (
                  <Button variant="link" onClick={() => navigateToTab('tasks')}>
                    View all {availableToday.length} available tasks{' '}
                    <ArrowRight />
                  </Button>
                )}
                <p className="small-note">
                  {state.integrations.background
                    ? 'Your plan updates automatically. Calendar changes are checked every minute, even when Followthrough is closed.'
                    : 'Your plan updates automatically while Followthrough is open.'}
                  {' '}Check off completed work or adjust its remaining time.
                </p>
              </section>
              <aside className="schedule-panel">
                <div className="section-heading">
                  <h2>Your day</h2>
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
                          <button onClick={() => openTask(event.taskId)}>
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
                  {state.integrations.google ||
                  state.integrations.icloud ||
                  state.integrations.zoho
                    ? 'Manage selected calendars and sync status in Settings.'
                    : 'Connect calendars to avoid appointments automatically.'}
                </p>
                <button
                  className="text-button"
                  onClick={() => navigateToTab('settings')}
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
              <Button onClick={navigateToCapture}>
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
                <option value="none">No Project</option>
                {projectsAlphabetically.map((p) => (
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
              {projectsAlphabetically.map((p) => (
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
                      navigateToTab('tasks');
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
              userEmail={userEmail}
              onSaved={() =>
                setNotice('Work hours saved. Your tasks have been rescheduled.')
              }
            />
          </TabsContent>
        </Tabs>
      )}
      <Sheet
        open={!!draft || !!captureDraft || !!selected}
        onOpenChange={(open) => {
          if (!open && !saving) closeTaskEditor();
        }}
      >
        <SheetContent className="task-sheet">
          <SheetHeader>
            <SheetTitle>
              {selected
                ? 'Task details'
                : captureDrafts.length > 1
                  ? `Review task ${captureIndex + 1} of ${captureDrafts.length}`
                  : 'Review your task'}
            </SheetTitle>
            <SheetDescription>
              {selected
                ? 'One outcome, with every step kept together.'
                : captureDrafts.length > 1
                  ? 'Each independent outcome will become its own task. Nothing is saved until you finish reviewing the group.'
                  : 'Check the outcome, estimate, and steps before saving.'}
            </SheetDescription>
          </SheetHeader>
          {(draft || captureDraft || selected) && (
            <TaskEditor
              key={
                selected?.id ||
                (captureDraft ? `capture-${captureIndex}` : 'draft')
              }
              initial={selected || captureDraft || draft!}
              state={state}
              saving={saving}
              saveLabel={
                captureDrafts.length > 1
                  ? captureIndex < captureDrafts.length - 1
                    ? 'Review next task'
                    : `Save ${captureDrafts.length} tasks`
                  : undefined
              }
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
                if (selected) {
                  await commit({
                    action: 'update_task',
                    id: selected.id,
                    task,
                    requestId,
                  });
                  closeTaskEditor();
                  setNotice('Task updated.');
                  return;
                }
                if (captureDraft) {
                  const reviewed = captureDrafts.map((item, index) =>
                    index === captureIndex ? { ...item, ...task } : item,
                  );
                  if (captureIndex < reviewed.length - 1) {
                    setCaptureDrafts(reviewed);
                    setCaptureIndex(captureIndex + 1);
                    return;
                  }
                  if (!captureGroupId)
                    throw new Error('The capture group is missing. Try again.');
                  await commit({
                    action: 'capture_tasks',
                    captureGroupId,
                    captures: reviewed.map((item, index) => ({
                      captureId:
                        index === 0 ? captureGroupId : randomCaptureId(),
                      task: item,
                    })),
                    requestId: captureGroupId,
                  });
                  const count = reviewed.length;
                  closeTaskEditor();
                  setSource('');
                  setNotice(
                    count === 1
                      ? 'Task saved and added to your plan.'
                      : `${count} tasks saved and added to your plan.`,
                  );
                  return;
                }
                await commit({ action: 'create_task', task, requestId });
                closeTaskEditor();
                setSource('');
                setNotice('Task saved and added to your plan.');
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
  saveLabel,
}: {
  initial: Draft;
  state: Snapshot;
  saving: boolean;
  onSave: (task: Action, requestId: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onRestore: () => Promise<void>;
  saveLabel?: string;
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
  const [expectedUpdatedAt] = useState(initial.updatedAt);
  const [preparingCodex, setPreparingCodex] = useState(false);
  async function sendToCodex() {
    const current = [title, projectId, notes, steps, estimate, remaining, priority, status, due, start, splittable, blockers];
    const saved = [initial.title || '', initial.projectId || '', initial.notes || '', initial.steps || [], initial.estimateMinutes || 30, initial.remainingMinutes || initial.estimateMinutes || 30, initial.priority || 'medium', initial.status || 'ready', initial.dueDate || '', initial.notBefore || '', initial.splittable !== false, initial.blockers || []];
    if (JSON.stringify(current) !== JSON.stringify(saved)) {
      setLocalError('Save your changes before sending this task to Codex.');
      return;
    }
    setPreparingCodex(true);
    setLocalError('');
    try {
      const response = await fetch('/api/codex/handoff', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: initial.id, expectedUpdatedAt }),
      });
      const result = (await response.json()) as { error?: string; handoffUrl?: string };
      if (!response.ok || !result.handoffUrl) throw new Error(result.error || 'Could not prepare the Codex handoff.');
      window.location.assign(result.handoffUrl);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Could not send to Codex.');
      setPreparingCodex(false);
    }
  }

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
        result = (await response.json()) as {
          error?: unknown;
          title?: unknown;
        };
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
          expectedUpdatedAt,
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
            state.projects.find((p) => p.id === projectId),
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
      {initial.id && status !== 'done' && status !== 'archived' && (
        <Button type="button" variant="outline" disabled={saving || preparingCodex}
          onClick={() => void sendToCodex()}>
          {preparingCodex ? <Loader2 className="spin" /> : <ArrowUpRight />}
          {preparingCodex ? 'Preparing Codex…' : 'Send to Codex'}
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
            {regeneratingTitle ? <Loader2 className="spin" /> : <RotateCcw />}
            {regeneratingTitle ? 'Regenerating…' : 'Regenerate name'}
          </Button>
          {titleNotice && (
            <output className="secondary-text">{titleNotice}</output>
          )}
        </div>
      )}
      <Field label="Project">
        <NativeSelect
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">No project</option>
          {[...state.projects].sort(compareProjectsByName).map((p) => (
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
            <option value="top">Top</option>
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
                    state.projects.find((p) => p.id === t.projectId),
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
      <Field
        label="Task notes"
        hint="Suggested or added context for this task. The exact original input is preserved separately below."
      >
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
          <summary>Original input (verbatim)</summary>
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
          {initial.id ? 'Save changes' : saveLabel || 'Create task'}
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
    [shortName, setShortName] = useState(
      initial.name
        ? projectShortName({ name: initial.name, shortName: initial.shortName })
        : '',
    ),
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
          shortName,
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
      <Field
        label="Short name"
        hint="Used before task titles and calendar events. Leave blank to generate an abbreviation."
      >
        <Input
          maxLength={100}
          value={shortName}
          aria-label="Short name"
          placeholder={suggestProjectShortName(name) || 'e.g. BTF'}
          onChange={(e) => setShortName(e.target.value)}
        />
        {name.trim() && (
          <small>
            Task preview: ⚡️ {shortName.trim() || suggestProjectShortName(name)}
            : Task title
          </small>
        )}
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
  userEmail,
}: {
  state: Snapshot;
  commit: Commit;
  saving: boolean;
  onSaved: () => void;
  userEmail?: string;
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
          Choose when tasks may be scheduled. You can change these hours
          anytime.
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
        {state.revision === 0 && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const localZone =
                Intl.DateTimeFormat().resolvedOptions().timeZone;
              if (localZone) update('timeZone', localZone);
            }}
          >
            Use this device’s time zone
          </Button>
        )}
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
        <CodexSettings />
        <OpenAISettings />
        {state.integrations.emailSetupAvailable && <EmailCaptureSettings />}
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
        <div className="settings-card">
          <h2>Your account</h2>
          {userEmail && <p>Signed in as {userEmail}</p>}
          <p>
            Your projects, tasks, work hours, and calendar connections are
            separate from other users’ workspaces.
          </p>
          <Link href="/privacy">Beta data & privacy</Link>
          <Link
            download
            prefetch={false}
            className="download-link"
            href="/api/export?format=json"
          >
            <Download size={16} /> Export your data
          </Link>
        </div>
        {!state.integrations.emailSetupAvailable && <AccountDataSettings />}
      </div>
    </div>
  );
}
