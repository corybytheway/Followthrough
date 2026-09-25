// Created by Cory McCabe
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

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
