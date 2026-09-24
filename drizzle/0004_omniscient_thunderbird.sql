CREATE TABLE `email_connections` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`inbound_address` text NOT NULL,
	`allowed_senders` text NOT NULL,
	`credentials` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_connections_inbound_address_unique` ON `email_connections` (`inbound_address`);