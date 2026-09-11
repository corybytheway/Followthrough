// Created by Cory McCabe
export function taskLabel(title: string): string {
  return '⚡️ ' + title.replace(/^(?:\s*⚡[\uFE0E\uFE0F]?\s*)+/, '').trimStart();
}
export type Step = { id: string; title: string; done: boolean };
export type Project = {
  id: string;
  name: string;
  aliases: string[];
  description: string;
  color: string;
};
export type Task = {
  deletedAt?: string;
  statusBeforeDelete?: Task['status'];
  captureMode?: 'basic' | 'ai';
  id: string;
  title: string;
  projectId: string | null;
  notes: string;
  source: string;
  steps: Step[];
  estimateMinutes: number;
  estimateProvisional?: boolean;
  remainingMinutes: number;
  priority: 'high' | 'medium' | 'low';
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
  source: 'manual' | 'google' | 'icloud';
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
    background: boolean;
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
      breakEveryMinutes: 300,
      breakMinutes: 30,
    },
  };
}
export function minutesLabel(minutes: number): string {
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`
    : `${minutes}m`;
}
