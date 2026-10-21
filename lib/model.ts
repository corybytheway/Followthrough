// Created by Cory McCabe
export function projectShortName(
  project: Pick<Project, 'name' | 'shortName'>,
): string {
  // Saved projects without a separate label keep their existing task prefix.
  return project.shortName?.trim() || project.name;
}
export function suggestProjectShortName(name: string): string {
  const words = name.trim().match(/[\p{L}\p{N}]+|&/gu) || [];
  if (words.length < 2) return name.trim();
  return words
    .map((word) =>
      /^(and|&)$/i.test(word) ? '&' : Array.from(word)[0].toUpperCase(),
    )
    .join('');
}
export function taskLabel(
  title: string,
  project?: Pick<Project, 'name' | 'shortName' | 'aliases'> | string,
  // Project task views already provide the context; stored titles stay intact.
  showProjectPrefix = true,
): string {
  const shortName =
    typeof project === 'string'
      ? project
      : project && projectShortName(project);
  const labels =
    typeof project === 'string'
      ? [project]
      : project
        ? [shortName!, project.name, ...project.aliases]
        : ['Task'];
  let name = title.replace(/^(?:\s*⚡[\uFE0E\uFE0F]?\s*)+/, '').trimStart();
  // Titles from older imports may already contain the full name or an alias.
  let prefix: string | undefined;
  while (
    (prefix = labels.find((label) =>
      name.toLowerCase().startsWith(label.toLowerCase() + ': '),
    ))
  )
    name = name.slice(prefix.length + 2);
  return (
    '⚡️ ' + (showProjectPrefix && shortName ? shortName + ': ' : '') + name
  );
}
export type Step = { id: string; title: string; done: boolean };
export type Project = {
  id: string;
  name: string;
  shortName?: string;
  aliases: string[];
  description: string;
  color: string;
};
export type Task = {
  behavior?: {
    deferredAt?: string[];
    lastProgressAt?: string;
    readySince?: string;
  };
  provenance?: { suggestionId: string; kind: string; url?: string };
  deletedAt?: string;
  statusBeforeDelete?: Task['status'];
  captureMode?: 'basic' | 'ai';
  captureGroupId?: string;
  captureIndex?: number;
  id: string;
  title: string;
  projectId: string | null;
  notes: string;
  source: string;
  steps: Step[];
  estimateMinutes: number;
  estimateProvisional?: boolean;
  remainingMinutes: number;
  priority: 'top' | 'high' | 'medium' | 'low';
  status: 'ready' | 'waiting' | 'done' | 'archived';
  dueDate: string | null;
  notBefore: string | null;
  blockers: string[];
  splittable: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
export type BusyEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  source: 'manual' | 'google' | 'icloud' | 'zoho';
  accountId?: string;
};
export type Block = {
  id: string;
  taskId: string;
  start: string;
  end: string;
  kind: 'task';
};
export type Settings = {
  timeZone: string;
  workStart: string;
  workEnd: string;
  workDays: number[];
  maxBlockMinutes: number;
  /** Legacy storage field; break timing follows maxBlockMinutes. */
  breakEveryMinutes: number;
  breakMinutes: number;
};
export type Workspace = {
  version: 1;
  projects: Project[];
  tasks: Task[];
  busy: BusyEvent[];
  blocks: Block[];
  settings: Settings;
  plannedAt: string | null;
  recentRequests: string[];
};
export type PlanWarning = {
  taskId: string;
  reason: 'blocked' | 'waiting' | 'capacity' | 'deadline';
  message: string;
};
export type Snapshot = Workspace & {
  currentDate: string;
  revision: number;
  warnings: PlanWarning[];
  integrations: {
    ai: boolean;
    google: boolean;
    icloud: boolean;
    zoho: boolean;
    background: boolean;
    email: {
      connected: boolean;
      address: string;
      allowedSenders: string[];
    };
    emailSetupAvailable: boolean;
  };
};
export const COLORS = [
  '#4266d5',
  '#8660bf',
  '#168882',
  '#c37037',
  '#b34d7c',
  '#5b7292',
];
export function initialWorkspace(): Workspace {
  const projects = [
    ['Orbit', 'orbit', 'Invoicing, time tracking, and running your business.'],
    [
      'Meta Note',
      'metanote,meta-note,meta note',
      'Notes and markers for post-production workflows.',
    ],
    [
      'Recording Station',
      'recording station',
      'Recording, cameras, audio, and studio operations.',
    ],
    [
      'HP Studios',
      'hp studio,hp studios',
      'Studio services, bookings, and client work.',
    ],
    [
      'CoryMcCabe.com',
      'corymccabe.com,cory mccabe website,personal website',
      'Your personal website and portfolio.',
    ],
    [
      'Triplegliss Studio',
      'triplegliss,triplegliss studio',
      'Studio apps and work that spans products.',
    ],
  ].map(([name, aliases, description], i) => ({
    id: `project-${i + 1}`,
    name,
    aliases: aliases.split(','),
    description,
    color: COLORS[i],
  }));
  return {
    version: 1,
    projects,
    tasks: [],
    busy: [],
    blocks: [],
    plannedAt: null,
    recentRequests: [],
    settings: {
      timeZone: 'America/Chicago',
      workStart: '09:00',
      workEnd: '19:30',
      workDays: [0, 1, 2, 3, 4, 5, 6],
      maxBlockMinutes: 90,
      breakEveryMinutes: 90,
      breakMinutes: 30,
    },
  };
}

// New accounts start with their own empty plan. Existing saved workspaces,
// including the original owner's projects and settings, are never rewritten.
export function newAccountWorkspace(): Workspace {
  return {
    version: 1,
    projects: [],
    tasks: [],
    busy: [],
    blocks: [],
    plannedAt: null,
    recentRequests: [],
    settings: {
      timeZone: 'UTC',
      workStart: '09:00',
      workEnd: '17:00',
      workDays: [1, 2, 3, 4, 5],
      maxBlockMinutes: 90,
      breakEveryMinutes: 90,
      breakMinutes: 30,
    },
  };
}
export const TASK_DURATION_PRESETS = [
  15, 30, 45, 60, 120, 180, 240, 360, 480, 1440, 2880, 4320, 10080,
];

export function taskDurationPreset(minutes: number): number {
  return (
    TASK_DURATION_PRESETS.find((preset) => preset >= minutes) ??
    TASK_DURATION_PRESETS[TASK_DURATION_PRESETS.length - 1]
  );
}

export function minutesLabel(minutes: number): string {
  if (minutes <= 0) return `${minutes}m`;
  const parts: string[] = [];
  for (const [size, unit] of [
    [10080, 'w'],
    [1440, 'd'],
    [60, 'h'],
    [1, 'm'],
  ] as const) {
    const count = Math.floor(minutes / size);
    if (count) parts.push(`${count}${unit}`);
    minutes %= size;
  }
  return parts.join(' ');
}
