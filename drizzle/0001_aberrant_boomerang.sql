CREATE TABLE `shortcut_connections` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`window_start` integer DEFAULT 0 NOT NULL,
	`window_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shortcut_connections_token_hash_unique` ON `shortcut_connections` (`token_hash`);