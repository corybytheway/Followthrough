-- Created by Cory McCabe
CREATE TABLE `email_capture_receipts` (
	`owner_id` text NOT NULL,
	`email_id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`sent_email_id` text,
	`sent_at` integer,
	PRIMARY KEY(`owner_id`, `email_id`)
);
