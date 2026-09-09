CREATE TABLE `calendar_connections` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`credentials` text NOT NULL,
	`document` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `calendar_locks` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL
);
