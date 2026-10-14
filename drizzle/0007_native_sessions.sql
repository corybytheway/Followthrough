-- Created by Cory McCabe
CREATE TABLE `native_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`challenge` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `native_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`device_name` text NOT NULL,
	`access_hash` text NOT NULL,
	`refresh_hash` text NOT NULL,
	`access_expires` integer NOT NULL,
	`refresh_expires` integer NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `native_sessions_access_hash_unique` ON `native_sessions` (`access_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `native_sessions_refresh_hash_unique` ON `native_sessions` (`refresh_hash`);--> statement-breakpoint
CREATE INDEX `native_sessions_owner` ON `native_sessions` (`owner_id`);