// Created by Cory McCabe
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
