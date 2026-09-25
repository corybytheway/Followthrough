CREATE TABLE `ai_usage` (
	`owner_id` text NOT NULL,
	`day` text NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `day`)
);
--> statement-breakpoint
CREATE TABLE `calendar_action_owners` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_action_owners_handle_unique` ON `calendar_action_owners` (`handle`);