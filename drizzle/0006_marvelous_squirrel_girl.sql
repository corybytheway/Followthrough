-- Created by Cory McCabe
CREATE TABLE `codex_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text,
	`key_hash` text NOT NULL,
	`pair_hash` text,
	`name` text NOT NULL,
	`setup_bucket` text NOT NULL,
	`setup_expires` integer NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen` integer DEFAULT 0 NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `codex_devices_key_hash_unique` ON `codex_devices` (`key_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `codex_devices_pair_hash_unique` ON `codex_devices` (`pair_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `codex_devices_active_owner` ON `codex_devices` (`owner_id`) WHERE "codex_devices"."revoked_at" IS NULL AND "codex_devices"."owner_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `codex_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`task_id` text NOT NULL,
	`task_stamp` text NOT NULL,
	`title` text NOT NULL,
	`payload` text NOT NULL,
	`state` text NOT NULL,
	`device_id` text,
	`thread_id` text,
	`message` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `codex_jobs_task_version` ON `codex_jobs` (`owner_id`,`task_id`,`task_stamp`);--> statement-breakpoint
CREATE INDEX `codex_jobs_owner_state` ON `codex_jobs` (`owner_id`,`state`,`created_at`);
