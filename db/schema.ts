// Created by Cory McCabe
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
export const taskSuggestionStates = sqliteTable('task_suggestion_states', {
  ownerId: text('owner_id').primaryKey(),
  payload: text('payload').notNull(),
});
export const taskSuggestionLocks = sqliteTable('task_suggestion_locks', {
  ownerId: text('owner_id').primaryKey(),
  token: text('token').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
export const taskSuggestionSuppressions = sqliteTable(
  'task_suggestion_suppressions',
  {
    ownerId: text('owner_id').notNull(),
    suggestionId: text('suggestion_id').notNull(),
    state: text('state').notNull(),
    acceptedTaskIds: text('accepted_task_ids').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.suggestionId] })],
);

export const nativeCodes = sqliteTable('native_codes', {
  codeHash: text('code_hash').primaryKey(),
  ownerId: text('owner_id').notNull(),
  challenge: text('challenge').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
export const nativeSessions = sqliteTable(
  'native_sessions',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    deviceName: text('device_name').notNull(),
    accessHash: text('access_hash').notNull().unique(),
    refreshHash: text('refresh_hash').notNull().unique(),
    accessExpires: integer('access_expires').notNull(),
    refreshExpires: integer('refresh_expires').notNull(),
    createdAt: integer('created_at').notNull(),
    revokedAt: integer('revoked_at'),
  },
  (table) => [index('native_sessions_owner').on(table.ownerId)],
);

// Atomic personal planning document, protected by a revision check on every write.
export const workspaces = sqliteTable('workspaces', {
  ownerId: text('owner_id').primaryKey(),
  revision: integer('revision').notNull().default(0),
  document: text('document').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// One revocable, create-only Shortcut connection per signed-in owner.
export const shortcutConnections = sqliteTable('shortcut_connections', {
  ownerId: text('owner_id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: text('created_at').notNull(),
  windowStart: integer('window_start').notNull().default(0),
  windowCount: integer('window_count').notNull().default(0),
});

// Credentials are encrypted separately from the exportable planning document.
export const calendarConnections = sqliteTable('calendar_connections', {
  ownerId: text('owner_id').primaryKey(),
  credentials: text('credentials').notNull(),
  document: text('document').notNull(),
  updatedAt: text('updated_at').notNull(),
});
export const calendarLocks = sqliteTable('calendar_locks', {
  ownerId: text('owner_id').primaryKey(),
  token: text('token').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

// Opaque public handles route one-tap calendar links to the correct private owner.
export const calendarActionOwners = sqliteTable('calendar_action_owners', {
  ownerId: text('owner_id').primaryKey(),
  handle: text('handle').notNull().unique(),
});

// AI settings use their own encrypted storage so calendar syncing cannot block setup.
export const openaiConnections = sqliteTable('openai_connections', {
  ownerId: text('owner_id').primaryKey(),
  credentials: text('credentials').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const aiUsage = sqliteTable(
  'ai_usage',
  {
    ownerId: text('owner_id').notNull(),
    day: text('day').notNull(),
    requests: integer('requests').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.day] })],
);

// Inbound email credentials are encrypted and resolved by recipient address.
export const emailConnections = sqliteTable('email_connections', {
  ownerId: text('owner_id').primaryKey(),
  inboundAddress: text('inbound_address').notNull().unique(),
  allowedSenders: text('allowed_senders').notNull(),
  credentials: text('credentials').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// One active Mac per owner. Pairing codes expire; only hashed device keys are stored.
export const codexDevices = sqliteTable(
  'codex_devices',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id'),
    keyHash: text('key_hash').notNull().unique(),
    pairHash: text('pair_hash').unique(),
    name: text('name').notNull(),
    setupBucket: text('setup_bucket').notNull(),
    setupExpires: integer('setup_expires').notNull(),
    createdAt: integer('created_at').notNull(),
    lastSeen: integer('last_seen').notNull().default(0),
    revokedAt: integer('revoked_at'),
  },
  (table) => [
    uniqueIndex('codex_devices_active_owner')
      .on(table.ownerId)
      .where(sql`${table.revokedAt} IS NULL AND ${table.ownerId} IS NOT NULL`),
  ],
);

// Task snapshots are encrypted for their owner and deduplicated by task version.
export const codexJobs = sqliteTable(
  'codex_jobs',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    taskId: text('task_id').notNull(),
    taskStamp: text('task_stamp').notNull(),
    title: text('title').notNull(),
    payload: text('payload').notNull(),
    state: text('state').notNull(),
    deviceId: text('device_id'),
    threadId: text('thread_id'),
    message: text('message').notNull().default(''),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('codex_jobs_task_version').on(
      table.ownerId,
      table.taskId,
      table.taskStamp,
    ),
    index('codex_jobs_owner_state').on(
      table.ownerId,
      table.state,
      table.createdAt,
    ),
  ],
);
