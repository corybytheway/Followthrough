// Created by Cory McCabe
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Atomic personal planning document, protected by a revision check on every write.
export const workspaces = sqliteTable('workspaces', {
  ownerId: text('owner_id').primaryKey(),
  revision: integer('revision').notNull().default(0),
  document: text('document').notNull(),
  updatedAt: text('updated_at').notNull(),
});
