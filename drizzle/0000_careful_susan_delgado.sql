CREATE TABLE `preview_ai_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`day` text NOT NULL,
	`cost_micros` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `preview_ai_day_owner` ON `preview_ai_reservations` (`day`,`owner_id`);--> statement-breakpoint
CREATE TABLE `preview_drafts` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`record` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
