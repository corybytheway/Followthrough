-- Created by Cory McCabe
CREATE TABLE task_suggestion_states (owner_id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE task_suggestion_locks (owner_id TEXT PRIMARY KEY NOT NULL, token TEXT NOT NULL, expires_at INTEGER NOT NULL);
