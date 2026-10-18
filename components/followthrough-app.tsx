// Created by Cory McCabe
'use client';
import { normalizeProjectKeyword, suggestProjectKeywords, uniqueProjectKeywords } from '@/lib/project-keywords';
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
  Check,
  Link2,
  Loader2,
  X,
  Download,
  Search,
  MessageSquare,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { BASIC_CAPTURE_NOTICE } from '@/lib/capture-status';
import { handleCaptureKeyDown } from '@/lib/capture-keyboard';
import { resolveTaskReference, taskReference } from '@/lib/task-reference';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
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
import { Button, buttonVariants } from '@/components/ui/button';
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
import { normalizedTaskSearch, tasksForTaskList } from '@/lib/task-search';
import { SearchHighlightedText, TaskSearchContext } from '@/components/task-search-preview';
import { scheduledTaskComparator } from '@/lib/task-order';
import { tasksScheduledToday } from '@/lib/task-availability';
import { hasUnfinishedPrerequisites, taskPrerequisiteGroups } from '@/lib/task-prerequisites';
import {
  createDeviceTimeZoneSync,
  refreshedWorkHoursDraft,
  workHoursSettingsChanges,
  workHoursTimeLabel,
} from '@/lib/settings-client';
import { TOOL_DEFINITIONS, toolAction } from '@/lib/tools';
import ShortcutSettings from '@/components/shortcut-settings';
import CalendarSettings from '@/components/calendar-settings';
import OpenAISettings from '@/components/openai-settings';
import EmailCaptureSettings from '@/components/email-capture-settings';
import AccountDataSettings from '@/components/account-data-settings';

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
function todayHeading(day: string) {
  if (!day) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric',
  }).formatToParts(new Date(day + 'T12:00:00Z'));
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part('weekday')}, ${part('month')}. ${part('day')}`;
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
    captureRequestRef = useRef<{ source: string; requestId: string } | null>(null),
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
    if (!loaded) return;
    const syncDeviceTimeZone = createDeviceTimeZoneSync({
      current: () => stateRef.current.settings.timeZone,
      canRun: () =>
        !document.hidden && !busyRef.current && !completingRef.current.size,
      save: async (settings) => {
        const previousToday = localDay(
          Date.now(),
          stateRef.current.settings.timeZone,
        );
        await commit({ action: 'update_settings', settings });
        setDay((selected) =>
          selected === previousToday
            ? localDay(Date.now(), settings.timeZone)
            : selected,
        );
      },
    });
    const checkDeviceTimeZone = () => void syncDeviceTimeZone().catch(() => {});
    const foregroundDeviceTimeZone = () =>
      void syncDeviceTimeZone(true).catch(() => {});
    checkDeviceTimeZone();
    const timer = window.setInterval(checkDeviceTimeZone, 60_000);
    window.addEventListener('focus', foregroundDeviceTimeZone);
    document.addEventListener('visibilitychange', foregroundDeviceTimeZone);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', foregroundDeviceTimeZone);
      document.removeEventListener('visibilitychange', foregroundDeviceTimeZone);
    };
  }, [loaded, commit]);
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
    if (busyRef.current || !source.trim()) return;
    const submittedSource = source;
    if (captureRequestRef.current?.source !== submittedSource) {
      captureRequestRef.current = { source: submittedSource, requestId: crypto.randomUUID() };
    }
    setError('');
    setSaving(true);
    busyRef.current = true;
    try {
      const response = await fetch('/api/inbox', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(captureRequestRef.current),
        }),
        data = (await response.json()) as {
          state: Snapshot;
          result?: { tasks?: Task[] };
          error?: string;
        };
      if (!response.ok) throw new Error(data.error || 'Could not save your task.');
      accept(data.state);
      captureRequestRef.current = null;
      // Keep anything typed while the previous request was being saved.
      setSource((current) => current === submittedSource ? '' : current);
      const count = data.result?.tasks?.length;
      setNotice(count && count > 1 ? `${count} tasks added to your plan.` : 'Added to your plan.');
      window.dispatchEvent(new Event('followthrough-workspace-change'));
    } catch (e) {
      // Preserve both the input and request ID so a retry cannot duplicate a
      // capture whose save succeeded but whose response was interrupted.
      setError(e instanceof Error ? e.message : 'Could not save your task.');
    } finally {
      setSaving(false);
      busyRef.current = false;
    }
  }
  const active = state.tasks.filter((t) =>
    ['ready', 'waiting'].includes(t.status),
  );
  const availableToday = tasksScheduledToday(state.tasks, state.blocks, state.currentDate, state.settings.timeZone);
  const projectsAlphabetically = [...state.projects].sort(
    compareProjectsByName,
  );
  const compareBySchedule = scheduledTaskComparator(state.blocks);
  const searching = normalizedTaskSearch(query).length > 0;
  const visible = tasksForTaskList({
    tasks: state.tasks, projects: state.projects, blocks: state.blocks,
    query, statusFilter, projectFilter,
  });
  const taskById = new Map(state.tasks.map((t) => [t.id, t]));
  const selected = editing
    ? state.tasks.find((t) => t.id === editing)
    : undefined;
  function closeTaskEditor() {
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
    if (hasUnfinishedPrerequisites(task, state.tasks)) {
      setError('Blocked by unfinished tasks. Complete those tasks first.');
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
      blocked = task.status !== 'done' && hasUnfinishedPrerequisites(task, state.tasks),
      warning = state.warnings.find(
        (w) =>
          w.taskId === task.id && ['deadline', 'capacity'].includes(w.reason),
      );
    const planned = state.blocks.find((block) => block.taskId === task.id),
      completionPhase = completionPhases[task.id],
      searchQuery = tab === 'tasks' ? query : '',
      // Search is global, even when it starts in a project-filtered list.
      showProjectPrefix = tab !== 'tasks' || searching || projectFilter !== project?.id;
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
            (blocked ? 'blocked ' : '') +
            (completionPhase ? 'completing' : '')
          }
        >
          {!task.deletedAt && (
            <Checkbox
              className="task-completion"
              title={blocked ? 'Blocked by unfinished tasks. Complete those tasks first.' : task.status === 'done' ? 'Reopen task' : 'Mark complete'}
              aria-label={
                task.status === 'done'
                  ? 'Reopen ' + task.title
                  : 'Complete ' + task.title
              }
              checked={task.status === 'done' || Boolean(completionPhase)}
              disabled={blocked || (saving && !completionPhase)}
              onCheckedChange={(checked) =>
                void setTaskCompletion(task, checked === true).catch(() => {})
              }
            />
          )}
          <button className="task-body" onClick={() => openTask(task.id)}>
            <strong><SearchHighlightedText text={taskLabel(task.title, project, showProjectPrefix)} query={searchQuery} /></strong>
            <span className="task-meta">
              {project && (
                <span style={{ color: project.color }}><SearchHighlightedText text={project.name} query={searchQuery} /></span>
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
              {blocked && (
                <span className="pill">
                  <Link2 size={11} />
                  Blocked
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
              {task.status === 'waiting' && (
                <span className="pill">On hold</span>
              )}

              {(task.priority === 'high' || task.priority === 'top') && (
                <span className="urgent" data-priority={task.priority}>
                  {task.priority === 'top' ? 'Top' : 'High'} priority
                </span>
              )}
            </span>
            <TaskSearchContext task={task} query={searchQuery} />
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
              <div><h1>{todayHeading(state.currentDate)}</h1></div>
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
                    onKeyDown={(event) =>
                      handleCaptureKeyDown(event, () => void capture())
                    }
                    placeholder="Describe a task, or several, in a single prompt. Rambling and details encouraged."
                  />
                  <div className="capture-footer">
                    <span>Hit Enter to add</span>
                    <Button
                      className="capture-button"
                      disabled={saving || !source.trim()}
                      onClick={() => void capture()}
                    >
                      {saving ? <Loader2 className="spin" /> : <ArrowUpRight />}
                      {saving ? 'Adding…' : 'Add to plan'}
                    </Button>
                  </div>
                </div>
                <div className="section-heading">
                  <h2>{availableToday.length ? 'Followthrough on these first' : "That’s it for today!"}</h2>
                  {availableToday.length > 0 && <span>
                    {availableToday.length}{' '}
                    {availableToday.length === 1 ? 'task' : 'tasks'}
                  </span>}
                </div>
                {availableToday.length > 0 && (
                  <div className="task-list">
                    {[...availableToday].sort(compareBySchedule).map(taskRow)}
                  </div>
                )}
                <Button variant="link" className="view-all-tasks-link" onClick={() => navigateToTab('tasks')}>
                  View all tasks →
                </Button>
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
                  {workHoursTimeLabel(state.settings.workStart)}–
                  {workHoursTimeLabel(state.settings.workEnd)}
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
                          <button
                            onClick={() => openTask(event.taskId)}
                            style={{
                              borderLeftColor: state.projects.find(
                                (project) => project.id === taskById.get(event.taskId)?.projectId,
                              )?.color,
                            }}
                          >
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
              </aside>
            </div>
          </TabsContent>
          <TabsContent value="tasks">
            <div className="page-heading">
              <div>
                <h1>{searching ? 'Search results' : 'Your tasks'}</h1>
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
                  placeholder="Search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <NativeSelect
                aria-label="Filter project"
                value={searching ? 'all' : projectFilter}
                disabled={searching}
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
                value={searching ? 'all' : statusFilter}
                disabled={searching}
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
                <h1>Your projects</h1>
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
                <h1>Set up your work</h1>
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
        open={!!selected}
        onOpenChange={(open) => {
          if (!open && !saving) closeTaskEditor();
        }}
      >
        <SheetContent className="task-sheet">
          <SheetHeader>
            <SheetTitle>Task details</SheetTitle>
          </SheetHeader>
          {selected && (
            <TaskEditor
              key={selected.id}
              initial={selected}
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
                await commit({
                  action: 'update_task',
                  id: selected.id,
                  task,
                  requestId,
                });
                closeTaskEditor();
                setNotice('Task updated.');
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
            projects={state.projects}
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
                  ? { action: 'update_project', id: editingProject.id, expectedProject: editingProject, project }
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
  initial: Task;
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
  const [expectedUpdatedAt] = useState(initial.updatedAt);
  const prerequisiteGroups = taskPrerequisiteGroups(state.tasks, state.projects, initial.id ?? '', projectId || null);
  const hasOpenPrerequisites = hasUnfinishedPrerequisites({ blockers }, state.tasks);
  const [codexDraft, setCodexDraft] = useState<{ taskVersion: string; url: string } | null>(null);
  const [codexDraftError, setCodexDraftError] = useState(false);
  const [codexDraftRetry, setCodexDraftRetry] = useState(0);
  const taskVersion = `${initial.id}:${initial.updatedAt}`;
  useEffect(() => {
    if (!initial.id || initial.deletedAt || initial.status === 'done' || initial.status === 'archived') return;
    const controller = new AbortController();
    setCodexDraft(null);
    setCodexDraftError(false);
    void fetch('/api/codex/handoff', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: initial.id, expectedUpdatedAt: initial.updatedAt }),
      signal: controller.signal,
    }).then(async (response) => {
      const result = (await response.json()) as { chatgptUrl?: string };
      if (!response.ok || !result.chatgptUrl) throw new Error('Handoff unavailable');
      setCodexDraft({ taskVersion, url: result.chatgptUrl });
    }).catch(() => { if (!controller.signal.aborted) setCodexDraftError(true); });
    return () => controller.abort();
  }, [initial.id, initial.updatedAt, initial.deletedAt, initial.status, taskVersion, codexDraftRetry]);
  function hasUnsavedChanges() {
    const current = [title, projectId, notes, steps, estimate, remaining, priority, status, due, start, splittable, blockers];
    const saved = [initial.title || '', initial.projectId || '', initial.notes || '', initial.steps || [], initial.estimateMinutes || 30, initial.remainingMinutes || initial.estimateMinutes || 30, initial.priority || 'medium', initial.status || 'ready', initial.dueDate || '', initial.notBefore || '', initial.splittable !== false, initial.blockers || []];
    return JSON.stringify(current) !== JSON.stringify(saved);
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
          disabled={saving || !title.trim() || (status !== 'done' && hasOpenPrerequisites)}
          title={status !== 'done' && hasOpenPrerequisites ? 'Blocked by unfinished tasks. Complete those tasks first.' : undefined}
          onClick={(e) => void submit(e, status === 'done' ? 'ready' : 'done')}
        >
          <Check /> {status === 'done' ? 'Reopen task' : 'Mark complete'}
        </Button>
      )}
      {initial.id && status !== 'done' && status !== 'archived' && (
        codexDraft?.taskVersion === taskVersion ? (
          <a href={codexDraft.url} target="_blank" rel="noopener noreferrer"
            className={buttonVariants({ className: 'do-task-button' })}
            onClick={(event) => {
              if (saving || hasUnsavedChanges()) {
                event.preventDefault();
                setLocalError('Save your changes before sending this task to Codex.');
              }
            }}>
            <ArrowUpRight /> Do this for me
          </a>
        ) : (
          <Button type="button" className="do-task-button" disabled={!codexDraftError}
            onClick={() => setCodexDraftRetry((value) => value + 1)}>
            {codexDraftError ? <ArrowUpRight /> : <Loader2 className="spin" />}
            {codexDraftError ? 'Retry handoff' : 'Preparing task…'}
          </Button>
        )
      )}
      {initial.captureMode === 'basic' && initial.estimateProvisional && (
        <div className="draft-note">
          <strong>Basic capture</strong>
          <p>{BASIC_CAPTURE_NOTICE}</p>
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
            <option value="done" disabled={hasOpenPrerequisites && status !== 'done'}>Complete</option>
            <option value="archived">Archived</option>
          </NativeSelect>
        </Field>
      </div>
      <div className="field-row">
        <Field
          label="Deadline"
          hint="Leave empty for automatic planning."
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
        </label>
      </div>
      <div className="editor-section">
        <div className="section-heading">
          <h2>Suggested steps</h2>
          <span>
            {steps.filter((s) => s.done).length}/{steps.length}
          </span>
        </div>
        <div className="steps-list">
          {steps.map((step) => (
            <div className="check-field" key={step.id}>
              <Checkbox
                id={'step-' + step.id}
                checked={step.done}
                onCheckedChange={(done) =>
                  setSteps(
                    steps.map((s) => (s.id === step.id ? { ...s, done } : s)),
                  )
                }
              />
              <label htmlFor={'step-' + step.id}>{step.title}</label>
            </div>
          ))}
        </div>
      </div>
      <Field
        label="Task notes"
      >
        <Textarea
          rows={3}
          maxLength={10000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Details, links, or a definition of done"
        />
      </Field>
      <div className="field">
        <span>Blocked by</span>
        <small>
          Tasks selected here must be completed first before this current task
          gets scheduled on your calendar.
        </small>
        <div className="dependency-list">
          {prerequisiteGroups.map((group) => (
            <section className="dependency-group" key={group.id} aria-labelledby={'prerequisite-project-' + group.id}>
              <h3 id={'prerequisite-project-' + group.id} style={{ color: group.project?.color }}>
                <FolderOpen aria-hidden="true" />
                {group.project?.name || 'No project'}
              </h3>
              {group.tasks.length ? group.tasks.map((candidate) => (
                <div className="check-field" key={candidate.id}>
                  <Checkbox
                    id={'dep-' + candidate.id}
                    checked={blockers.includes(candidate.id)}
                    onCheckedChange={(checked) => setBlockers((current) => checked
                      ? [...new Set([...current, candidate.id])]
                      : current.filter((id) => id !== candidate.id))}
                  />
                  <label htmlFor={'dep-' + candidate.id}>{candidate.title}</label>
                </div>
              )) : <p className="secondary-text">{group.project ? 'No other open tasks in this project.' : 'No other open tasks without a project.'}</p>}
            </section>
          ))}
        </div>
      </div>
      {initial.source && (
        <section className="editor-section original-request">
          <h2>Original input</h2>
          <p>{initial.source}</p>
        </section>
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
          Save changes
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
  projects,
  saving,
  onCancel,
  onSave,
}: {
  initial: Partial<Project>;
  projects: Project[];
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
    [aliases, setAliases] = useState(initial.aliases?.join('\n') || ''),
    [aliasesEdited, setAliasesEdited] = useState(false),
    [error, setError] = useState('');
  const suggestions = suggestProjectKeywords(name, shortName, projects, initial.id);
  const aliasText = !initial.id && !aliasesEdited ? suggestions.join('\n') : aliases;
  const keywords = uniqueProjectKeywords(aliasText.split(/\r?\n/));
  const keys = new Set(keywords.map(normalizeProjectKeyword));
  const available = suggestions.filter(value => !keys.has(normalizeProjectKeyword(value)));
  const invalidKeywords = keywords.length > 20 || keywords.some(value => value.length > 100);
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
          aliases: keywords,
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
      <Field label="Keywords" hint="Other names and dictation variants. One per line; suggestions can be edited or removed.">
        <Textarea
          aria-label="Project keywords"
          rows={4}
          maxLength={2200}
          value={aliasText}
          onChange={(event) => { setAliasesEdited(true); setAliases(event.target.value); }}
        />
        <small>{keywords.length}/20 keywords</small>
        {available.length > 0 && (
          <div className="flex flex-wrap gap-2" aria-label="Suggested keywords">
            {available.map(value => (
              <Button key={value} type="button" variant="outline" size="sm"
                disabled={keywords.length >= 20}
                aria-label={`Add suggested keyword ${value}`}
                onClick={() => {
                  setAliasesEdited(true);
                  setAliases([...keywords, value].join('\n'));
                }}>
                <Plus size={14} />{value}
              </Button>
            ))}
          </div>
        )}
        {invalidKeywords && <p className="form-error" role="alert">Use up to 20 keywords, each at most 100 characters.</p>}
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
        <Button type="submit" disabled={saving || !name.trim() || invalidKeywords}>
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
  const baseline = useRef(state.settings);
  useEffect(() => {
    const previous = baseline.current;
    setSettings((draft) =>
      refreshedWorkHoursDraft(draft, previous, state.settings),
    );
    baseline.current = state.settings;
  }, [state.settings]);
  const update = (key: keyof Settings, value: unknown) =>
    setSettings((s) => ({ ...s, [key]: value }));
  return (
    <div className="settings-grid">
      <form
        className="settings-card editor-form"
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          void commit({
            action: 'update_settings',
            settings: workHoursSettingsChanges(settings, baseline.current),
          })
            .then(onSaved)
            .catch((e) => setError(e.message));
        }}
      >
        <h2>Work hours</h2>
        <p className="secondary-text">
          Choose when tasks may be scheduled. You can change these hours
          anytime.
        </p>
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
          <h2>Your account</h2>
          {userEmail && <p>Signed in as {userEmail}</p>}
          <p>
            Your projects, tasks, work hours, and calendar connections are
            separate from other users’ workspaces.
          </p>
          <Link className="account-privacy-link" href="/privacy">
            Beta data & privacy
          </Link>
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
