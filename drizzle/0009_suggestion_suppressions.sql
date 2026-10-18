-- Created by Cory McCabe
CREATE TABLE task_suggestion_suppressions (
  owner_id TEXT NOT NULL,
  suggestion_id TEXT NOT NULL,
  state TEXT NOT NULL,
  accepted_task_ids TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, suggestion_id)
);
